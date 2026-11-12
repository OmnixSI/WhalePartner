/** 「连接到我的鲸汐」：输入家里 hub 的地址和 6 位配对码，换取长期设备 token。 */
import { useState } from "react";
import { defaultDeviceName, pairWithHub, remoteConnection, setRemoteConnection } from "../../lib/api";
import { SettingRow } from "./Row";
import { Button } from "../ui/Button";
import { Input } from "../ui/Field";

export function ConnectServerSetting({ onToast }: { onToast?: (text: string) => void }) {
  const current = remoteConnection();
  const [url, setUrl] = useState(current?.url ?? "");
  const [code, setCode] = useState("");
  const [name, setName] = useState(defaultDeviceName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      const connection = await pairWithHub(url, code, name);
      setRemoteConnection(connection);
      onToast?.("连上了。");
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "连接失败。");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = () => {
    setRemoteConnection(null);
    window.location.reload();
  };

  return (
    <SettingRow
      title="连接到我的鲸汐"
      desc={current ? `现在连着：${current.url || "本页所在的服务器"}。` : "已经在别的地方运行了鲸汐？输入它的地址和配对码，这台设备就和那边同步。"}
      stacked
    >
      <div className="set-fields">
        <label className="sr-only" htmlFor="hub-url">鲸汐的地址</label>
        <Input id="hub-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://home.example.com 或 http://192.168.1.8:8787" inputMode="url" autoComplete="off" />
        <label className="sr-only" htmlFor="hub-code">配对码</label>
        <Input id="hub-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6 位配对码" inputMode="numeric" autoComplete="one-time-code" />
        <label className="sr-only" htmlFor="hub-name">这台设备叫什么</label>
        <Input id="hub-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        <div className="set-actions">
          {current && (
            <Button variant="ghost" onClick={disconnect}>
              断开，回到本机
            </Button>
          )}
          <Button variant="primary" onClick={() => void connect()} disabled={busy || code.length !== 6 || !url.trim()}>
            {busy ? "连接中…" : "连接"}
          </Button>
        </div>
        {error && <p className="set-row__desc" role="alert">{error}</p>}
      </div>
    </SettingRow>
  );
}
