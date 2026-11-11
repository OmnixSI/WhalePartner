/**
 * 模型接入（设置 › 模型接入）。
 *
 * 「接 DeepSeek 的 api」和「调 Codex 的模型和推理强度」摆到界面上：
 *
 * - DeepSeek：只显示「已配置 sk-…abcd / 未配置」，输入框只往上传，**不回显明文**；
 * - Codex：模型和推理档位都是下拉菜单，选项来自 `GET /api/setup/codex/models`；
 *   列表单独拉取，拉取中或失败时已保存的值照样显示，不会清空；
 * - 测试连接：打 `/api/health?probe=1`，告诉你现在实际走的是哪家模型。
 *
 * 接口：`GET /api/setup` 读已保存的值，`GET /api/setup/codex/models` 读
 * 模型列表，`PUT /api/setup/codex` 用 `{ model, effort }` 保存。
 * 数字和状态只有后端一个来源：拿不到就写「现在拿不到」，不自己编模型名。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "../../lib/api";
import {
  defaultEffort,
  defaultModel,
  effortAfterModelChange,
  effortChoices,
  effortsFor,
  findModel,
  modelChoices,
  parseCodexModels,
  type CodexModelOption,
} from "../../lib/codex-model-options";
import { describeNetError } from "../../lib/net";
import { SettingRow } from "./Row";

interface DeepSeekState {
  configured: boolean;
  masked: string | null;
}

/** `model` / `effort` 为空表示还没保存过，推理时用 Codex 列表里的默认模型和默认档位。 */
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

/** 模型列表单独拉：要先拉起本机 Codex，可能慢也可能失败，不能拖住已保存的值。 */
type Catalog = { phase: "loading" } | { phase: "ok"; models: CodexModelOption[] } | { phase: "failed"; message: string };

type Probe =
  | { phase: "idle" }
  | { phase: "busy" }
  | { phase: "done"; provider: string; model: string; note: string }
  | { phase: "failed"; note: string };

const REASONING_EFFORT_LABELS: Record<string, string> = {
  none: "无",
  minimal: "最少",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "超高",
  max: "最高",
  ultra: "极高",
};

