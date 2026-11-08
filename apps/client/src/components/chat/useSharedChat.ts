/**
 * 聊天状态（多端同步版）。
 *
 * - 乐观显示：发出去的话立刻出现；流式增量先攒进缓冲，每帧合并一次，只更新最后一条。
 * - 打断：生成中点「停」→ 保留已生成的部分（服务端也入库并标记 interrupted）；生成中继续输入、按发送即先停后发。
 * - 幂等：每条消息一个 clientId；重试复用同一个 id，服务端去重。
 * - 多端：订阅 hub 的 /api/events。别的设备发的话、她正在给别的设备逐字写的回复，都会实时出现在这里；
 *   断线重连后整体重拉一次历史，补齐漏掉的部分。
 * - 草稿按会话持久化；错误给出可读原因并可「再试一次」；后端还没起来时显示「马上就来」并自动重试。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { AvatarEmotion } from "../../avatar/model.config";
import type { CharacterId } from "../../characters";
import { fetchHealth, type Health } from "../../lib/api";
import { ChatError, describeChatFailure, type ChatErrorCode } from "../../lib/chat-errors";
import { clearHistory, fetchHistory, fetchSessions, newClientId, streamChat, updateChatPresence, type HistoryMessage } from "../../lib/chat";
import { draftKey, loadDraft, saveDraft } from "../../lib/drafts";
import { isEmotion, readEmotion } from "../../lib/emotion";
import { subscribeHub, type HubEventData, type HubEventType } from "../../lib/events";
import type { Progress, Turn } from "./types";

type Phase = "idle" | "thinking" | "streaming" | "failed";

interface SpeechControls {
  append: (chunk: string) => void;
  finish: () => void;
  reset: () => void;
}

interface VoiceOutputControls {
  isEnabled: () => boolean;
  append: (text: string, emotion: AvatarEmotion) => void;
  finish: () => void;
}

export interface ChatFailureInfo {
  code: ChatErrorCode | "unknown";
  message: string;
}

let counter = 0;
const nextKey = () => `t${++counter}`;
const HISTORY_LIMIT = 50;
/** 启动期宽限：后端还没起来时，这么久之内显示「马上就来」而不是「断网」。 */
const STARTUP_GRACE_MS = 30_000;
const BOOT_AT = Date.now();
const PRESENCE_IDLE_MS = 10 * 60_000;

const toTurn = (message: HistoryMessage): Turn => {
  const clean = readEmotion(message.content);
  return {
    key: `h${message.id}`,
    serverId: message.id,
    role: message.role === "user" ? "me" : "her",
    text: clean.text,
    at: message.createdAt,
    status: "sent",
    emotion: isEmotion(message.emotion) ? message.emotion : clean.emotion ?? undefined,
    interrupted: message.attachment?.type === "interrupted" || undefined,
    proactive: message.attachment?.type === "proactive" || undefined,
  };
};

/** 只改最后命中的那一条，其余引用不变。 */
function updateTurn(list: Turn[], key: string, fn: (turn: Turn) => Turn): Turn[] {
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].key === key) {
      const next = list.slice();
      next[i] = fn(list[i]);
      return next;
    }
  }
  return list;
}

