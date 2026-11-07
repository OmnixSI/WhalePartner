import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

/** Open a saved HTTP(S) source in the system browser, or a browser tab on the web. */
export async function openExternalUrl(value: string): Promise<void> {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("只支持打开 HTTP 或 HTTPS 来源链接。");
  }

  if (isTauri()) {
    await openUrl(url.href);
    return;
  }

  const opened = window.open(url.href, "_blank");
  if (!opened) throw new Error("浏览器阻止了打开新窗口，请允许打开弹出窗口后重试。");
  opened.opener = null;
}
