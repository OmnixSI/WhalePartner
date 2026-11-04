import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { AvatarEmotion } from "../avatar/model.config";
import { fetchHealth, type Health } from "../lib/api";
import { fetchHistory, streamChat } from "../lib/chat";
import { SendIcon } from "./Icons";

const GREETING = "你好呀，我是鲸汐。\n我住在你的手机里，会陪你聊天，也会替你看看视频。今天想从哪里聊起？";

interface Bubble {
  key: string;
  role: "me" | "her";
  text: string;
  pending?: boolean;
  failed?: boolean;
  recalled?: string[];
}

interface Props {
  onEmotion: (emotion: AvatarEmotion) => void;
  onSpeaking: (speaking: boolean) => void;
}

let counter = 0;
const nextKey = () => `b${++counter}`;

export function ChatPanel({ onEmotion, onSpeaking }: Props) {
  const [health, setHealth] = useState<Health | null | undefined>(undefined);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchHealth(ctrl.signal).then(setHealth);
    fetchHistory(50, ctrl.signal).then((history) =>
      setBubbles(history.map((m) => ({ key: `h${m.id}`, role: m.role === "user" ? "me" : "her", text: m.content }))),
    );
    return () => ctrl.abort();
  }, []);

  useEffect(() => () => abort.current?.abort(), []);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [bubbles]);

  const send = useCallback(async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
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
      for await (const event of streamChat(message, ctrl.signal)) {
        if (event.type === "recall") setBubbles((prev) => prev.map((b) => (b.key === reply ? { ...b, recalled: event.memories } : b)));
        else if (event.type === "emotion") onEmotion(event.emotion);
        else if (event.type === "delta") {
          if (!started) { started = true; onSpeaking(true); }
          setBubbles((prev) => prev.map((b) => (b.key === reply ? { ...b, text: b.text + event.text, pending: false } : b)));
        } else if (event.type === "error") throw new Error(event.message);
      }
    } catch (error) {
      if (ctrl.signal.aborted) return;
      const note = error instanceof Error ? error.message : "出错了。";
      setBubbles((prev) => prev.map((b) => (b.key === reply && !b.text ? { ...b, text: note, pending: false, failed: true } : b)));
      setDraft(message);
    } finally {
      onSpeaking(false);
      setBusy(false);
      setBubbles((prev) => prev.map((b) => (b.key === reply ? { ...b, pending: false } : b)));
    }
  }, [busy, onEmotion, onSpeaking]);

  const online = health?.ok === true;
  return (
    <section className="chat" aria-label="与鲸汐聊天">
      <header className="chat__head">
        <div className="chat__title">
          <h2>鲸汐</h2>
          <span className="chat__status">
            <i className={`dot ${health === undefined ? "" : online ? "dot--ok" : "dot--bad"}`} />
            {health === undefined ? "正在连接…" : online ? `在线 · ${health.model ?? health.provider}` : "后端未连接"}
          </span>
        </div>
        <span className="badge" title="鲸汐是 AI 角色，不是真人">AI 角色</span>
      </header>
      <div className="chat__list" role="log" aria-live="polite" ref={list}>
        {bubbles.length === 0 && <div className="msg msg--her">{GREETING}</div>}
        {bubbles.map((b) => (
          <Fragment key={b.key}>
            <div className={`msg msg--${b.role}${b.failed ? " msg--failed" : ""}`}>
              {b.pending ? <span className="typing" aria-label="正在输入"><i /><i /><i /></span> : b.text}
            </div>
            {b.recalled && b.recalled.length > 0 && <div className="recall">想起了：{b.recalled.join("；")}</div>}
          </Fragment>
        ))}
      </div>
      <form className="chat__composer" onSubmit={(e) => { e.preventDefault(); void send(draft); }}>
        <label className="sr-only" htmlFor="chat-input">消息</label>
        <textarea
          id="chat-input"
          className="chat__input"
          rows={1}
          value={draft}
          maxLength={2000}
          placeholder={online ? "和鲸汐说点什么…" : "后端未连接，暂时无法聊天"}
          disabled={!online}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(draft); }
          }}
        />
        <button className="send" type="submit" disabled={!online || busy || !draft.trim()} aria-label="发送"><SendIcon /></button>
      </form>
    </section>
  );
}
