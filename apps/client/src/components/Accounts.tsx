import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { checkLogin, fetchAccounts, logout, startLogin, type AccountStatus, type LoginState } from "../lib/accounts";
import { describeNetError } from "../lib/net";
import { Button } from "./ui/Button";
import { locale, m } from "../i18n";

const POLL_MS = 2500;

type Flow =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "scanning"; key: string; image: string; state: Extract<LoginState, "waiting" | "scanned"> }
  | { phase: "failed"; message: string };

const when = (iso: string | null) => {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(locale, { month: "long", day: "numeric" });
};

function statusLine(account: AccountStatus | undefined, loading: boolean) {
  if (!account) return loading ? m.common.accounts.reading : m.common.accounts.unreachable;
  if (!account.connected) return m.common.accounts.notSignedIn;
  if (account.valid === false) return m.common.accounts.invalid;
  return m.common.accounts.signedIn(account.savedAt ? when(account.savedAt) : "");
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
        } else if (state === "expired") setFlow({ phase: "failed", message: m.common.accounts.qrExpired });
        else if (state === "error") setFlow({ phase: "failed", message: m.common.accounts.loginFailed });
        else setFlow((current) => (current.phase === "scanning" && current.key === scanKey ? { ...current, state } : current));
      } catch (error) {
        if (!ctrl.signal.aborted) setFlow({ phase: "failed", message: describeNetError(error, m.common.accounts.pollFailed) });
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
      if (!cancelled.current) setFlow({ phase: "failed", message: describeNetError(error, m.common.accounts.qrFailed) });
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
      <p className="set-row__desc">{m.common.accounts.privacy}</p>
      <div className="account">
        <div className="account__head">
          <div>
            <div className="account__name">{m.common.accounts.bilibili}</div>
            <div className="account__status">{statusLine(bilibili, loading)}</div>
          </div>
          <div className="account__actions">
            {bilibili && needsLogin && !busy && <Button variant="primary" onClick={() => void begin()}>{m.common.accounts.scanLogin}</Button>}
            {bilibili?.connected && !busy && <Button variant={confirmingLogout ? "danger" : "secondary"} onClick={() => void signOut()} onBlur={() => setConfirmingLogout(false)}>{confirmingLogout ? m.common.accounts.confirmSignOut : m.common.accounts.signOut}</Button>}
            {busy && <Button variant="ghost" onClick={() => setFlow({ phase: "idle" })}>{m.common.accounts.cancel}</Button>}
          </div>
        </div>
        {flow.phase === "starting" && <p className="account__hint">{m.common.accounts.fetchingQr}</p>}
        {flow.phase === "scanning" && (
          <div className="account__qr">
            <img src={flow.image} width={220} height={220} alt={m.common.accounts.qrAlt} />
            <p className="account__hint">{flow.state === "scanned" ? m.common.accounts.scanned : m.common.accounts.scanHint}</p>
          </div>
        )}
        {flow.phase === "failed" && (
          <p className="account__hint account__hint--bad" role="alert">{flow.message} <Button variant="secondary" onClick={() => void begin()}>{m.common.accounts.refetch}</Button></p>
        )}
      </div>
    </div>
  );
}
