import { ChatPanel } from "../components/ChatPanel";
import { PageHeader } from "../components/shell/PageHeader";
import { useCharacter } from "../characters";

/**
 * 聊天页（`/`，规范 §7.1）。
 * 外壳和页头由 AppShell / PageHeader 提供；房间本身仍在 ChatPanel 里。
 */
export function ChatPage() {
  const character = useCharacter();
  return (
    <div className="chat-page">
      <div className="chat-page__inner">
        <PageHeader eyebrow="日常 · 聊天" title={`和${character.name}在一起`} lead={character.tagline} />
        <div className="chat-page__body"><ChatPanel character={character} /></div>
      </div>
    </div>
  );
}
