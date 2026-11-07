/**
 * fetch 手里拿到的错误是英文 TypeError：WebKit 说 `Load failed`（Tauri 窗口就是它），
 * Chromium 说 `Failed to fetch`。把这句话原样摆到界面上，等于让人看着报错猜。
 *
 * 0.2.3 的现场就是这样：点一下开关，行下面出现一行英文 `Load failed`，开关自己弹回去。
 * 所以统一在这里翻译一次，谁是网络层失败谁就拿到同一句人话。
 */

/** 本机后端地址（和 `lib/api.ts` 的 API_BASE 对齐；写死只是为了文案短）。 */
const LOCAL_API = "127.0.0.1:8787";

const NETWORK_HINTS = [
  /load failed/i,
  /failed to fetch/i,
  /networkerror/i,
  /network request failed/i,
  /network connection was lost/i,
  /the network connection was lost/i,
  /could not connect/i,
];

/** 是不是「根本没连上」，而不是服务端返回的 4xx/5xx。 */
export function isNetworkFailure(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  return NETWORK_HINTS.some((hint) => hint.test(raw));
}

/**
 * 把错误翻译成一句能照着做的话。
 * `what` 描述哪件事没成，例如「昵称没存上」。
 */
export function describeNetError(error: unknown, what = "没存上"): string {
  if (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") {
    return "已取消。";
  }
  if (isNetworkFailure(error)) {
    return `${what}：连不上本机后端（${LOCAL_API}）。按「再试一次」；还不行就双击项目里的「启动鲸汐.command」，等服务起来再点。`;
  }
  const raw = error instanceof Error ? error.message.trim() : String(error ?? "").trim();
  return raw || `${what}，待会儿再试。`;
}
