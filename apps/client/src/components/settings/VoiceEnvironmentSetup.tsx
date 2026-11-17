import { useCallback, useEffect, useState } from "react";
import { API_BASE } from "../../lib/api";
import { describeNetError } from "../../lib/net";
import { SettingRow } from "./Row";
import { Button } from "../ui/Button";
import { m } from "../../i18n";

type ModelStatus = {
  state: "idle" | "waiting_reference" | "loading" | "ready" | "failed";
  progress: number | null;
  message: string;
  model: string;
};

type VoiceStatuses = { asr: ModelStatus | null; tts: ModelStatus | null };
type Action = "setup" | "rebuild";

function statusLabel(status: ModelStatus | null): string {
  if (!status) return m.setup.voice.statusDisconnected;
  switch (status.state) {
    case "ready": return m.setup.voice.statusReady;
    case "loading": return m.setup.voice.statusLoading;
    case "failed": return m.setup.voice.statusFailed;
    case "waiting_reference": return m.setup.voice.statusWaitingReference;
    default: return m.setup.voice.statusIdle;
  }
}

async function readStatus(path: "asr" | "tts"): Promise<ModelStatus> {
  const response = await fetch(`${API_BASE}/api/voice/${path}/status`);
  if (!response.ok) throw new Error(m.setup.voice.readStatusFailed(path, response.status));
  return await response.json() as ModelStatus;
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { message?: string };
    return body.message ?? m.setup.voice.requestFailed(response.status);
  } catch {
    return m.setup.voice.requestFailed(response.status);
  }
}

type Props = { offline: boolean };

export function VoiceEnvironmentSetup({ offline }: Props) {
  const [statuses, setStatuses] = useState<VoiceStatuses>({ asr: null, tts: null });
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState("");
  const allReady = statuses.asr?.state === "ready" && statuses.tts?.state === "ready";
  const loading = statuses.asr?.state === "loading" || statuses.tts?.state === "loading";

  const load = useCallback(async () => {
    const [asr, tts] = await Promise.allSettled([readStatus("asr"), readStatus("tts")]);
    setStatuses({
      asr: asr.status === "fulfilled" ? asr.value : null,
      tts: tts.status === "fulfilled" ? tts.value : null,
    });
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!busy && !allReady && !loading) return;
    const timer = window.setInterval(() => { void load(); }, busy || loading ? 2_000 : 10_000);
    return () => window.clearInterval(timer);
  }, [allReady, busy, load, loading]);

  const run = async (action: Action) => {
    if (offline || busy) return;
    setBusy(action);
    setError("");
    const endpoint = action === "setup" ? "warm" : "rebuild";
    try {
      const results = await Promise.all([
        fetch(`${API_BASE}/api/voice/asr/${endpoint}`, { method: "POST" }),
        fetch(`${API_BASE}/api/voice/tts/${endpoint}`, { method: "POST" }),
      ]);
      const failures = await Promise.all(results.filter((response) => !response.ok).map(responseError));
      if (failures.length) setError(failures.join(" "));
    } catch (cause) {
      setError(describeNetError(cause, m.setup.voice.requestError));
    } finally {
      await load();
      setBusy(null);
    }
  };

  return (
    <div className="voice-env">
      <SettingRow title={m.setup.voice.asrTitle} desc={statuses.asr?.message ?? m.setup.voice.asrUnavailable}>
        <span className="voice-env__state" data-state={statuses.asr?.state ?? "idle"} role="status">
          {statusLabel(statuses.asr)}
        </span>
      </SettingRow>
      <SettingRow title={m.setup.voice.ttsTitle} desc={statuses.tts?.message ?? m.setup.voice.ttsUnavailable}>
        <span className="voice-env__state" data-state={statuses.tts?.state ?? "idle"} role="status">
          {statusLabel(statuses.tts)}
        </span>
      </SettingRow>
      <div className="voice-env__actions">
        {!allReady && (
          <Button variant="primary" disabled={offline || busy !== null} onClick={() => void run("setup")}>
            {busy === "setup" ? m.setup.voice.settingUp : m.setup.voice.setup}
          </Button>
        )}
        <Button variant="secondary" disabled={offline || busy !== null} onClick={() => void run("rebuild")}>
          {busy === "rebuild" ? m.setup.voice.rebuilding : m.setup.voice.rebuild}
        </Button>
      </div>
      {error && <p className="set-row__bad" role="alert">{error}</p>}
      <p className="voice-env__note">{m.setup.voice.note}</p>
    </div>
  );
}
