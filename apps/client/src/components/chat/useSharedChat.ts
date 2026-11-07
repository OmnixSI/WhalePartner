import { useEffect, useRef, useState } from "react";
import type { AvatarEmotion } from "../../avatar/model.config";
import type { CharacterId } from "../../characters";
import { fetchHealth, type Health } from "../../lib/api";
import { clearHistory, fetchHistory, fetchSessions, streamChat } from "../../lib/chat";
import { isEmotion, readEmotion } from "../../lib/emotion";
import type { Progress, Turn } from "./types";

type Phase = "idle" | "thinking" | "streaming" | "failed";

interface SpeechControls {
  append: (chunk: string) => void;
  finish: () => void;
  reset: () => void;
}

let counter = 0;
const nextKey = () => `t${++counter}`;
const HISTORY_LIMIT = 50;

export function useSharedChat(characterId: CharacterId, speech: SpeechControls) {
  const [health, setHealth] = useState<Health | null | undefined>(undefined);
  const [showOffline, setShowOffline] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [live, setLive] = useState<{ key: string; chunks: string[] } | null>(null);
  const [progress, setProgress] = useState<Progress | undefined>(undefined);
  const [emotion, setEmotion] = useState<AvatarEmotion>("neutral");
  const [focusSignal, setFocusSignal] = useState(0);
  const [shareSignal, setShareSignal] = useState(0);
  const sessionIdRef = useRef("");
  const abort = useRef<AbortController | null>(null);
  const busy = phase === "thinking" || phase === "streaming";

  useEffect(() => {
    abort.current?.abort();
    speech.reset();
    setPhase("idle");
    setLive(null);
    const ctrl = new AbortController();
    setHistoryLoaded(false);
    fetchHealth(ctrl.signal).then(setHealth);
    void (async () => {
      const sessions = await fetchSessions(characterId, ctrl.signal);
      if (ctrl.signal.aborted) return;
      const active = sessions.find((session) => session.id === sessionIdRef.current) ?? sessions[0];
      sessionIdRef.current = active?.id ?? "";
      const history = active
        ? await fetchHistory(characterId, HISTORY_LIMIT, ctrl.signal, active.id)
        : [];
      if (ctrl.signal.aborted) return;
      setTurns(history.map((message) => {
        const clean = readEmotion(message.content);
        return {
          key: `h${message.id}`,
          role: message.role === "user" ? "me" : "her",
          text: clean.text,
          at: message.createdAt,
          status: "sent" as const,
          emotion: isEmotion(message.emotion) ? message.emotion : clean.emotion ?? undefined,
        };
      }));
      const lastAssistant = [...history].reverse().find((message) => message.role === "assistant");
      if (lastAssistant) {
        const clean = readEmotion(lastAssistant.content);
        const mood = isEmotion(lastAssistant.emotion) ? lastAssistant.emotion : clean.emotion;
        if (mood && mood !== "neutral") setEmotion(mood);
      }
      setHistoryLoaded(true);
    })().catch((error: unknown) => {
      if (!ctrl.signal.aborted) {
        console.warn("读取共享聊天记录失败：", error instanceof Error ? error.message : error);
        setTurns([]);
        setHistoryLoaded(true);
      }
    });
    return () => ctrl.abort();
  }, [characterId, speech.reset]);

  useEffect(() => {
    if (health === undefined || health?.ok === true) {
      setShowOffline(false);
      return;
    }
    const timer = setTimeout(() => setShowOffline(true), 1500);
    return () => clearTimeout(timer);
  }, [health]);

  useEffect(() => () => {
    abort.current?.abort();
  }, []);

  const retryHealth = () => {
    setHealth(undefined);
    void fetchHealth().then(setHealth);
  };

  const send = async (raw: string) => {
    const message = raw.trim();
    if (!message || busy) return;
    const meKey = nextKey();
    const herKey = nextKey();
    const at = new Date().toISOString();
    setDraft("");
    speech.reset();
    setProgress(undefined);
    setPhase("thinking");
    setTurns((prev) => [
      ...prev.filter((turn) => !(turn.role === "her" && turn.status === "failed" && !turn.text)),
      { key: meKey, role: "me", text: message, at, status: "sending" },
      { key: herKey, role: "her", text: "", at, status: "thinking" },
    ]);
    setLive({ key: herKey, chunks: [] });

    const ctrl = new AbortController();
    abort.current = ctrl;
    let started = false;
    try {
      for await (const event of streamChat(message, characterId, sessionIdRef.current, ctrl.signal)) {
        if (event.type === "delta") {
          if (!started) {
            started = true;
            setPhase("streaming");
            setTurns((prev) => prev.map((turn) => (turn.key === meKey ? { ...turn, status: "sent" } : turn)));
          }
          speech.append(event.text);
          setLive((prev) => (prev && prev.key === herKey ? { ...prev, chunks: [...prev.chunks, event.text] } : prev));
          setTurns((prev) =>
            prev.map((turn) => (turn.key === herKey ? { ...turn, text: turn.text + event.text, status: "streaming" } : turn)),
          );
        } else if (event.type === "video" || event.type === "web") {
          setProgress({ kind: event.type, stage: event.stage, message: event.message, title: event.title });
        } else if (event.type === "emotion") {
          setEmotion(event.emotion);
          setTurns((prev) => prev.map((turn) => (turn.key === herKey ? { ...turn, emotion: event.emotion } : turn)));
        } else if (event.type === "done") {
          sessionIdRef.current = event.sessionId;
          const mood = event.emotion;
          setTurns((prev) => prev.map((turn) => (turn.key === herKey ? { ...turn, status: "done", emotion: mood } : turn)));
          if (mood && mood !== "neutral") setEmotion(mood);
        } else if (event.type === "error") {
          throw new Error(event.message);
        }
      }
      setPhase("idle");
      setProgress(undefined);
      setFocusSignal((value) => value + 1);
      speech.finish();
    } catch {
      if (ctrl.signal.aborted) {
        speech.reset();
        setTurns((prev) => prev.filter((turn) => turn.key !== herKey));
        setPhase("idle");
        return;
      }
      speech.reset();
      setTurns((prev) => prev.map((turn) => (
        turn.key === meKey
          ? { ...turn, status: "failed" }
          : turn.key === herKey ? { ...turn, text: "", status: "failed" } : turn
      )));
      setPhase("failed");
    } finally {
      setProgress(undefined);
      setTurns((prev) => prev.map((turn) => (
        turn.key === herKey ? { ...turn, status: turn.text ? "done" : turn.status } : turn
      )));
    }
  };

  const giveUp = () => abort.current?.abort();

  const retrySend = () => {
    const failed = [...turns].reverse().find((turn) => turn.role === "me" && turn.status === "failed");
    if (!failed) return;
    setTurns((prev) => prev.filter((turn) => turn.status !== "failed"));
    setPhase("idle");
    void send(failed.text);
  };

  const discardSend = () => {
    setTurns((prev) => prev.filter((turn) => turn.status !== "failed"));
    setPhase("idle");
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

  return {
    health,
    showOffline,
    online: health?.ok === true,
    busy,
    turns,
    historyLoaded,
    draft,
    setDraft,
    phase,
    live,
    progress,
    emotion,
    focusSignal,
    shareSignal,
    setShareSignal,
    retryHealth,
    send,
    giveUp,
    retrySend,
    discardSend,
    clearAll,
    today,
  };
}
