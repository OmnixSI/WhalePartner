import { useEffect, useState } from "react";
import { fetchHealth, type Health } from "../lib/api";
import { SendIcon } from "./Icons";

const GREETING = "你好呀，我是鲸汐。\n我住在你的手机里，会陪你聊天，也会替你看看视频。今天想从哪里聊起？";

export function ChatPanel() {
  const [health, setHealth] = useState<Health | null | undefined>(undefined);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchHealth(ctrl.signal).then(setHealth);
    return () => ctrl.abort();
  }, []);

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
      <div className="chat__list" role="log" aria-live="polite">
        <div className="msg msg--her">{GREETING}</div>
      </div>
      <form className="chat__composer" onSubmit={(e) => e.preventDefault()}>
        <label className="sr-only" htmlFor="chat-input">消息</label>
        <textarea id="chat-input" className="chat__input" rows={1} placeholder="聊天功能即将接入…" disabled />
        <button className="send" type="submit" disabled aria-label="发送"><SendIcon /></button>
      </form>
    </section>
  );
}
