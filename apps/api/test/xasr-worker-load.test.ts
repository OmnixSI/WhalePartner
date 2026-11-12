import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const worker = fileURLToPath(new URL("../src/voice/xasr_worker.py", import.meta.url));
const hasPython = spawnSync("python3", ["--version"]).status === 0;

/** 假的 create_*：流式模型载入时等离线模型开始载入，串行载入就会等满 2 秒超时。 */
const harness = String.raw`
import importlib.util, sys, threading, types
sys.modules["sherpa_onnx"] = types.SimpleNamespace(OfflineRecognizer=object, OnlineRecognizer=object)
sys.modules["numpy"] = types.SimpleNamespace()
spec = importlib.util.spec_from_file_location("xasr_worker", sys.argv[1])
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

offline_started = threading.Event()
overlap = {}
def online(_dir):
    overlap["seen"] = offline_started.wait(2)
    return "online"
def offline(_dir):
    offline_started.set()
    return "offline"
worker.create_recognizer = online
worker.create_offline_recognizer = offline
parallel = worker.load_recognizers("s", "o")

def broken(_dir):
    raise RuntimeError("坏模型")
worker.create_offline_recognizer = broken
worker.create_recognizer = lambda _dir: "online"
failed = worker.load_recognizers("s", "o")
skipped = worker.load_recognizers("s", "")

worker.emit({"overlap": overlap["seen"], "parallel": list(parallel), "failed": list(failed), "skipped": list(skipped)})
`;

test("X-ASR worker loads the streaming and offline models in parallel", { skip: !hasPython && "python3 不可用" }, () => {
  const result = spawnSync("python3", ["-c", harness, worker], { encoding: "utf8", timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}") as Record<string, unknown>;
  assert.equal(summary.overlap, true, "离线模型应在流式模型载入期间开始载入");
  assert.deepEqual(summary.parallel, ["online", "offline"]);
  assert.deepEqual(summary.failed, ["online", null], "整句精修载入失败时流式识别照常可用");
  assert.deepEqual(summary.skipped, ["online", null]);
  assert.match(result.stderr, /整句精修模型载入失败：坏模型/);
});
