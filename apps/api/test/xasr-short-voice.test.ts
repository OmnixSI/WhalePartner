import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const worker = fileURLToPath(new URL("../src/voice/xasr_worker.py", import.meta.url));
const python = spawnSync("python3", ["--version"], { encoding: "utf8" });
const hasPython = python.status === 0;

/** 用假 recognizer 直接跑 worker：不需要 sherpa-onnx 模型。 */
const harness = String.raw`
import base64, importlib.util, io, json, sys, types
import numpy as np

sys.modules["sherpa_onnx"] = types.SimpleNamespace(OfflineRecognizer=object, OnlineRecognizer=object)
spec = importlib.util.spec_from_file_location("xasr_worker", sys.argv[1])
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

class OnlineStream:
    def accept_waveform(self, rate, audio):
        pass
    def input_finished(self):
        pass

class FakeOnline:
    def __init__(self, text):
        self.text = text
        self.trimmed = 0
    def create_stream(self):
        return OnlineStream()
    def is_ready(self, stream):
        return False
    def decode_stream(self, stream):
        pass
    def get_result(self, stream):
        return self.text

class OfflineStream:
    def __init__(self, text):
        self.result = types.SimpleNamespace(text=text)
    def accept_waveform(self, rate, audio):
        pass

class FakeOffline:
    def __init__(self, text):
        self.text = text
        self.used = 0
    def create_stream(self):
        self.used += 1
        return OfflineStream(self.text)
    def decode_stream(self, stream):
        pass

def make_state(online, speech_samples, chunks):
    return {
        "stream": online.create_stream(),
        "active": True,
        "audio": chunks,
        "pre_roll": np.empty(0, dtype=np.int16),
        "silence_samples": 0,
        "speech_samples": speech_samples,
        "noise_floor": 0.0,
        "last_hypothesis": "",
    }

# 1. 短语音 finish：回流式文本，不跑整句精修。
online = FakeOnline(" 好 ")
offline = FakeOffline("不应调用")
short = make_state(online, 4_000, [np.full(4_000, 1_000, dtype=np.int16)])
short_text = worker.finish_utterance(online, offline, short)

# 2. 长语音 finish：仍走整句精修。
online2 = FakeOnline("你好")
offline2 = FakeOffline("你好 呀")
long = make_state(online2, 12_000, [np.full(12_000, 1_000, dtype=np.int16)])
long_text = worker.finish_utterance(online2, offline2, long)

# 3. 走完整协议：0.25 秒语音 + 静音收尾，短语音也要 final 文本。
online3 = FakeOnline("好")
worker.create_recognizer = lambda _model_dir: online3
worker.create_offline_recognizer = lambda _model_dir: FakeOffline("不应调用")
lines = []
def audio(samples):
    return {"action": "audio", "streamId": "s", "requestId": "r", "pcm": base64.b64encode(samples.astype("<i2").tobytes()).decode()}
lines.append({"action": "start", "streamId": "s", "requestId": "start"})
lines.append(audio(np.full(4_000, 1_000, dtype=np.int16)))
lines.append(audio(np.zeros(11_200, dtype=np.int16)))
lines.append({"action": "shutdown"})
sys.argv = ["xasr_worker.py", "stream-model", "offline-model"]
sys.stdin = io.StringIO("".join(json.dumps(line) + "\n" for line in lines))
worker.main()

worker.emit({"type": "summary", "short": short_text, "long": long_text, "offline_short_calls": offline.used, "offline_long_calls": offline2.used})
`;

test("short X-ASR speech keeps the streaming result and long speech still refines", { skip: !hasPython && "python3 不可用" }, () => {
  const result = spawnSync("python3", ["-c", harness, worker], { encoding: "utf8", timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr);
  const summary = result.stdout
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as { type?: string; short?: string; long?: string; offline_short_calls?: number; offline_long_calls?: number })
    .find((message) => message.type === "summary");
  assert.ok(summary, `worker 没有输出结果：${result.stdout}\n${result.stderr}`);
  assert.equal(summary?.short, "好");
  assert.equal(summary?.offline_short_calls, 0, "短语音不应进入整句精修");
  assert.equal(summary?.long, "你好呀");
  assert.equal(summary?.offline_long_calls, 1, "长语音仍应走整句精修");

  const replies = result.stdout
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as { type: string; final?: boolean; text?: string });
  const final = replies.find((reply) => reply.type === "reply" && reply.final === true);
  assert.equal(final?.text, "好", "静音收尾的短语音也要交回流式结果");
});