function reasoningEffortLabel(effort: string): string {
  return REASONING_EFFORT_LABELS[effort] ?? effort;
}

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
      typeof setup.codex.present === "boolean" &&
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
  const [effortDraft, setEffortDraft] = useState("");
  const [savingCodex, setSavingCodex] = useState(false);
  const [codexError, setCodexError] = useState("");
  const [catalog, setCatalog] = useState<Catalog>({ phase: "loading" });
  const [probe, setProbe] = useState<Probe>({ phase: "idle" });
  const alive = useRef(true);

  const apply = useCallback((data: SetupState) => {
    setState({ phase: "ok", data });
    setModelDraft(data.codex.model);
    setEffortDraft(data.codex.effort);
  }, []);

  /** 模型列表单独拉：列表失败时已保存的 model / effort 仍然留在下拉里。 */
  const loadCatalog = useCallback(async () => {
    setCatalog({ phase: "loading" });
    try {
      const response = await fetch(`${API_BASE}/api/setup/codex/models`);
      if (!response.ok) throw new Error(await errorText(response));
      const models = parseCodexModels(await response.json());
      if (alive.current) setCatalog({ phase: "ok", models });
    } catch (error) {
      if (alive.current) setCatalog({ phase: "failed", message: describeNetError(error, "读不到本机 Codex 的模型列表") });
    }
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
    void loadCatalog();
    return () => {
      alive.current = false;
    };
  }, [load, loadCatalog]);

  // 没保存过模型 / 档位：列表到了以后，下拉先停在 Codex 的默认模型和它的默认档位上（还没保存）。
  useEffect(() => {
    if (state.phase !== "ok" || catalog.phase !== "ok") return;
    const saved = state.data.codex;
    if (saved.model === "") {
      const fallback = defaultModel(catalog.models);
      if (!fallback) return;
      setModelDraft((current) => current || fallback.model);
      setEffortDraft((current) => current || defaultEffort(fallback));
      return;
    }
    if (saved.effort === "") {
      const option = findModel(catalog.models, saved.model);
      if (option) setEffortDraft((current) => current || defaultEffort(option));
    }
  }, [state, catalog]);

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
    if (modelDraft === codex.model && effortDraft === codex.effort) {
      onToast("模型和推理档位都没变。");
      return;
    }
    // 两项一起存：换模型时档位已按新模型回落，后端不会拿到不支持的组合。
    const patch = { model: modelDraft, effort: effortDraft };
    setSavingCodex(true);
    setCodexError("");
    try {
      const response = await fetch(`${API_BASE}/api/setup/codex`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) throw new Error(await errorText(response));
      onToast("已保存。下一轮会按选中的模型和推理档位调用。");
      await load();
    } catch (error) {
      setCodexError(describeNetError(error, "没存上"));
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
        <p className="set-state__desc">接哪家模型、用多大档位，这两项只从后端读；现在拿不到，就不猜给你。</p>
        <button type="button" className="btn btn--secondary" onClick={() => void load()}>
          再试一次
        </button>
      </div>
    );
  }

  const { data } = state;
  const models = catalog.phase === "ok" ? catalog.models : [];
  const modelOption = findModel(models, modelDraft);
  const supportedEfforts = effortsFor(modelOption);
  // 列表还没到或拉取失败：只显示已保存的值（下拉禁用），不判断它在不在列表里。
  const savedOnly = (value: string, text: string) => (value !== "" ? [{ value, label: text, missing: false }] : []);
  const modelOptions = catalog.phase === "ok" ? modelChoices(models, modelDraft) : savedOnly(modelDraft, modelDraft);
  const effortOptions =
    catalog.phase === "ok"
      ? effortChoices(modelOption, effortDraft, reasoningEffortLabel)
      : savedOnly(effortDraft, reasoningEffortLabel(effortDraft));
  const changed = modelDraft !== data.codex.model || effortDraft !== data.codex.effort;
  const canSaveCodex =
    !offline &&
    !savingCodex &&
    catalog.phase === "ok" &&
    Boolean(modelOption) &&
    supportedEfforts.includes(effortDraft) &&
    changed;
  const savedModelMissing = catalog.phase === "ok" && data.codex.model !== "" && !findModel(models, data.codex.model);
  const draftEffortMissing = Boolean(modelOption) && effortDraft !== "" && !supportedEfforts.includes(effortDraft);

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
        desc="大肥鱼调用 Codex 时固定用这里选的模型和推理档位，不跟着你自己的 Codex 走，也不改它的配置。"
        stacked
      >
        <p className="mset__now">
          {data.codex.model ? (
            <>
              现在用 <strong>{data.codex.model}</strong>
              {data.codex.effort ? ` · ${reasoningEffortLabel(data.codex.effort)}` : ""}
            </>
          ) : (
            <>还没选过，用本机 Codex 列表里的默认模型</>
          )}
        </p>
        <div className="mset__form mset__form--codex">
          <div className="mset__item">
            <label className="mset__label" htmlFor="mset-model">
              模型
            </label>
            <select
              id="mset-model"
              className="field mset__select"
              value={modelDraft}
              disabled={offline || savingCodex || catalog.phase !== "ok"}
              onChange={(event) => {
                const next = findModel(models, event.target.value);
                setModelDraft(event.target.value);
                setEffortDraft((current) => effortAfterModelChange(next, current));
              }}
            >
              {modelDraft === "" && (
                <option value="" disabled>
                  {catalog.phase === "loading"
                    ? "正在读模型列表…"
                    : catalog.phase === "failed"
                      ? "模型列表暂时读不到"
                      : modelOptions.length === 0
                        ? "本机 Codex 没有可用模型"
                        : "选择模型"}
                </option>
              )}
              {catalog.phase !== "ok" && modelDraft !== "" && <option value={modelDraft}>{modelDraft}</option>}
              {catalog.phase === "ok" &&
                modelOptions.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
            </select>
          </div>
          <div className="mset__item">
            <label className="mset__label" htmlFor="mset-effort">
              推理档位
            </label>
            <select
              id="mset-effort"
              className="field mset__select"
              value={effortDraft}
              disabled={offline || savingCodex || catalog.phase !== "ok" || !modelOption}
              onChange={(event) => setEffortDraft(event.target.value)}
            >
              {effortDraft === "" && (
                <option value="" disabled>
                  {catalog.phase === "loading"
                    ? "正在读可用档位…"
                    : catalog.phase === "failed"
                      ? "模型列表暂时读不到"
                      : modelOption
                        ? "选择推理档位"
                        : "先选模型"}
                </option>
              )}
              {catalog.phase !== "ok" && effortDraft !== "" && (
                <option value={effortDraft}>{reasoningEffortLabel(effortDraft)}</option>
              )}
              {catalog.phase === "ok" &&
                effortOptions.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
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
            {savingCodex ? "正在存…" : "保存"}
          </button>
        </div>
        {catalog.phase === "loading" && (
          <p className="mset__hint" role="status">
            正在读本机 Codex 的模型列表…
          </p>
        )}
        {catalog.phase === "failed" && (
          <div className="mset__error" role="alert">
            <p className="set-row__bad">{catalog.message}</p>
            <p className="mset__hint">已保存的设置不受影响，照常使用。</p>
            <button type="button" className="btn btn--secondary" disabled={offline} onClick={() => void loadCatalog()}>
              重试
            </button>
          </div>
        )}
        {savedModelMissing && (
          <p className="set-row__bad" role="status">
            已保存的模型 {data.codex.model} 不在当前列表里，调用会失败；请换一个再保存。
          </p>
        )}
        {draftEffortMissing && (
          <p className="set-row__bad" role="status">
            推理档位 {reasoningEffortLabel(effortDraft)} 不在这个模型的可用档位里，请重新选择。
          </p>
        )}
        <p className="mset__path">大肥鱼自己的设置文件：{data.codex.configPath}</p>
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
