/** 「连接到我的鲸汐」：输入家里 hub 的地址和 6 位配对码，换取长期设备 token。 */
import { useState } from "react";
import { defaultDeviceName, pairWithHub, remoteConnection, setRemoteConnection } from "../../lib/api";
import { SettingRow } from "./Row";
import { Button } from "../ui/Button";
import { m } from "../../i18n";
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
      onToast?.(m.setup.connect.toastConnected);
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : m.setup.connect.failed);
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
      title={m.setup.connect.title}
      desc={current ? m.setup.connect.descConnected(current.url) : m.setup.connect.descIdle}
      stacked
    >
      <div className="set-fields">
        <label className="sr-only" htmlFor="hub-url">{m.setup.connect.urlLabel}</label>
        <Input id="hub-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={m.setup.connect.urlPlaceholder} inputMode="url" autoComplete="off" />
        <label className="sr-only" htmlFor="hub-code">{m.setup.connect.codeLabel}</label>
        <Input id="hub-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder={m.setup.connect.codePlaceholder} inputMode="numeric" autoComplete="one-time-code" />
        <label className="sr-only" htmlFor="hub-name">{m.setup.connect.nameLabel}</label>
        <Input id="hub-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        <div className="set-actions">
          {current && (
            <Button variant="ghost" onClick={disconnect}>
              {m.setup.connect.disconnect}
            </Button>
          )}
          <Button variant="primary" onClick={() => void connect()} disabled={busy || code.length !== 6 || !url.trim()}>
            {busy ? m.setup.connect.connecting : m.setup.connect.connect}
          </Button>
        </div>
        {error && <p className="set-row__desc" role="alert">{error}</p>}
      </div>
    </SettingRow>
  );
}
