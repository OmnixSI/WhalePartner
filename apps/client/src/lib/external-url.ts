import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { m } from "../i18n/index.ts";

/** Open a saved HTTP(S) source in the system browser, or a browser tab on the web. */
export async function openExternalUrl(value: string): Promise<void> {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(m.common.externalUrl.httpOnly);
  }

  if (isTauri()) {
    await openUrl(url.href);
    return;
  }

  const opened = window.open(url.href, "_blank");
  if (!opened) throw new Error(m.common.externalUrl.popupBlocked);
  opened.opener = null;
}
