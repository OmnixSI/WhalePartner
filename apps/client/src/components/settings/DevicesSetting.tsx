/** 「我的设备」：添加设备（二维码 + 6 位配对码，10 分钟有效）、查看与撤销已配对设备。 */
import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";
import { API_BASE } from "../../lib/api";
import { describeNetError } from "../../lib/net";
import { useHubRefresh } from "../../lib/useHubRefresh";
import { SettingRow } from "./Row";
import { Button } from "../ui/Button";
import { locale, m } from "../../i18n";

interface Device { id: string; name: string; createdAt: string; lastSeenAt: string | null }
interface Pairing { code: string; expiresAt: string; image: string; address: string; addresses: string[] }

const dayLabel = (iso: string | null) => (iso ? new Date(iso).toLocaleString(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : m.setup.devices.neverUsed);

export function DevicesSetting({ offline = false }: { offline?: boolean }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/devices`);
      if (!response.ok) throw new Error(m.setup.devices.readFailedHttp(response.status));
      setDevices(((await response.json()) as { devices: Device[] }).devices);
      setError("");
    } catch (e) {
      setError(describeNetError(e, m.setup.devices.readFailed));
    }
  }, []);

  useEffect(() => {
    if (!offline) void refresh();
  }, [offline, refresh]);

  // 别的设备配对 / 撤销时 hub 会发 settings.updated：直接订阅 hub（设置页上没有聊天面板替它转发）。
  useHubRefresh(["settings.updated"], () => {
    if (!offline) void refresh();
  });

  useEffect(() => {
    if (!pairing) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pairing]);

  const render = async (code: string, expiresAt: string, addresses: string[], address: string) => {
    const link = `${address}/?pair=${code}`;
    const image = await QRCode.toDataURL(link, { margin: 1, width: 220, color: { dark: "#17222d", light: "#ffffff" } });
    setPairing({ code, expiresAt, image, address, addresses });
  };

  const add = async () => {
    setError("");
    try {
      const response = await fetch(`${API_BASE}/api/pair/create`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error(m.setup.devices.createFailedHttp(response.status));
      const body = (await response.json()) as { code: string; expiresAt: string; addresses: string[] };
      const origin = /^https?:/.test(window.location.origin) && !("__TAURI_INTERNALS__" in window) ? window.location.origin : "";
      const remote = API_BASE.startsWith("http") && !/127\.0\.0\.1|localhost/.test(API_BASE) ? API_BASE : "";
      const choices = [...new Set([remote, origin, ...body.addresses].filter(Boolean))].filter((a) => !/127\.0\.0\.1|localhost/.test(a) || body.addresses.length === 0);
      await render(body.code, body.expiresAt, choices, choices[0] ?? "http://127.0.0.1:8787");
    } catch (e) {
      setError(describeNetError(e, m.setup.devices.createFailed));
    }
  };

  const revoke = async (device: Device) => {
    try {
      const response = await fetch(`${API_BASE}/api/devices/${encodeURIComponent(device.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(m.setup.devices.revokeFailedHttp(response.status));
      await refresh();
    } catch (e) {
      setError(describeNetError(e, m.setup.devices.revokeFailed));
    }
  };

  const left = pairing ? Math.max(0, Math.round((Date.parse(pairing.expiresAt) - now) / 1000)) : 0;

  return (
    <>
      <SettingRow title={m.setup.devices.addTitle} desc={m.setup.devices.addDesc} stacked={Boolean(pairing)}>
        {!pairing ? (
          <Button variant="secondary" onClick={() => void add()} disabled={offline}>
            {m.setup.devices.add}
          </Button>
        ) : (
          <div className="set-fields">
            <img src={pairing.image} alt={m.setup.devices.qrAlt} width={220} height={220} />
            <p className="set-row__title" aria-live="polite">{m.setup.devices.pairCode(pairing.code)}</p>
            <p className="set-row__desc">{left > 0 ? m.setup.devices.validFor(`${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`) : m.setup.devices.expired}</p>
            {pairing.addresses.length > 1 && (
              <select className="ui-input set-select" value={pairing.address} aria-label={m.setup.devices.addressLabel} onChange={(e) => void render(pairing.code, pairing.expiresAt, pairing.addresses, e.target.value)}>
                {pairing.addresses.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            )}
            <p className="set-row__desc">{m.setup.devices.addressNote(pairing.address)}</p>
            <div className="set-actions">
              <Button variant="ghost" onClick={() => setPairing(null)}>{m.setup.devices.collapse}</Button>
              <Button variant="secondary" onClick={() => void add()}>{m.setup.devices.newCode}</Button>
            </div>
          </div>
        )}
      </SettingRow>
      {devices.map((device) => (
        <SettingRow key={device.id} title={device.name} desc={m.setup.devices.deviceDesc(dayLabel(device.createdAt), dayLabel(device.lastSeenAt))}>
          <Button variant="ghost" onClick={() => void revoke(device)}>
            {m.setup.devices.revoke}
          </Button>
        </SettingRow>
      ))}
      {error && <p className="set-row__desc" role="alert">{error}</p>}
    </>
  );
}
