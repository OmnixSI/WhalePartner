/**
 * 模型接入（设置 › 模型接入）。
 *
 * 「接 DeepSeek 的 api」和「调 Codex 的模型和推理强度」以前只躺在 `.env` 和
 * `~/.codex/config.toml` 里，界面上完全看不见。这里把它们摆出来：
 *
 * - DeepSeek：只显示「已配置 sk-…abcd / 未配置」，输入框只往上传，**不回显明文**；
 * - Codex：显示现在用的 model + effort，能改就写回 config.toml；
 * - 测试连接：打 `/api/health?probe=1`，告诉你现在实际走的是哪家模型。
 *
 * 数字和状态只有后端一个来源：拿不到就写「现在拿不到」，不自己编。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "../../lib/api";
import { describeNetError } from "../../lib/net";
import { SettingRow } from "./Row";

const EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORTS)[number];

const EFFORT_LABEL: Record<Effort, string> = {
  minimal: "minimal · 最快",
  low: "low · 轻",
  medium: "medium · 中",
  high: "high · 高",
  xhigh: "xhigh · 更高",
  max: "max · 最高",
};

interface DeepSeekState {
  configured: boolean;
  masked: string | null;
}

interface CodexState {
  model: string;
  effort: string;
  configPath: string;
  present: boolean;
}

interface SetupState {
  deepseek: DeepSeekState;
  codex: CodexState;
  chain: string[];
}

type Phase = { phase: "loading" } | { phase: "ok"; data: SetupState } | { phase: "down" };

type Probe =
  | { phase: "idle" }
  | { phase: "busy" }
  | { phase: "done"; provider: string; model: string; note: string }
  | { phase: "failed"; note: string };

function isSetup(value: unknown): value is SetupState {
  const setup = value as Partial<SetupState> | null;
  return Boolean(
    setup &&
      typeof setup.deepseek === "object" &&
      setup.deepseek !== null &&
      typeof setup.deepseek.configured === "boolean" &&
      typeof setup.codex === "object" &&
      setup.codex !== null &&
      typeof setup.codex.model === "string" &&
      typeof setup.codex.effort === "string" &&
      typeof setup.codex.configPath === "string" &&
      Array.isArray(setup.chain),
  );
}

/** 后端把错误写成 `{ error, message }`；拿不到 JSON 就退回状态码。 */
async function errorText(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string; error?: string };
    return body.message ?? body.error ?? `请求失败（HTTP ${response.status}）`;
  } catch {
    return `请求失败（HTTP ${response.status}）`;
  }
}

const isEffort = (value: string): value is Effort => (EFFORTS as readonly string[]).includes(value);

type Props = {
  /** 后端探测不到：输入和按钮一并禁用 */
  offline: boolean;
  onToast: (text: string) => void;
};

