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
  catalogFailureHint,
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
import { Button } from "../ui/Button";
import { Input } from "../ui/Field";
import { m } from "../../i18n";

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
type Catalog = { phase: "loading" } | { phase: "ok"; models: CodexModelOption[] } | { phase: "failed"; message: string; hint: string };

type Probe =
  | { phase: "idle" }
  | { phase: "busy" }
  | { phase: "done"; provider: string; model: string; note: string }
  | { phase: "failed"; note: string };

function reasoningEffortLabel(effort: string): string {
  return m.setup.model.effort[effort] ?? effort;
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
    return body.message ?? body.error ?? m.setup.model.requestFailedHttp(response.status);
  } catch {
    return m.setup.model.requestFailedHttp(response.status);
  }
}

type Props = {
  /** 后端探测不到：输入和按钮一并禁用 */
  offline: boolean;
  onToast: (text: string) => void;
  /** 模型相关设置存成功后通知上层（设置页顶部的概览据此重读当前模型）。 */
  onSaved?: () => void;
};

export function ModelSetup({ offline, onToast, onSaved }: Props) {
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
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string; error?: string; kind?: string };
        const message = body.message ?? body.error ?? m.setup.model.requestFailedHttp(response.status);
        if (alive.current) setCatalog({ phase: "failed", message, hint: catalogFailureHint(body.kind) });
        return;
      }
      const models = parseCodexModels(await response.json());
      if (alive.current) setCatalog({ phase: "ok", models });
    } catch (error) {
      if (alive.current) setCatalog({ phase: "failed", message: describeNetError(error, m.setup.model.catalogReadFailed), hint: catalogFailureHint(undefined) });
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
      onToast(m.setup.model.keySavedToast);
      await load();
      onSaved?.();
    } catch (error) {
      setKeyError(describeNetError(error, m.setup.model.keySaveFailed));
    } finally {
      setSavingKey(false);
    }
  };

  const saveCodex = async () => {
    if (offline || savingCodex || state.phase !== "ok") return;
    const { codex } = state.data;
    if (modelDraft === codex.model && effortDraft === codex.effort) {
      onToast(m.setup.model.codexUnchangedToast);
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
      onToast(m.setup.model.codexSavedToast);
      await load();
      onSaved?.();
    } catch (error) {
      setCodexError(describeNetError(error, m.setup.model.codexSaveFailed));
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
        setProbe({ phase: "done", provider: body.provider ?? m.setup.model.unknown, model: body.model ?? m.setup.model.unknown, note: m.setup.model.probeNoList });
      } else if (body.probe?.modelAvailable === false) {
        setProbe({ phase: "done", provider: body.provider ?? m.setup.model.unknown, model: body.model ?? m.setup.model.unknown, note: m.setup.model.probeNotInList });
      } else {
        setProbe({ phase: "done", provider: body.provider ?? m.setup.model.unknown, model: body.model ?? m.setup.model.unknown, note: m.setup.model.probeOk });
      }
    } catch {
      if (alive.current) setProbe({ phase: "failed", note: m.setup.model.probeFailed });
    }
  };

  if (state.phase === "loading") {
    return (
      <p className="set-quota__loading" role="status">
        {m.setup.model.loading}
      </p>
    );
  }

  if (state.phase === "down") {
    return (
      <div className="set-state" role="status">
        <p className="set-state__title">{m.setup.model.downTitle}</p>
        <p className="set-state__desc">{m.setup.model.downDesc}</p>
        <Button variant="secondary" onClick={() => void load()}>
          {m.setup.model.retry}
        </Button>
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
        title="DeepSeek"
        desc={m.setup.model.deepseekDesc}
        stacked
      >
        <p className="mset__status" data-on={data.deepseek.configured ? "on" : "off"}>
          <span className="mset__dot" aria-hidden="true" />
          <span>{data.deepseek.configured ? m.setup.model.configured(data.deepseek.masked ?? "") : m.setup.model.notConfigured}</span>
        </p>
        <div className="mset__form">
          <Input className="mset__field"
            type="password"
            name="deepseek-key"
            autoComplete="off"
            spellCheck={false}
            maxLength={200}
            placeholder={data.deepseek.configured ? m.setup.model.keyPlaceholderReplace : m.setup.model.keyPlaceholderNew}
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
          <Button
            className="mset__save" variant="secondary"
            disabled={offline || savingKey || key.trim() === ""}
            onClick={() => void saveKey()}
          >
            {savingKey ? m.setup.model.saving : m.setup.model.save}
          </Button>
        </div>
        <p className="mset__hint">{m.setup.model.keyHint}</p>
        {keyError && (
          <p className="set-row__bad" role="alert">
            {keyError}
          </p>
        )}
      </SettingRow>

      <SettingRow
        title="Codex"
        desc={m.setup.model.codexDesc}
        stacked
      >
        <p className="mset__now">
          {data.codex.model ? (
            <>
              {m.setup.model.nowUsingPrefix}<strong>{data.codex.model}</strong>
              {data.codex.effort ? ` · ${reasoningEffortLabel(data.codex.effort)}` : ""}
            </>
          ) : (
            <>{m.setup.model.noneChosen}</>
          )}
        </p>
        <div className="mset__form mset__form--codex">
          <div className="mset__item">
            <label className="mset__label" htmlFor="mset-model">
              {m.setup.model.modelLabel}
            </label>
            <select
              id="mset-model"
              className="ui-input set-select"
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
                    ? m.setup.model.modelLoading
                    : catalog.phase === "failed"
                      ? m.setup.model.modelListUnavailable
                      : modelOptions.length === 0
                        ? m.setup.model.modelNone
                        : m.setup.model.modelChoose}
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
              {m.setup.model.effortLabel}
            </label>
            <select
              id="mset-effort"
              className="ui-input set-select"
              value={effortDraft}
              disabled={offline || savingCodex || catalog.phase !== "ok" || !modelOption}
              onChange={(event) => setEffortDraft(event.target.value)}
            >
              {effortDraft === "" && (
                <option value="" disabled>
                  {catalog.phase === "loading"
                    ? m.setup.model.effortLoading
                    : catalog.phase === "failed"
                      ? m.setup.model.modelListUnavailable
                      : modelOption
                        ? m.setup.model.effortChoose
                        : m.setup.model.effortPickModelFirst}
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
          <Button
            className="mset__save" variant="secondary"
            disabled={!canSaveCodex}
            onClick={() => void saveCodex()}
          >
            {savingCodex ? m.setup.model.saving : m.setup.model.save}
          </Button>
        </div>
        {catalog.phase === "loading" && (
          <p className="mset__hint" role="status">
            {m.setup.model.catalogLoading}
          </p>
        )}
        {catalog.phase === "failed" && (
          <div className="mset__error" role="alert">
            <p className="set-row__bad">{catalog.message}</p>
            <p className="mset__hint">{catalog.hint}</p>
            <Button variant="secondary" disabled={offline} onClick={() => void loadCatalog()}>
              {m.setup.model.retryShort}
            </Button>
          </div>
        )}
        {savedModelMissing && (
          <p className="set-row__bad" role="status">
            {m.setup.model.savedModelMissing(data.codex.model)}
          </p>
        )}
        {draftEffortMissing && (
          <p className="set-row__bad" role="status">
            {m.setup.model.effortMissing(reasoningEffortLabel(effortDraft))}
          </p>
        )}
        <p className="mset__path">{m.setup.model.configPath(data.codex.configPath)}</p>
        {codexError && (
          <p className="set-row__bad" role="alert">
            {codexError}
          </p>
        )}
      </SettingRow>

      <SettingRow title={m.setup.model.probeTitle} desc={m.setup.model.probeDesc} stacked>
        <div className="mset__form">
          <Button
            variant="secondary"
            disabled={offline || probe.phase === "busy"}
            onClick={() => void runProbe()}
          >
            {probe.phase === "busy" ? m.setup.model.probing : m.setup.model.probeButton}
          </Button>
        </div>
        {probe.phase === "done" && (
          <p className="mset__probe" role="status">
            {m.setup.model.probeResult(probe.provider, probe.model, probe.note)}
          </p>
        )}
        {probe.phase === "failed" && (
          <p className="set-row__bad" role="status">
            {probe.note}
          </p>
        )}
        <p className="mset__hint">{m.setup.model.chain(data.chain.length > 0 ? data.chain.join(" → ") : m.setup.model.chainEmpty)}</p>
      </SettingRow>
    </div>
  );
}
