import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaultEffort,
  defaultModel,
  effortAfterModelChange,
  effortChoices,
  effortsFor,
  GENERIC_REASONING_EFFORTS,
  modelChoices,
  parseCodexModels,
  type CodexModelOption,
} from "../src/lib/codex-model-options.ts";

const effort = (...names: string[]) => names.map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort }));
const label = (value: string) => ({ low: "低", medium: "中", high: "高", xhigh: "超高" })[value] ?? value;

const MODELS: CodexModelOption[] = [
  {
    model: "gpt-a",
    displayName: "GPT A",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: effort("low", "medium", "high", "xhigh"),
    isDefault: false,
  },
  {
    model: "gpt-b",
    displayName: "GPT B",
    defaultReasoningEffort: "low",
    supportedReasoningEfforts: effort("low", "high"),
    isDefault: true,
  },
  {
    model: "gpt-c",
    displayName: "gpt-c",
    defaultReasoningEffort: "",
    supportedReasoningEfforts: [],
    isDefault: false,
  },
];

test("解析模型列表：坏条目丢掉，缺字段补默认，整体形状不对就报错", () => {
  const parsed = parseCodexModels({
    models: [
      {
        model: "gpt-a",
        displayName: "GPT A",
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: [{ reasoningEffort: "low", description: "快" }, { bad: true }, null],
        isDefault: true,
      },
      { model: "gpt-bare" },
      { displayName: "没有 model 字段" },
      null,
      "gpt-string",
    ],
  });
  assert.deepEqual(parsed, [
    {
      model: "gpt-a",
      displayName: "GPT A",
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: [{ reasoningEffort: "low", description: "快" }],
      isDefault: true,
    },
    { model: "gpt-bare", displayName: "gpt-bare", defaultReasoningEffort: "", supportedReasoningEfforts: [], isDefault: false },
  ]);
  assert.throws(() => parseCodexModels({ error: "codex_unavailable" }));
  assert.throws(() => parseCodexModels(null));
});

test("档位过滤：只列所选模型支持的档位；接口没给清单时用通用档位", () => {
  assert.deepEqual(effortsFor(MODELS[1]), ["low", "high"]);
  assert.deepEqual(effortsFor(MODELS[2]), [...GENERIC_REASONING_EFFORTS]);
  assert.deepEqual(effortsFor(undefined), []);
  assert.deepEqual(
    effortChoices(MODELS[1], "high", label).map((item) => item.value),
    ["low", "high"],
  );
});

test("换模型时档位回落：新模型支持就保留，不支持就改成新模型的默认档位", () => {
  assert.equal(effortAfterModelChange(MODELS[1], "high"), "high");
  assert.equal(effortAfterModelChange(MODELS[1], "xhigh"), "low");
  assert.equal(effortAfterModelChange(MODELS[0], "max"), "medium");
  // 默认档位本身不在清单里（或没给）时退到清单第一项
  assert.equal(defaultEffort(MODELS[2]), GENERIC_REASONING_EFFORTS[0]);
  assert.equal(defaultEffort({ ...MODELS[1], defaultReasoningEffort: "max" }), "low");
});

test("接口没给档位清单时保留模型自己的默认档位（max、none 等），不回落到 low", () => {
  for (const own of ["max", "none", "minimal", "ultra"]) {
    const model = { ...MODELS[2], defaultReasoningEffort: own };
    assert.deepEqual(effortsFor(model), [...GENERIC_REASONING_EFFORTS, own]);
    assert.equal(defaultEffort(model), own);
    assert.equal(effortAfterModelChange(model, "nope"), own);
  }
  // 默认档位本来就在通用档位里：不重复
  assert.deepEqual(effortsFor({ ...MODELS[2], defaultReasoningEffort: "high" }), [...GENERIC_REASONING_EFFORTS]);
  assert.equal(defaultEffort({ ...MODELS[2], defaultReasoningEffort: "high" }), "high");
});

test("没选过模型时用标了默认的那个，没有标就用第一个", () => {
  assert.equal(defaultModel(MODELS)?.model, "gpt-b");
  assert.equal(defaultModel(MODELS.map((item) => ({ ...item, isDefault: false })))?.model, "gpt-a");
  assert.equal(defaultModel([]), undefined);
});

test("模型下拉显示名 + model；已保存的值不在列表里时保留并标注", () => {
  assert.deepEqual(modelChoices(MODELS, "gpt-a"), [
    { value: "gpt-a", label: "GPT A（gpt-a）", missing: false },
    { value: "gpt-b", label: "GPT B（gpt-b）", missing: false },
    { value: "gpt-c", label: "gpt-c", missing: false },
  ]);
  const withMissing = modelChoices(MODELS, "gpt-retired");
  assert.deepEqual(withMissing[0], { value: "gpt-retired", label: "gpt-retired（不在当前列表）", missing: true });
  assert.equal(withMissing.length, MODELS.length + 1);
  // 列表为空时，已保存的值仍是唯一可见的选项
  assert.deepEqual(modelChoices([], "gpt-a"), [{ value: "gpt-a", label: "gpt-a（不在当前列表）", missing: true }]);
});

test("档位下拉：已保存的档位不在所选模型的清单里时保留并标注", () => {
  assert.deepEqual(effortChoices(MODELS[1], "xhigh", label)[0], {
    value: "xhigh",
    label: "超高（不在当前列表）",
    missing: true,
  });
  assert.deepEqual(
    effortChoices(MODELS[1], "low", label).map((item) => item.value),
    ["low", "high"],
  );
  // 模型本身也不在列表里时，已保存的档位仍然看得见
  assert.deepEqual(effortChoices(undefined, "high", label), [{ value: "high", label: "高（不在当前列表）", missing: true }]);
});
