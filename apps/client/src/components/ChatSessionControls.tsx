import { useState } from "react";
import type { ChatSession } from "../lib/chat";
import { ConfirmDialog } from "./ui/Dialog";
import { m } from "../i18n";

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
      setError(cause instanceof Error ? cause.message : m.chat.sessions.renameFailed);
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
      <label className="sr-only" htmlFor="chat-session">{m.chat.sessions.listLabel}</label>
      <select id="chat-session" value={sessionId ?? ""} disabled={disabled || sessions.length === 0} onChange={(event) => onSelect(event.target.value)}>
        {sessions.map((session) => <option key={session.id} value={session.id}>{session.title || m.chat.sessions.newChat}</option>)}
      </select>
      {active && <details className="chat__session-menu">
        <summary aria-label={m.chat.sessions.actions} title={m.chat.sessions.actions}>···</summary>
        <div className="chat__session-menu-panel">
          {editing ? <div className="chat__rename">
            <input
              aria-label={m.chat.sessions.nameLabel}
              autoFocus
              maxLength={40}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void rename(); } }}
            />
            <button type="button" disabled={saving || !title.trim()} onClick={() => void rename()}>{m.chat.sessions.save}</button>
            <button type="button" onClick={() => setEditing(false)}>{m.chat.sessions.cancel}</button>
            {error && <span role="alert">{error}</span>}
          </div> : <button type="button" onClick={(event) => {
            setTitle(active.title || "");
            setEditing(true);
            event.currentTarget.closest("details")?.removeAttribute("open");
          }}>{m.chat.sessions.rename}</button>}
          {!editing && <button className="chat__session-delete" type="button" onClick={() => void remove()}>{m.chat.sessions.delete}</button>}
        </div>
      </details>}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={m.chat.sessions.deleteTitle}
        description={m.chat.sessions.deleteDescription(active?.title || m.chat.sessions.newChat)}
        confirmLabel={m.chat.sessions.deleteConfirm}
        cancelLabel={m.chat.sessions.deleteCancel}
        tone="danger"
        onConfirm={() => { void onDelete(); }}
      />
    </div>
  );
}
