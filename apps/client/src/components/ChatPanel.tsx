import { useCallback, useEffect, useRef, useState } from "react";
import type { AvatarEmotion } from "../avatar/model.config";
import { fetchHealth, type Health } from "../lib/api";
import type { Character } from "../characters";
import { createChatSession, streamChat, type HistoryMessage } from "../lib/chat";
import { useChatSessions } from "../hooks/useChatSessions";
import { ChatSessionControls } from "./ChatSessionControls";

interface Bubble {
  key: string;
  role: "me" | "her";
  text: string;
  pending?: boolean;
  failed?: boolean;
  /** 看视频时的进度提示，回复开始后消失。 */
  progress?: string;
}

interface Props {
  character: Character;
  onEmotion: (emotion: AvatarEmotion) => void;
  onSpeaking: (speaking: boolean) => void;
}

let counter = 0;
const nextKey = () => `b${++counter}`;

export function ChatPanel({ character, onEmotion, onSpeaking }: Props) {
  const [health, setHealth] = useState<Health | null | undefined>(undefined);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const abort = useRef<AbortController | null>(null);
  const requestGeneration = useRef(0);

  const showHistory = useCallback((history: HistoryMessage[]) => {
    setBubbles(history.map((message) => ({ key: `h${message.id}`, role: message.role === "user" ? "me" : "her", text: message.content })));
  }, []);
  const { sessions, sessionId, setSessions, setSessionId, selectSession, startNewSession, renameSession, deleteSession } = useChatSessions(character.id, showHistory);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchHealth(ctrl.signal).then(setHealth);
    return () => ctrl.abort();
  }, []);

  useEffect(() => () => abort.current?.abort(), []);

  useEffect(() => {
    const resetAfterClear = () => {
      abort.current?.abort();
      setBubbles([]);
      setSessions([]);
      setSessionId(undefined);
      void createChatSession(character.id).then((session) => {
        setSessions([session]);
        setSessionId(session.id);
        localStorage.setItem(`whalepartner:session:${character.id}`, session.id);
      }).catch((error: unknown) => {
        console.warn("清空后新建聊天失败：", error instanceof Error ? error.message : error);
      });
    };
    window.addEventListener("whalepartner:history-cleared", resetAfterClear);
    return () => window.removeEventListener("whalepartner:history-cleared", resetAfterClear);
  }, [character.id]);

  useEffect(() => {
    const targetId = localStorage.getItem(`whalepartner:open-message:${character.id}`);
    const target = targetId ? document.getElementById(`message-h${targetId}`) : null;
    if (target && list.current) {
      list.current.scrollTop = target.getBoundingClientRect().top - list.current.getBoundingClientRect().top + list.current.scrollTop - 24;
      localStorage.removeItem(`whalepartner:open-message:${character.id}`);
      return;
    }
    if (targetId && bubbles.length === 0) return;
    if (targetId) localStorage.removeItem(`whalepartner:open-message:${character.id}`);
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [bubbles, character.id]);

  useEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 240)}px`;
  }, [draft]);

  const stopCurrentReply = useCallback(() => {
    requestGeneration.current++;
    abort.current?.abort();
    abort.current = null;
    setBusy(false);
    onSpeaking(false);
  }, [onSpeaking]);

  const chooseSession = useCallback((id: string) => {
    stopCurrentReply();
    setDraft("");
    setSessionError("");
    void selectSession(id);
  }, [selectSession, stopCurrentReply]);

  const createSession = useCallback(() => {
    stopCurrentReply();
    setDraft("");
    setSessionError("");
    void startNewSession();
  }, [startNewSession, stopCurrentReply]);

  const removeCurrentSession = useCallback(async () => {
    stopCurrentReply();
    setSessionError("");
    try {
      await deleteSession();
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "删除对话失败。");
    }
  }, [deleteSession, stopCurrentReply]);

  const send = useCallback(async (text: string) => {
    const message = text.trim();
    if (!message || busy || !sessionId) return;
    const generation = ++requestGeneration.current;
    setSessions((previous) => previous.map((session) => session.id === sessionId && !session.titleManual && session.title === "新聊天"
      ? { ...session, title: message.slice(0, 40), updatedAt: new Date().toISOString() }
      : session));
    const reply = nextKey();
    setBusy(true);
    setDraft("");
    setBubbles((prev) => [
      ...prev.filter((b) => !b.failed),
      { key: nextKey(), role: "me", text: message },
      { key: reply, role: "her", text: "", pending: true },
    ]);

    const ctrl = new AbortController();
    abort.current = ctrl;
    let started = false;
    try {
      for await (const event of streamChat(message, character.id, sessionId, ctrl.signal)) {
        if (requestGeneration.current !== generation) break;
        if (event.type === "video" || event.type === "web") setBubbles((prev) => prev.map((b) => (b.key === reply ? { ...b, progress: event.message } : b)));
        else if (event.type === "emotion") onEmotion(event.emotion);
        else if (event.type === "delta") {
          if (!started) { started = true; onSpeaking(true); }
          setBubbles((prev) => prev.map((b) => (b.key === reply ? { ...b, text: b.text + event.text, pending: false, progress: undefined } : b)));
        } else if (event.type === "done") {
          setSessions((previous) => previous.map((session) => session.id === event.sessionId
            ? { ...session, title: !session.titleManual && session.title === "新聊天" ? message.slice(0, 40) : session.title, updatedAt: new Date().toISOString() }
            : session));
        } else if (event.type === "error") throw new Error(event.message);
      }
    } catch (error) {
      if (ctrl.signal.aborted || requestGeneration.current !== generation) return;
      const note = error instanceof Error ? error.message : "出错了。";
      setBubbles((prev) => prev.map((b) => (b.key === reply && !b.text ? { ...b, text: note, pending: false, failed: true } : b)));
      setDraft(message);
    } finally {
      if (requestGeneration.current === generation) {
        onSpeaking(false);
        setBusy(false);
        setBubbles((prev) => prev.map((b) => (b.key === reply ? { ...b, pending: false } : b)));
      }
    }
  }, [busy, character.id, onEmotion, onSpeaking, sessionId, setSessions]);

  const isMac = /Macintosh|Mac OS X/u.test(navigator.userAgent);

  const online = health?.ok === true;
  return (
    <section className="chat" aria-label={`与${character.name}聊天`}>
      <header className="chat__head">
        <div className="chat__title">
          <h2>{character.name}</h2>
          <span className="chat__status">
            <i className={`dot ${health === undefined ? "" : online ? "dot--ok" : "dot--bad"}`} />
            {health === undefined ? "正在连接…" : online ? `在线 · ${health.model ?? health.provider}` : "后端未连接"}
          </span>
        </div>
        <div className="chat__session">
          <ChatSessionControls
            sessions={sessions}
            sessionId={sessionId}
            onSelect={chooseSession}
            onRename={async (title) => { await renameSession(title); setSessionError(""); }}
            onDelete={removeCurrentSession}
          />
          <button className="chat__new" type="button" disabled={!online} onClick={createSession}>新聊天</button>
        </div>
        <span className="tag" title={`${character.name}是 AI 角色，不是真人`}>AI 角色</span>
      </header>
      <div className="chat__list" role="log" aria-live="polite" ref={list}>
        {bubbles.length === 0 && <div className="msg msg--her">{character.greeting}</div>}
        {bubbles.map((b) => <div id={`message-${b.key}`} key={b.key} className={`msg msg--${b.role}${b.failed ? " msg--failed" : ""}`}>
          {b.pending ? (
            <span className="waiting"><span className="typing" aria-label="正在输入"><i /><i /><i /></span>{b.progress && <span className="progress">{b.progress}</span>}</span>
          ) : b.text}
        </div>)}
      </div>
      {sessionError && <p className="chat__error" role="alert">{sessionError}</p>}
      <form className="chat__composer" onSubmit={(e) => { e.preventDefault(); void send(draft); }}>
        <label className="sr-only" htmlFor="chat-input">消息</label>
        <textarea
          id="chat-input"
          ref={input}
          className="chat__input"
          rows={1}
          value={draft}
          maxLength={2000}
          placeholder={online ? `和${character.name}说点什么…` : "后端未连接，暂时无法聊天"}
          disabled={!online || !sessionId}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229 && (isMac ? e.metaKey : e.ctrlKey)) { e.preventDefault(); void send(draft); }
          }}
        />
        <button className="send" type="submit" disabled={!online || !sessionId || busy || !draft.trim()} >发送</button>
      </form>
      {isMac && <p className="chat__dictation-hint">按 macOS 听写快捷键可语音输入，内容会留在草稿中；未开启时到“系统设置 → 键盘 → 听写”启用并查看快捷键。</p>}
    </section>
  );
}