export function ModelSetup({ offline, onToast }: Props) {
  const [state, setState] = useState<Phase>({ phase: "loading" });
  const [key, setKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [keyError, setKeyError] = useState("");
  const [modelDraft, setModelDraft] = useState("");
  const [effortDraft, setEffortDraft] = useState<Effort | "">("");
  const [savingCodex, setSavingCodex] = useState(false);
  const [codexError, setCodexError] = useState("");
  const [probe, setProbe] = useState<Probe>({ phase: "idle" });
  const alive = useRef(true);

  const apply = useCallback((data: SetupState) => {
    setState({ phase: "ok", data });
    setModelDraft(data.codex.model);
    setEffortDraft(isEffort(data.codex.effort) ? data.codex.effort : "");
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/setup`);
      if (!response.ok) {
        if (alive.current) setState({ phase: "down" });
        return;
      }
      const body: unknown = await response.json();
      if (!alive.current) return;
      // 形状不对（后端还没上、或代理回了别的东西）也按「拿不到」处理：宁可空着，也不印错值。
      if (isSetup(body)) apply(body);
      else setState({ phase: "down" });
    } catch {
      if (alive.current) setState({ phase: "down" });
    }
  }, [apply]);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  const saveKey = async () => {
    if (offline || savingKey) return;
    setSavingKey(true);
    setKeyError("");
    try {
      const response = await fetch(`${API_BASE}/api/setup/deepseek`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key.trim() }),
      });
      if (!response.ok) throw new Error(await errorText(response));
      setKey("");
      onToast("DeepSeek key 记下了。重启后端才会用上新的。");
      await load();
    } catch (error) {
      setKeyError(describeNetError(error, "key 没存上"));
    } finally {
      setSavingKey(false);
    }
  };

  const saveCodex = async () => {
    if (offline || savingCodex || state.phase !== "ok") return;
    const { codex } = state.data;
    const patch: { model?: string; effort?: string } = {};
    const model = modelDraft.trim();
    if (model && model !== codex.model) patch.model = model;
    if (effortDraft && effortDraft !== codex.effort) patch.effort = effortDraft;
    if (patch.model === undefined && patch.effort === undefined) {
      onToast("模型和推理强度都没变。");
      return;
    }
    setSavingCodex(true);
    setCodexError("");
    try {
      const response = await fetch(`${API_BASE}/api/setup/codex`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) throw new Error(await errorText(response));
      onToast("写进 Codex 了。下一轮就会按新的模型来。");
      await load();
    } catch (error) {
      setCodexError(describeNetError(error, "没写进 Codex"));
    } finally {
      setSavingCodex(false);
    }
  };

  const runProbe = async () => {
    setProbe({ phase: "busy" });
    try {
      const response = await fetch(`${API_BASE}/api/health?probe=1`);
      if (!response.ok) throw new Error("bad status");
      const body = (await response.json()) as {
        provider?: string;
        model?: string;
        probe?: { checked?: boolean; modelAvailable?: boolean };
      };
      if (!alive.current) return;
      if (body.probe?.checked === false) {
        setProbe({ phase: "done", provider: body.provider ?? "未知", model: body.model ?? "未知", note: "服务连上了，但它不报可用模型清单。" });
      } else if (body.probe?.modelAvailable === false) {
        setProbe({ phase: "done", provider: body.provider ?? "未知", model: body.model ?? "未知", note: "服务连上了，但它的模型清单里没有这个名字。" });
      } else {
        setProbe({ phase: "done", provider: body.provider ?? "未知", model: body.model ?? "未知", note: "服务连上了，模型也在清单里。" });
      }
    } catch {
      if (alive.current) setProbe({ phase: "failed", note: "连不上后端。等服务起来再试。" });
    }
  };

  if (state.phase === "loading") {
    return (
      <p className="set-quota__loading" role="status">
        正在读模型设置…
      </p>
    );
  }

  if (state.phase === "down") {
    return (
      <div className="set-state" role="status">
        <p className="set-state__title">模型设置暂时看不到</p>
        <p className="set-state__desc">接哪家模型、用多大强度，这两项只从后端读；现在拿不到，就不猜给你。</p>
        <button type="button" className="btn btn--secondary" onClick={() => void load()}>
          再试一次
        </button>
      </div>
    );
  }

  const { data } = state;
  const modelChanged = modelDraft.trim() !== "" && modelDraft.trim() !== data.codex.model;
  const effortChanged = effortDraft !== "" && effortDraft !== data.codex.effort;
  const canSaveCodex = !offline && !savingCodex && (modelChanged || effortChanged);

  return (
    <div className="mset">
      <SettingRow
        icon="conch"
        title="DeepSeek"
        desc="聊天默认走它。key 只写进后端的 .env，页面上只看得到后四位。"
        stacked
      >
        <p className="mset__status" data-on={data.deepseek.configured ? "on" : "off"}>
          <span className="mset__dot" aria-hidden="true" />
          <span>{data.deepseek.configured ? `已配置 ${data.deepseek.masked ?? ""}` : "未配置"}</span>
        </p>
        <div className="mset__form">
          <input
            className="field mset__field"
            type="password"
            name="deepseek-key"
            autoComplete="off"
            spellCheck={false}
            maxLength={200}
            placeholder={data.deepseek.configured ? "换一个新 key（sk-…）" : "贴上 sk- 开头的 key"}
            aria-label="DeepSeek API Key"
            value={key}
            disabled={offline || savingKey}
            onChange={(event) => setKey(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void saveKey();
              }
            }}
          />
          <button
            type="button"
            className="btn btn--secondary mset__save"
            disabled={offline || savingKey || key.trim() === ""}
            onClick={() => void saveKey()}
          >
            {savingKey ? "正在存…" : "保存"}
          </button>
        </div>
        <p className="mset__hint">保存后要重启后端才生效；key 不会出现在页面、日志或返回值里。</p>
        {keyError && (
          <p className="set-row__bad" role="alert">
            {keyError}
          </p>
        )}
      </SettingRow>

      <SettingRow
        icon="settings"
        title="Codex"
        desc="模型和推理强度写在本机 Codex 的配置里，改完下一轮调用就按新的来。"
        stacked
      >
        <p className="mset__now">
          {data.codex.present ? (
            <>
              现在用 <strong>{data.codex.model || "（没写 model）"}</strong>
              {data.codex.effort ? ` · ${EFFORT_LABEL[data.codex.effort as Effort] ?? data.codex.effort}` : ""}
            </>
          ) : (
            "还没有这个配置文件，保存就会新建一个。"
          )}
        </p>
        <div className="mset__form mset__form--codex">
          <div className="mset__item">
            <label className="mset__label" htmlFor="mset-model">
              模型
            </label>
            <input
              id="mset-model"
              className="field mset__field"
              type="text"
              maxLength={64}
              spellCheck={false}
              placeholder="例如 gpt-6-luna"
              value={modelDraft}
              disabled={offline || savingCodex}
              onChange={(event) => setModelDraft(event.target.value)}
            />
          </div>
          <div className="mset__item">
            <label className="mset__label" htmlFor="mset-effort">
              推理强度
            </label>
            <select
              id="mset-effort"
              className="field mset__select"
              value={effortDraft}
              disabled={offline || savingCodex}
              onChange={(event) => setEffortDraft(isEffort(event.target.value) ? event.target.value : "")}
            >
              <option value="" disabled>
                还没设置
              </option>
              {EFFORTS.map((value) => (
                <option key={value} value={value}>
                  {EFFORT_LABEL[value]}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn btn--secondary mset__save"
            disabled={!canSaveCodex}
            onClick={() => void saveCodex()}
          >
            {savingCodex ? "正在写…" : "保存"}
          </button>
        </div>
        <p className="mset__path">{data.codex.configPath}</p>
        {codexError && (
          <p className="set-row__bad" role="alert">
            {codexError}
          </p>
        )}
      </SettingRow>

      <SettingRow icon="lighthouse" title="测试连接" desc="问一句后端：现在实际在用哪家模型。不会真的发一次聊天。" stacked>
        <div className="mset__form">
          <button
            type="button"
            className="btn btn--secondary"
            disabled={offline || probe.phase === "busy"}
            onClick={() => void runProbe()}
          >
            {probe.phase === "busy" ? "正在问…" : "测试连接"}
          </button>
        </div>
        {probe.phase === "done" && (
          <p className="mset__probe" role="status">
            现在用的是 {probe.provider} · {probe.model}。{probe.note}
          </p>
        )}
        {probe.phase === "failed" && (
          <p className="set-row__bad" role="status">
            {probe.note}
          </p>
        )}
        <p className="mset__hint">模型链：{data.chain.length > 0 ? data.chain.join(" → ") : "（没有可用的模型）"}</p>
      </SettingRow>
    </div>
  );
}
