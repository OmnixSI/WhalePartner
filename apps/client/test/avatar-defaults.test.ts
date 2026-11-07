import assert from "node:assert/strict";
import test from "node:test";
import { AVATAR_MODELS, DEFAULT_MODEL_BY_CHARACTER, defaultModelFor } from "../src/avatar/model.config.ts";

test("only the existing Live2D model is available and belongs to Big Fat Fish", () => {
  assert.equal(AVATAR_MODELS.length, 1);
  assert.equal(AVATAR_MODELS[0].id, "dafeiyu-live2d");
  assert.equal(AVATAR_MODELS[0].renderer, "live2d");
  assert.equal(AVATAR_MODELS[0].ownerCharacterId, "deepseek");
});

test("each persona resolves only its own default model", () => {
  for (const [characterId, modelId] of Object.entries(DEFAULT_MODEL_BY_CHARACTER)) {
    const model = defaultModelFor(characterId as keyof typeof DEFAULT_MODEL_BY_CHARACTER, modelId);
    if (characterId === "deepseek") {
      assert.equal(model?.id, "dafeiyu-live2d");
      continue;
    }
    assert.equal(modelId, null);
    assert.equal(model, null);
  }
});

test("a stale cross-persona model id cannot load for another persona", () => {
  assert.equal(defaultModelFor("claude", "dafeiyu-live2d"), null);
});
