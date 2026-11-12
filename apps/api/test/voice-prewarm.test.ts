import assert from "node:assert/strict";
import { test } from "node:test";
import type { AsrService } from "../src/voice/asr.ts";
import type { TtsService } from "../src/voice/tts.ts";
import { prewarmVoice } from "../src/voice/prewarm.ts";

function fakes(asrFails = false) {
  const events: string[] = [];
  let finishAsr = () => {};
  const asr = {
    prewarmIfInstalled: () => {
      events.push("asr:start");
      return new Promise<void>((resolve, reject) => {
        finishAsr = () => { events.push("asr:end"); if (asrFails) reject(new Error("坏了")); else resolve(); };
      });
    },
  } as unknown as AsrService;
  const tts = { prewarmIfInstalled: async () => { events.push("tts:start"); } } as unknown as TtsService;
  return { asr, tts, events, finishAsr: () => finishAsr() };
}

test("startup prewarm loads X-ASR before CosyVoice", async () => {
  const { asr, tts, events, finishAsr } = fakes();
  const done = prewarmVoice(asr, tts, () => {});
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["asr:start"], "X-ASR 预热结束前不应开始载入 CosyVoice");
  finishAsr();
  await done;
  assert.deepEqual(events, ["asr:start", "asr:end", "tts:start"]);
});

test("a failed X-ASR prewarm still prewarms CosyVoice", async () => {
  const { asr, tts, events, finishAsr } = fakes(true);
  const warnings: string[] = [];
  const done = prewarmVoice(asr, tts, (message) => warnings.push(message));
  finishAsr();
  await done;
  assert.deepEqual(events, ["asr:start", "asr:end", "tts:start"]);
  assert.deepEqual(warnings, ["X-ASR 启动预热失败：坏了"]);
});
