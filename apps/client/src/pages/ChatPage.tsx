import { ChatPanel } from "../components/ChatPanel";
import { useCharacter } from "../characters";
import { m } from "../i18n";

/**
 * 聊天页（`/`，规范 §7.1）。
 * 不放页头：舞台、对话和输入条直接铺满内容区，整块高度都给舞台。
 * 读屏用的页面标题放在一个 sr-only 的 h1 里。
 */
export function ChatPage() {
  const character = useCharacter();
  return (
    <div className="chat-page">
      <h1 className="sr-only">{m.chat.page.title(character.name)}</h1>
      <ChatPanel character={character} />
    </div>
  );
}
