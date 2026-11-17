import { LANG_HEADER, lang } from "../i18n/index.ts";

/**
 * 配对新设备的请求。它不走带鉴权的通用请求函数，所以语言头要在这里自己带上，
 * hub 才会用当前界面语言回错误提示。
 */
export function pairRequestInit(code: string, deviceName: string): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", [LANG_HEADER]: lang },
    body: JSON.stringify({ code: code.trim(), name: deviceName }),
  };
}
