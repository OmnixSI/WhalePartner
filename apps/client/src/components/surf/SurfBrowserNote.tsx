/**
 * 设置里「翻网页」下面的一行小字：读网页用的浏览器第一次需要在后台下载一次，
 * 下载时显示进度，不需要你去敲任何命令；没装好之前她也能读普通网页，只是读不了要脚本渲染的那种。
 */
import { useEffect, useState } from "react";
import { getSurfStatus, type SurfBrowser } from "../../lib/surf";

type Props = {
  character: string;
  initial?: SurfBrowser | null;
  /** 总开关里「翻网页」是不是开着；关着就不提。 */
  enabled: boolean;
};

export function SurfBrowserNote({ character, initial = null, enabled }: Props) {
  const [browser, setBrowser] = useState<SurfBrowser | null>(initial);

  useEffect(() => setBrowser(initial), [initial]);

  // 正在下载时每 3 秒问一次进度，装好或失败就停。
  useEffect(() => {
    if (!enabled || browser?.state !== "installing") return;
    const timer = window.setInterval(() => {
      void getSurfStatus(character).then((status) => {
        if (status?.browser) setBrowser(status.browser);
      });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [browser?.state, character, enabled]);

  if (!enabled || !browser || browser.state === "ready" || browser.state === "idle") return null;
  const text =
    browser.state === "installing"
      ? `正在准备读网页用的浏览器${browser.percent !== null ? `（${browser.percent}%）` : ""}，第一次要下载一次，不用你动手。`
      : "读网页用的浏览器没装上，她先只读普通网页；联网后会再试。";
  return (
    <p className="surf-browser-note" role="status" data-state={browser.state}>
      {text}
      {browser.state === "installing" && browser.percent !== null && (
        <span className="surf-browser-note__bar" aria-hidden>
          <span style={{ width: `${browser.percent}%` }} />
        </span>
      )}
    </p>
  );
}