export function useSharedChat(characterId: CharacterId, speech: SpeechControls, voiceOutput?: VoiceOutputControls, voicePlaying = false) {
  const [health, setHealth] = useState<Health | null | undefined>(undefined);
  const [showOffline, setShowOffline] = useState(false);
  const [starting, setStarting] = useState(false);
  const [needsPair, setNeedsPair] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [draft, setDraftState] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [live, setLive] = useState<{ key: string; chunks: string[] } | null>(null);
  const [progress, setProgress] = useState<Progress | undefined>(undefined);
  const [emotion, setEmotion] = useState<AvatarEmotion>("neutral");
  const [focusSignal, setFocusSignal] = useState(0);
  const [shareSignal, setShareSignal] = useState(0);
  const [failure, setFailure] = useState<ChatFailureInfo | null>(null);
  const [remoteTyping, setRemoteTyping] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [presenceClientId] = useState(() => newClientId());
  const sessionIdRef = useRef("");
  const lastActivityRef = useRef(Date.now());
  const abort = useRef<AbortController | null>(null);
  const voiceOutputRef = useRef(voiceOutput);
  const voicePlayingRef = useRef(voicePlaying);
  const inflight = useRef<Promise<void> | null>(null);
  const ownClientIds = useRef(new Set<string>());
  const remoteKey = useRef<string | null>(null);
  const draftRef = useRef("");
  const pendingDelta = useRef<{ key: string; text: string } | null>(null);
  const raf = useRef(0);
  const busy = phase === "thinking" || phase === "streaming";
  const busyRef = useRef(false);
  busyRef.current = busy;
  voiceOutputRef.current = voiceOutput;
  voicePlayingRef.current = voicePlaying;

  useEffect(() => {
    const activity = () => { lastActivityRef.current = Date.now(); };
    const post = (visible = true, keepalive = false) => {
      const shown = visible && !document.hidden;
      void updateChatPresence({
        clientId: presenceClientId,
        character: characterId,
        visible: shown,
        active: shown && Date.now() - lastActivityRef.current < PRESENCE_IDLE_MS,
        busy: busyRef.current,
        voicePlaying: voicePlayingRef.current,
      }, keepalive).catch(() => {});
    };
    const visibility = () => post();
    window.addEventListener("pointerdown", activity, { passive: true });
    window.addEventListener("keydown", activity);
    window.addEventListener("focus", activity);
    document.addEventListener("visibilitychange", visibility);
    post();
    const timer = setInterval(() => post(), 15_000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
      window.removeEventListener("focus", activity);
      document.removeEventListener("visibilitychange", visibility);
      void updateChatPresence({ clientId: presenceClientId, character: characterId, visible: false, active: false, busy: false, voicePlaying: false }, true).catch(() => {});
    };
  }, [characterId, presenceClientId]);

  useEffect(() => {
    const visible = !document.hidden;
    void updateChatPresence({
      clientId: presenceClientId,
      character: characterId,
      visible,
      active: visible && Date.now() - lastActivityRef.current < PRESENCE_IDLE_MS,
      busy: busyRef.current,
      voicePlaying,
    }).catch(() => {});
  }, [characterId, presenceClientId, voicePlaying]);

  /* ------------------------------------------------------------ 草稿 */
  const setDraft = useCallback((value: string) => {
    draftRef.current = value;
    setDraftState(value);
    saveDraft(draftKey(characterId, sessionIdRef.current), value);
  }, [characterId]);

  /* ------------------------------------------------------------ 增量合帧 */
  const flushDelta = useCallback(() => {
    if (raf.current) { cancelAnimationFrame(raf.current); raf.current = 0; }
    const pending = pendingDelta.current;
    if (!pending) return;
    pendingDelta.current = null;
    setLive((prev) => (prev && prev.key === pending.key ? { ...prev, chunks: [...prev.chunks, pending.text] } : prev));
    setTurns((prev) => updateTurn(prev, pending.key, (turn) => ({ ...turn, text: turn.text + pending.text, status: "streaming" })));
  }, []);

  const pushDelta = useCallback((key: string, text: string) => {
    if (pendingDelta.current && pendingDelta.current.key !== key) flushDelta();
    pendingDelta.current = { key, text: (pendingDelta.current?.text ?? "") + text };
    if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; flushDelta(); });
  }, [flushDelta]);

  /* ------------------------------------------------------------ 历史 */
  const loadHistory = useCallback(async (signal: AbortSignal) => {
    const sessions = await fetchSessions(characterId, signal);
    if (signal.aborted) return;
    const active = sessions.find((session) => session.id === sessionIdRef.current) ?? sessions[0];
    sessionIdRef.current = active?.id ?? "";
    const history = active ? await fetchHistory(characterId, HISTORY_LIMIT, signal, active.id) : [];
    if (signal.aborted) return;
    setTurns((prev) => {
      // 还在进行中的本机轮次（含乐观显示的话）保留在尾部，避免重拉把它们冲掉。
      const mine = prev.filter((turn) => turn.status === "sending" || turn.status === "thinking" || turn.status === "streaming" || turn.status === "failed");
      const known = new Set(history.map((message) => message.id));
      return [...history.map(toTurn), ...mine.filter((turn) => turn.serverId === undefined || !known.has(turn.serverId))];
    });
    const lastAssistant = [...history].reverse().find((message) => message.role === "assistant");
    if (lastAssistant) {
      const clean = readEmotion(lastAssistant.content);
      const mood = isEmotion(lastAssistant.emotion) ? lastAssistant.emotion : clean.emotion;
      if (mood && mood !== "neutral") setEmotion(mood);
    }
    // 草稿：会话确定后，输入框是空的才恢复这个会话的草稿。
    if (!draftRef.current) {
      const saved = loadDraft(draftKey(characterId, sessionIdRef.current));
      if (saved) { draftRef.current = saved; setDraftState(saved); }
    }
    setHistoryLoaded(true);
  }, [characterId]);

  useEffect(() => {
    abort.current?.abort();
    speech.reset();
    setPhase("idle");
    setLive(null);
    setFailure(null);
    setRemoteTyping(false);
    remoteKey.current = null;
    draftRef.current = "";
    setDraftState("");
    const ctrl = new AbortController();
    setHistoryLoaded(false);
    fetchHealth(ctrl.signal).then(setHealth);
    loadHistory(ctrl.signal).catch((error: unknown) => {
      if (!ctrl.signal.aborted) {
        console.warn("读取共享聊天记录失败：", error instanceof Error ? error.message : error);
        setTurns([]);
        setHistoryLoaded(true);
      }
    });
    return () => ctrl.abort();
  }, [characterId, speech.reset, loadHistory, reloadTick]);

  /* ------------------------------------------------------------ 健康：启动竞态 + 自动重试 */
  useEffect(() => {
    if (health === undefined || health?.ok === true) {
      setShowOffline(false);
      setStarting(false);
      return;
    }
    const withinGrace = Date.now() - BOOT_AT < STARTUP_GRACE_MS;
    setStarting(withinGrace);
    setShowOffline(!withinGrace);
    const timer = setInterval(() => {
      void fetchHealth().then((next) => {
        if (next?.ok) {
          setHealth(next);
          setReloadTick((n) => n + 1); // 后端刚起来：把空着的历史补上
        } else if (Date.now() - BOOT_AT >= STARTUP_GRACE_MS) {
          setStarting(false);
          setShowOffline(true);
        }
      });
    }, withinGrace ? 1500 : 5000);
    return () => clearInterval(timer);
  }, [health]);

  useEffect(() => {
    const onAuth = () => setNeedsPair(true);
    const onConn = () => { setNeedsPair(false); setReloadTick((n) => n + 1); };
    window.addEventListener("wp:auth-required", onAuth);
    window.addEventListener("wp:connection-changed", onConn);
    return () => {
      window.removeEventListener("wp:auth-required", onAuth);
      window.removeEventListener("wp:connection-changed", onConn);
    };
  }, []);

  useEffect(() => () => {
    abort.current?.abort();
    if (raf.current) cancelAnimationFrame(raf.current);
  }, []);

  /* ------------------------------------------------------------ 多端实时 */
  useEffect(() => {
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const armWatchdog = () => {
      clearTimeout(watchdog);
      // 别的设备那头掉线时不会再有 done：60 秒没动静就放下。
      watchdog = setTimeout(() => { setRemoteTyping(false); remoteKey.current = null; setLive(null); }, 60_000);
    };
    const mine = (data: HubEventData) => Boolean(data.clientId && ownClientIds.current.has(data.clientId));
    const unsubscribe = subscribeHub((type: HubEventType, data: HubEventData) => {
      if (type === "resync") {
        if (!busyRef.current) setReloadTick((n) => n + 1);
        return;
      }
      if (data.character !== characterId) return;
      if (data.sessionId && sessionIdRef.current && data.sessionId !== sessionIdRef.current) return;
      if (mine(data)) return;
      if (!sessionIdRef.current && data.sessionId) sessionIdRef.current = data.sessionId;

      if (type === "typing") {
        const on = Boolean(data.on);
        setRemoteTyping(on);
        if (on) armWatchdog(); else clearTimeout(watchdog);
      } else if (type === "message.created") {
        const message = data.message as HistoryMessage | undefined;
        if (!message) return;
        if (message.role === "assistant") flushDelta();
        const incoming: Turn = toTurn(message);
        if (message.attachment?.type === "interrupted") incoming.interrupted = true;
        setTurns((prev) => {
          if (prev.some((turn) => turn.serverId === message.id)) return prev;
          // 对应的远端流式轮次落库了：把它转正，而不是再添一条。
          const streamKey = message.role === "assistant" ? remoteKey.current : null;
          if (streamKey && prev.some((turn) => turn.key === streamKey)) {
            remoteKey.current = null;
            return updateTurn(prev, streamKey, (turn) => ({ ...turn, serverId: message.id, status: "done", interrupted: incoming.interrupted, at: message.createdAt }));
          }
          return [...prev, incoming];
        });
        if (message.role === "assistant") { setRemoteTyping(false); setLive(null); }
      } else if (type === "message.delta") {
        const text = typeof data.text === "string" ? data.text : "";
        const streamId = String(data.streamId ?? "");
        if (!text) return;
        armWatchdog();
        const key = `r${streamId}`;
        if (remoteKey.current !== key) {
          remoteKey.current = key;
          const at = new Date().toISOString();
          setTurns((prev) => (prev.some((turn) => turn.key === key) ? prev : [...prev, { key, role: "her", text: "", at, status: "streaming", streamId }]));
          setLive({ key, chunks: [] });
        }
        pushDelta(key, text);
      } else if (type === "message.done" || type === "message.interrupted") {
        flushDelta();
        clearTimeout(watchdog);
        setRemoteTyping(false);
        const removed = data.removedMessageId;
        if (typeof removed === "number") setTurns((prev) => prev.filter((turn) => turn.serverId !== removed));
        const key = remoteKey.current;
        if (key) setTurns((prev) => updateTurn(prev, key, (turn) => ({ ...turn, status: "done", interrupted: type === "message.interrupted" || undefined })));
        if (type === "message.done" && isEmotion(String(data.emotion)) && data.emotion !== "neutral") setEmotion(data.emotion as AvatarEmotion);
      } else if (type === "settings.updated" || type === "memory.updated" || type === "diary.updated" || type === "surf.item") {
        window.dispatchEvent(new CustomEvent("wp:hub-event", { detail: { type, data } }));
      }
    });
    return () => { clearTimeout(watchdog); unsubscribe(); };
  }, [characterId, pushDelta, flushDelta]);

  const retryHealth = () => {
    setHealth(undefined);
    void fetchHealth().then((next) => {
      setHealth(next);
      if (next?.ok) setReloadTick((n) => n + 1);
    });
  };

  /* ------------------------------------------------------------ 发送 */
  const send = async (raw: string, retryClientId?: string): Promise<void> => {
    const message = raw.trim();
    if (!message) return;
    if (busyRef.current) {
      // 生成中按发送：先停后发。
      abort.current?.abort();
      await inflight.current;
    }
    const run = (async () => {
      const meKey = nextKey();
      const herKey = nextKey();
      const clientId = retryClientId ?? newClientId();
      ownClientIds.current.add(clientId);
      const at = new Date().toISOString();
      setDraft("");
      speech.reset();
      setProgress(undefined);
      setFailure(null);
      setRemoteTyping(false);
      remoteKey.current = null;
      setPhase("thinking");
      setTurns((prev) => [
        ...prev.filter((turn) => !(turn.role === "her" && turn.status === "failed" && !turn.text)),
        { key: meKey, role: "me", text: message, at, status: "sending", clientId },
        { key: herKey, role: "her", text: "", at, status: "thinking" },
      ]);
      setLive({ key: herKey, chunks: [] });

      const ctrl = new AbortController();
      abort.current = ctrl;
      let started = false;
      let gotText = false;
      let replyEmotion: AvatarEmotion = "neutral";
      try {
        for await (const event of streamChat(message, characterId, sessionIdRef.current, ctrl.signal, clientId)) {
          if (event.type === "ack") {
            if (event.sessionId) sessionIdRef.current = event.sessionId;
            setTurns((prev) => updateTurn(prev, meKey, (turn) => ({ ...turn, status: "sent" })));
          } else if (event.type === "delta") {
            gotText = true;
            if (!started) {
              started = true;
              setPhase("streaming");
              setTurns((prev) => updateTurn(prev, meKey, (turn) => ({ ...turn, status: "sent" })));
            }
            const voice = voiceOutputRef.current;
            if (voice?.isEnabled()) voice.append(event.text, replyEmotion);
            else speech.append(event.text);
            pushDelta(herKey, event.text);
          } else if (event.type === "video" || event.type === "web") {
            setProgress({ kind: event.type, stage: event.stage, message: event.message, title: event.title });
          } else if (event.type === "emotion") {
            replyEmotion = event.emotion;
            setEmotion(event.emotion);
            setTurns((prev) => updateTurn(prev, herKey, (turn) => ({ ...turn, emotion: event.emotion })));
          } else if (event.type === "done") {
            flushDelta();
            sessionIdRef.current = event.sessionId;
            const mood = event.emotion;
            const userMessageId = (event as { userMessageId?: number }).userMessageId;
            setTurns((prev) => {
              let next = updateTurn(prev, herKey, (turn) => ({ ...turn, status: "done", emotion: mood, serverId: event.messageId }));
              if (userMessageId !== undefined) next = updateTurn(next, meKey, (turn) => ({ ...turn, serverId: userMessageId }));
              return next;
            });
            if (mood && mood !== "neutral") setEmotion(mood);
          }
        }
        setPhase("idle");
        setFocusSignal((value) => value + 1);
        speech.finish();
        voiceOutputRef.current?.finish();
      } catch (error) {
        flushDelta();
        if (ctrl.signal.aborted) {
          // 打断：已经说出来的部分保留（服务端同样入库并标记 interrupted）。
          speech.finish();
          voiceOutputRef.current?.finish();
          if (gotText) {
            setTurns((prev) => updateTurn(updateTurn(prev, herKey, (turn) => ({ ...turn, status: "done", interrupted: true })), meKey, (turn) => ({ ...turn, status: "sent" })));
          } else {
            // 一个字都没出：服务端撤掉了这条用户消息，这里同步撤掉并把话还给输入框。
            setTurns((prev) => prev.filter((turn) => turn.key !== herKey && turn.key !== meKey));
            if (!draftRef.current) setDraft(message);
          }
          setPhase("idle");
          return;
        }
        speech.reset();
        voiceOutputRef.current?.finish();
        const info: ChatFailureInfo = error instanceof ChatError
          ? { code: error.code, message: error.message }
          : { code: "unknown", message: describeChatFailure("http", error instanceof Error ? error.message : undefined) };
        setFailure(info);
        if (info.code === "auth") setNeedsPair(true);
        // 说了一半才断：留住已有的部分，并标成被打断。
        setTurns((prev) => prev.map((turn) => {
          if (turn.key === meKey) return { ...turn, status: gotText ? "sent" : "failed" };
          if (turn.key === herKey) return gotText ? { ...turn, status: "done", interrupted: true } : { ...turn, text: "", status: "failed" };
          return turn;
        }));
        setPhase("failed");
        if (gotText) ownClientIds.current.delete(clientId);
      } finally {
        setProgress(undefined);
        setLive(null);
        setTurns((prev) => updateTurn(prev, herKey, (turn) => ({ ...turn, status: turn.text && turn.status !== "failed" ? "done" : turn.status })));
      }
    })();
    inflight.current = run;
    await run;
  };

  const stop = () => abort.current?.abort();
  const giveUp = stop;

  const retrySend = () => {
    const failed = [...turns].reverse().find((turn) => turn.role === "me" && turn.status === "failed");
    if (!failed) {
      // 回复说到一半断了：重发上一句。
      const lastMe = [...turns].reverse().find((turn) => turn.role === "me");
      if (lastMe) { setPhase("idle"); setFailure(null); void send(lastMe.text); }
      return;
    }
    setTurns((prev) => prev.filter((turn) => turn.status !== "failed"));
    setPhase("idle");
    setFailure(null);
    void send(failed.text, failed.clientId);
  };

  const discardSend = () => {
    const failed = [...turns].reverse().find((turn) => turn.role === "me" && turn.status === "failed");
    setTurns((prev) => prev.filter((turn) => turn.status !== "failed"));
    setPhase("idle");
    setFailure(null);
    if (failed && !draftRef.current) setDraft(failed.text);
  };

  const clearAll = () => {
    void clearHistory();
    setTurns([]);
    setPhase("idle");
    setLive(null);
    sessionIdRef.current = "";
  };

  const today = () => {
    setDraft("今天……");
    setFocusSignal((value) => value + 1);
  };

  // 对界面来说「她在说话」：自己这一轮，或另一台设备上的那一轮。
  const remoteStreaming = remoteKey.current !== null && live?.key === remoteKey.current;
  const displayPhase: Phase = busy ? phase : phase === "failed" ? "failed" : remoteStreaming ? "streaming" : remoteTyping ? "thinking" : phase;

  return {
    health,
    showOffline,
    starting,
    needsPair,
    online: health?.ok === true,
    busy,
    turns,
    historyLoaded,
    draft,
    setDraft,
    phase: displayPhase,
    live,
    progress,
    emotion,
    failure,
    focusSignal,
    shareSignal,
    setShareSignal,
    retryHealth,
    send,
    stop,
    giveUp,
    retrySend,
    discardSend,
    clearAll,
    today,
  };
}
