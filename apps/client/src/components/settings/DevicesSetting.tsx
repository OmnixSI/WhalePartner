/** 「我的设备」：添加设备（二维码 + 6 位配对码，10 分钟有效）、查看与撤销已配对设备。 */
import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";
import { API_BASE } from "../../lib/api";
import { describeNetError } from "../../lib/net";
import { useHubRefresh } from "../../lib/useHubRefresh";
import { SettingRow } from "./Row";

interface Device { id: string; name: string; createdAt: string; lastSeenAt: string | null }
interface Pairing { code: string; expiresAt: string; image: string; address: string; addresses: string[] }

const dayLabel = (iso: string | null) => (iso ? new Date(iso).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "还没用过");

export function DevicesSetting({ offline = false }: { offline?: boolean }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/devices`);
      if (!response.ok) throw new Error(`读取设备失败（HTTP ${response.status}）。`);
      setDevices(((await response.json()) as { devices: Device[] }).devices);
      setError("");
    } catch (e) {
      setError(describeNetError(e, "读取设备失败"));
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
      if (!response.ok) throw new Error(`生成配对码失败（HTTP ${response.status}）。`);
      const body = (await response.json()) as { code: string; expiresAt: string; addresses: string[] };
      const origin = /^https?:/.test(window.location.origin) && !("__TAURI_INTERNALS__" in window) ? window.location.origin : "";
      const remote = API_BASE.startsWith("http") && !/127\.0\.0\.1|localhost/.test(API_BASE) ? API_BASE : "";
      const choices = [...new Set([remote, origin, ...body.addresses].filter(Boolean))].filter((a) => !/127\.0\.0\.1|localhost/.test(a) || body.addresses.length === 0);
      await render(body.code, body.expiresAt, choices, choices[0] ?? "http://127.0.0.1:8787");
    } catch (e) {
      setError(describeNetError(e, "生成配对码失败"));
    }
  };

  const revoke = async (device: Device) => {
    try {
      const response = await fetch(`${API_BASE}/api/devices/${encodeURIComponent(device.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(`撤销失败（HTTP ${response.status}）。`);
      await refresh();
    } catch (e) {
      setError(describeNetError(e, "撤销失败"));
    }
  };

  const left = pairing ? Math.max(0, Math.round((Date.parse(pairing.expiresAt) - now) / 1000)) : 0;

  return (
    <>
      <SettingRow icon="phone" title="添加设备" desc="手机或另一台电脑扫码，或在「连接到我的鲸汐」里输入地址和配对码；数据都留在这台，各设备实时同步。" stacked={Boolean(pairing)}>
        {!pairing ? (
          <button type="button" className="btn btn--secondary" onClick={() => void add()} disabled={offline}>
            添加设备
          </button>
        ) : (
          <div className="set-fields">
            <img src={pairing.image} alt="配对二维码" width={220} height={220} />
            <p className="set-row__title" aria-live="polite">配对码 {pairing.code}</p>
            <p className="set-row__desc">{left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} 内有效，只能用一次。` : "已过期，重新生成一个。"}</p>
            {pairing.addresses.length > 1 && (
              <select className="field" value={pairing.address} aria-label="对方用哪个地址访问" onChange={(e) => void render(pairing.code, pairing.expiresAt, pairing.addresses, e.target.value)}>
                {pairing.addresses.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            )}
            <p className="set-row__desc">对方要能访问到 {pairing.address}。不在同一个 Wi-Fi 时，请先看 docs/DEPLOY.md 把这台暴露出去。</p>
            <div className="pop__actions">
              <button type="button" className="btn btn--quiet" onClick={() => setPairing(null)}>收起</button>
              <button type="button" className="btn btn--secondary" onClick={() => void add()}>换一个码</button>
            </div>
          </div>
        )}
      </SettingRow>
      {devices.map((device) => (
        <SettingRow key={device.id} title={device.name} desc={`加入于 ${dayLabel(device.createdAt)} · 最近使用 ${dayLabel(device.lastSeenAt)}`}>
          <button type="button" className="btn btn--quiet" onClick={() => void revoke(device)}>
            撤销
          </button>
        </SettingRow>
      ))}
      {error && <p className="set-row__desc" role="alert">{error}</p>}
    </>
  );
}
