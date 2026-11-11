import type { Server } from "node:http";

/**
 * 先把 HTTP 服务器关掉（不再接新连接，并断开存量连接），再等收尾任务完成。
 *
 * 之前 `server.close(() => process.exit(0))` 会在 close 回调里立刻退出，
 * 排在 close 事件里的日记/记忆等待和 store.close() 根本来不及跑。
 * 调用方负责 2.5 秒的 hardExit 上限；这里只保证「先关服务器、再收尾」的顺序。
 */
export async function closeServerAndDrain(server: Server, drain: () => Promise<void>): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
  await drain();
}
