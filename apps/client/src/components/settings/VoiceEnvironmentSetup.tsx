import { useCallback, useEffect, useState } from "react";
import { API_BASE } from "../../lib/api";
import { describeNetError } from "../../lib/net";
import { SettingRow } from "./Row";

type ModelStatus = {
  state: "idle" | "waiting_reference" | "loading" | "ready" | "failed";
  progress: number | null;
  message: string;
  model: string;
};

type VoiceStatuses = { asr: ModelStatus | null; tts: ModelStatus | null };
type Action = "setup" | "rebuild";

function statusLabel(status: ModelStatus | null): string {
  if (!status) return "状态未连接";
  switch (status.state) {
    case "ready": return "已就绪";
    case "loading": return "准备中";
    case "failed": return "需要处理";
    case "waiting_reference": return "等待音色";
    default: return "未配置";
  }
}

async function readStatus(path: string): Promise<ModelStatus> {
  const response = await fetch(`${API_BASE}/api/voice/${path}/status`);
  if (!response.ok) throw new Error(`读取${path === "asr" ? "转写" : "语音回复"}状态失败（HTTP ${response.status}）。`);
  return await response.json() as ModelStatus;
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { message?: string };
    return body.message ?? `请求失败（HTTP ${response.status}）。`;
  } catch {
    return `请求失败（HTTP ${response.status}）。`;
  }
}

type Props = { offline: boolean };

export function VoiceEnvironmentSetup({ offline }: Props) {
  const [statuses, setStatuses] = useState<VoiceStatuses>({ asr: null, tts: null });
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState("");
  const allReady = statuses.asr?.state === "ready" && statuses.tts?.state === "ready";

  const load = useCallback(async () => {
    const [asr, tts] = await Promise.allSettled([readStatus("asr"), readStatus("tts")]);
    setStatuses({
      asr: asr.status === "fulfilled" ? asr.value : null,
      tts: tts.status === "fulfilled" ? tts.value : null,
    });
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => { void load(); }, 2_000);
    return () => window.clearInterval(timer);
  }, [busy, load]);

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
      setError(describeNetError(cause, "语音环境请求失败，请检查连接后重试。"));
    } finally {
      await load();
      setBusy(null);
    }
  };

  return (
    <div className="voice-env">
      <SettingRow title="语音转写 · X-ASR" desc={statuses.asr?.message ?? "现在拿不到转写模型状态。"}>
        <span className="voice-env__state" data-state={statuses.asr?.state ?? "idle"} role="status">
          {statusLabel(statuses.asr)}
        </span>
      </SettingRow>
      <SettingRow title="语音回答 · CosyVoice3" desc={statuses.tts?.message ?? "现在拿不到语音模型状态。"}>
        <span className="voice-env__state" data-state={statuses.tts?.state ?? "idle"} role="status">
          {statusLabel(statuses.tts)}
        </span>
      </SettingRow>
      <div className="voice-env__actions">
        {!allReady && (
          <button type="button" className="btn btn--primary" disabled={offline || busy !== null} onClick={() => void run("setup")}>
            {busy === "setup" ? "正在配置…" : "一键配置"}
          </button>
        )}
        <button type="button" className="btn btn--secondary" disabled={offline || busy !== null} onClick={() => void run("rebuild")}>
          {busy === "rebuild" ? "正在重建…" : "重建语音环境"}
        </button>
      </div>
      {error && <p className="set-row__bad" role="alert">{error}</p>}
      <p className="voice-env__note">首次配置需要联网下载约 2.8 GB 语音权重并构建本机运行时。CosyVoice 需要 macOS 15 或更新版本的 Apple Silicon Mac。重建只替换语音模型与运行时，不会删除音色、记忆或聊天数据。</p>
    </div>
  );
}
