import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { checkLogin, fetchAccounts, logout, startLogin, type AccountStatus, type LoginState } from "../lib/accounts";
import { describeNetError } from "../lib/net";
import { Button } from "./ui/Button";

const POLL_MS = 2500;

type Flow =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "scanning"; key: string; image: string; state: Extract<LoginState, "waiting" | "scanned"> }
  | { phase: "failed"; message: string };

const when = (iso: string | null) => {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
};

function statusLine(account: AccountStatus | undefined, loading: boolean) {
  if (!account) return loading ? "正在读取…" : "读取不到账号状态，后端未连接。";
  if (!account.connected) return "还没登录。登录后她能读到需要登录才看得到的字幕。";
  if (account.valid === false) return "登录已失效，需要重新扫码。";
  return `已登录${account.savedAt ? `（${when(account.savedAt)}）` : ""}。她可以读取你能看到的字幕。`;
}

/** 账号接入：目前只有哔哩哔哩，扫码登录。登录态只存在这台电脑上，不会上传，也不会替你发评论或点赞。 */
export function Accounts() {
  const [accounts, setAccounts] = useState<AccountStatus[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [flow, setFlow] = useState<Flow>({ phase: "idle" });
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const cancelled = useRef(false);

  const refresh = useCallback(async () => {
    try {
      setAccounts(await fetchAccounts());
    } catch {
      setAccounts(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cancelled.current = false;
    void refresh();
    return () => { cancelled.current = true; };
  }, [refresh]);

  // 二维码出来后轮询扫码状态；离开页面或点“取消”就停。
  const scanKey = flow.phase === "scanning" ? flow.key : null;
  useEffect(() => {
    if (!scanKey) return;
    const ctrl = new AbortController();
    const timer = window.setInterval(async () => {
      try {
        const state = await checkLogin("bilibili", scanKey, ctrl.signal);
        if (ctrl.signal.aborted) return;
        if (state === "success") {
          setFlow({ phase: "idle" });
          await refresh();
        } else if (state === "expired") setFlow({ phase: "failed", message: "二维码过期了。" });
        else if (state === "error") setFlow({ phase: "failed", message: "登录没有成功，请重新扫码。" });
        else setFlow((current) => (current.phase === "scanning" && current.key === scanKey ? { ...current, state } : current));
      } catch (error) {
        if (!ctrl.signal.aborted) setFlow({ phase: "failed", message: describeNetError(error, "查询扫码状态失败") });
      }
    }, POLL_MS);
    return () => { ctrl.abort(); window.clearInterval(timer); };
  }, [scanKey, refresh]);

  const begin = async () => {
    setFlow({ phase: "starting" });
    try {
      const start = await startLogin("bilibili");
      // 白底深色码，保证深色主题下也能扫。
      const image = await QRCode.toDataURL(start.url, { margin: 1, width: 220, color: { dark: "#17222d", light: "#ffffff" } });
      if (!cancelled.current) setFlow({ phase: "scanning", key: start.key, image, state: "waiting" });
    } catch (error) {
      if (!cancelled.current) setFlow({ phase: "failed", message: describeNetError(error, "获取二维码失败") });
    }
  };

  const signOut = async () => {
    if (!confirmingLogout) { setConfirmingLogout(true); return; }
    setConfirmingLogout(false);
    try {
      await logout("bilibili");
    } finally {
      await refresh();
    }
  };

  const bilibili = accounts?.find((a) => a.platform === "bilibili");
  const needsLogin = !bilibili?.connected || bilibili.valid === false;
  const busy = flow.phase === "starting" || flow.phase === "scanning";

  return (
    <div className="accounts">
      <p className="set-row__desc">登录状态只保存在这台电脑上，不会上传，也不会替你发评论或点赞。其它平台（小红书、抖音、微博）还没有接入。</p>
      <div className="account">
        <div className="account__head">
          <div>
            <div className="account__name">哔哩哔哩</div>
            <div className="account__status">{statusLine(bilibili, loading)}</div>
          </div>
          <div className="account__actions">
            {bilibili && needsLogin && !busy && <Button variant="primary" onClick={() => void begin()}>扫码登录</Button>}
            {bilibili?.connected && !busy && <Button variant={confirmingLogout ? "danger" : "secondary"} onClick={() => void signOut()} onBlur={() => setConfirmingLogout(false)}>{confirmingLogout ? "确认退出" : "退出登录"}</Button>}
            {busy && <Button variant="ghost" onClick={() => setFlow({ phase: "idle" })}>取消</Button>}
          </div>
        </div>
        {flow.phase === "starting" && <p className="account__hint">正在获取二维码…</p>}
        {flow.phase === "scanning" && (
          <div className="account__qr">
            <img src={flow.image} width={220} height={220} alt="哔哩哔哩登录二维码" />
            <p className="account__hint">{flow.state === "scanned" ? "已扫码，请在手机上点确认。" : "用哔哩哔哩 App 扫码，并在手机上确认登录。二维码 3 分钟内有效。"}</p>
          </div>
        )}
        {flow.phase === "failed" && (
          <p className="account__hint account__hint--bad" role="alert">{flow.message} <Button variant="secondary" onClick={() => void begin()}>重新获取</Button></p>
        )}
      </div>
    </div>
  );
}
