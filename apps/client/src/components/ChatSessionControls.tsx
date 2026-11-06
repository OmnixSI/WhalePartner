import { useState } from "react";
import type { ChatSession } from "../lib/chat";
import { ConfirmDialog } from "./chat/ConfirmDialog";

interface Props {
  sessions: ChatSession[];
  sessionId?: string;
  disabled?: boolean;
  onSelect: (id: string) => void;
  onRename: (title: string) => Promise<void>;
  onDelete: () => Promise<void>;
}

export function ChatSessionControls({ sessions, sessionId, disabled = false, onSelect, onRename, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const active = sessions.find((session) => session.id === sessionId);

  const rename = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      await onRename(title.trim());
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "重命名失败。");
    } finally {
      setSaving(false);
    }
  };

  const [confirming, setConfirming] = useState(false);

  const remove = async () => {
    setConfirming(true);
  };

  return (
    <div className="chat__sessions">
      <label className="sr-only" htmlFor="chat-session">聊天记录</label>
      <select id="chat-session" value={sessionId ?? ""} disabled={disabled || sessions.length === 0} onChange={(event) => onSelect(event.target.value)}>
        {sessions.map((session) => <option key={session.id} value={session.id}>{session.title || "新聊天"}</option>)}
      </select>
      {active && <details className="chat__session-menu">
        <summary aria-label="当前会话操作" title="当前会话操作">···</summary>
        <div className="chat__session-menu-panel">
          {editing ? <div className="chat__rename">
            <input
              aria-label="聊天名称"
              autoFocus
              maxLength={40}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void rename(); } }}
            />
            <button type="button" disabled={saving || !title.trim()} onClick={() => void rename()}>保存</button>
            <button type="button" onClick={() => setEditing(false)}>取消</button>
            {error && <span role="alert">{error}</span>}
          </div> : <button type="button" onClick={(event) => {
            setTitle(active.title || "");
            setEditing(true);
            event.currentTarget.closest("details")?.removeAttribute("open");
          }}>重命名</button>}
          {!editing && <button className="chat__session-delete" type="button" onClick={() => void remove()}>删除对话</button>}
        </div>
      </details>}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="删除这段对话？"
        body={`删除“${active?.title || "新聊天"}”后，只由它产生的记忆也会一起消失，找不回来。`}
        confirmLabel="删除"
        cancelLabel="再想想"
        danger
        onConfirm={() => { setConfirming(false); void onDelete(); }}
      />
    </div>
  );
}
