/**
 * 设置 › 模型接入里 Codex 两个下拉的数据：模型列表只来自
 * `GET /api/setup/codex/models`，前端不写死模型名。这里全是纯函数，方便单测。
 *
 * 接口：`GET /api/setup/codex/models` 返回 `{ models }`；保存用
 * `PUT /api/setup/codex` 的 `model` / `effort`。某个模型没给档位清单时，
 * 后端按 `low / medium / high / xhigh` 接受，前端用同一份。
 */

export interface CodexEffortOption {
  reasoningEffort: string;
  description: string;
}

export interface CodexModelOption {
  model: string;
  displayName: string;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: CodexEffortOption[];
  isDefault: boolean;
}

/** 和后端 `GENERIC_REASONING_EFFORTS` 保持同一份。 */
export const GENERIC_REASONING_EFFORTS: readonly string[] = ["low", "medium", "high", "xhigh"];

export interface Choice {
  value: string;
  label: string;
  /** 已保存的值不在接口当前返回的列表里：照样显示，但标出来，不静默换掉。 */
  missing: boolean;
}

/** 解析模型列表响应；整体形状不对就抛错，坏条目单独丢掉。 */
export function parseCodexModels(body: unknown): CodexModelOption[] {
  const list = (body as { models?: unknown } | null)?.models;
  if (!Array.isArray(list)) throw new Error("模型列表的格式不对。");
  const models: CodexModelOption[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Partial<CodexModelOption>;
    if (typeof raw.model !== "string" || raw.model.trim() === "") continue;
    const model = raw.model.trim();
    const supportedReasoningEfforts: CodexEffortOption[] = [];
    if (Array.isArray(raw.supportedReasoningEfforts)) {
      for (const option of raw.supportedReasoningEfforts) {
        if (!option || typeof option.reasoningEffort !== "string" || option.reasoningEffort.trim() === "") continue;
        supportedReasoningEfforts.push({
          reasoningEffort: option.reasoningEffort.trim(),
          description: typeof option.description === "string" ? option.description : "",
        });
      }
    }
    models.push({
      model,
      displayName: typeof raw.displayName === "string" && raw.displayName.trim() !== "" ? raw.displayName : model,
      defaultReasoningEffort: typeof raw.defaultReasoningEffort === "string" ? raw.defaultReasoningEffort : "",
      supportedReasoningEfforts,
      isDefault: raw.isDefault === true,
    });
  }
  return models;
}

export function findModel(models: readonly CodexModelOption[], model: string): CodexModelOption | undefined {
  return models.find((item) => item.model === model);
}

/** 没选过模型时用列表标了默认的那个；没有标就用第一个。 */
export function defaultModel(models: readonly CodexModelOption[]): CodexModelOption | undefined {
  return models.find((item) => item.isDefault) ?? models[0];
}

/**
 * 这个模型能选的档位：接口给了清单就按清单；没给就用通用档位，
 * 模型自己的默认档位（比如 max、none）不在通用档位里就补上。和后端 `supportedEffortsOf` 同一规则。
 */
export function effortsFor(option: CodexModelOption | undefined): string[] {
  if (!option) return [];
  const listed = option.supportedReasoningEfforts.map((item) => item.reasoningEffort);
  if (listed.length > 0) return listed;
  const fallback = option.defaultReasoningEffort;
  return fallback && !GENERIC_REASONING_EFFORTS.includes(fallback) ? [...GENERIC_REASONING_EFFORTS, fallback] : [...GENERIC_REASONING_EFFORTS];
}

/** 这个模型的默认档位；默认值不在可选清单里时退到清单第一项。 */
export function defaultEffort(option: CodexModelOption | undefined): string {
  const efforts = effortsFor(option);
  if (option && efforts.includes(option.defaultReasoningEffort)) return option.defaultReasoningEffort;
  return efforts[0] ?? "";
}

/** 换模型后：原档位新模型也支持就留着，不支持就改成新模型的默认档位。 */
export function effortAfterModelChange(next: CodexModelOption | undefined, current: string): string {
  return effortsFor(next).includes(current) ? current : defaultEffort(next);
}

/** 下拉里显示「显示名 + 接口里用来保存的 model」；两者相同时只显示一次。 */
function modelLabel(option: CodexModelOption): string {
  return option.displayName === option.model ? option.model : `${option.displayName}（${option.model}）`;
}

/** 模型下拉：列表里的全部模型；已保存但已不在列表里的值放最前面并标注。 */
export function modelChoices(models: readonly CodexModelOption[], saved: string): Choice[] {
  const choices = models.map((option) => ({ value: option.model, label: modelLabel(option), missing: false }));
  if (saved !== "" && !findModel(models, saved)) {
    choices.unshift({ value: saved, label: `${saved}（不在当前列表）`, missing: true });
  }
  return choices;
}

/** 档位下拉：只列所选模型支持的档位；已保存但不在其中的值同样保留并标注。 */
export function effortChoices(
  option: CodexModelOption | undefined,
  saved: string,
  label: (effort: string) => string,
): Choice[] {
  const efforts = effortsFor(option);
  const choices = efforts.map((effort) => ({ value: effort, label: label(effort), missing: false }));
  if (saved !== "" && !efforts.includes(saved)) {
    choices.unshift({ value: saved, label: `${label(saved)}（不在当前列表）`, missing: true });
  }
  return choices;
}

/** 模型列表读不到时，错误下面那行提示。`kind` 是 `/api/setup/codex/models` 失败时带的 `kind`。 */
export function catalogFailureHint(kind: string | undefined): string {
  return kind === "binary"
    ? "已保存的选择不会被清空；但找不到可用的 Codex，聊天和视频摘要暂时无法运行。装好 Codex 或设置 WP_CODEX_BIN 后重启大肥鱼。"
    : "已保存的设置不受影响，照常使用。";
}
