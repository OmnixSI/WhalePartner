import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

test("PCM worklet resamples 48 kHz input into 100 ms mono PCM16 frames", () => {
  const source = readFileSync(new URL("../src/components/chat/pcm16-worklet.ts", import.meta.url), "utf8")
    .replace("declare const sampleRate: number;\n", "")
    .replace("declare abstract class AudioWorkletProcessor {\n  readonly port: MessagePort;\n  constructor(options?: AudioWorkletNodeOptions);\n}\n", "")
    .replace("declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;\n", "")
    .replace("process(inputs: Float32Array[][])", "process(inputs)");
  const messages: Array<{ pcm: ArrayBuffer; rms: number }> = [];
  let Processor: (new () => { process(inputs: Float32Array[][]): boolean }) | undefined;
  class FakeProcessor {
    port = { postMessage: (message: { pcm: ArrayBuffer; rms: number }) => messages.push(message) };
  }
  runInNewContext(source, {
    sampleRate: 48_000,
    AudioWorkletProcessor: FakeProcessor,
    registerProcessor: (_name: string, processor: typeof FakeProcessor) => { Processor = processor as unknown as typeof Processor; },
  });
  assert.ok(Processor);
  const processor = new Processor();
  for (let block = 0; block < 375; block += 1) {
    const input = new Float32Array(128);
    for (let i = 0; i < input.length; i += 1) {
      const sample = block * input.length + i;
      input[i] = Math.sin((2 * Math.PI * 440 * sample) / 48_000) * 0.25;
    }
    assert.equal(processor.process([ [input] ]), true);
  }
  assert.equal(messages.length, 10);
  assert.ok(messages.every((message) => message.pcm.byteLength === 3_200));
  assert.ok(messages.every((message) => message.rms > 0.15 && message.rms < 0.2));
});
