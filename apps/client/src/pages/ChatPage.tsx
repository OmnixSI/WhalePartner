import { ChatPanel } from "../components/ChatPanel";
import { useCharacter } from "../characters";

/**
 * 聊天页（`/`，规范 §7.1）。
 * 整页是一个「房间」：左边舞台（她站在海边），字幕落在她下面，
 * 你的话是一张手写便签，历史在右边的「往回翻」里。
 * 房间的状态与布局都在 ChatPanel 里，这里只负责跟着当前角色重挂。
 */
export function ChatPage() {
  const character = useCharacter();
  return <ChatPanel character={character} />;
}
