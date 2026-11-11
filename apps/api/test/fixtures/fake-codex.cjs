/*
 * 测试用的假 `codex`：按 `app-server` / `exec` 两种方式应答，并把收到的参数逐行记进 FAKE_CODEX_LOG。
 * 模型列表来自 FAKE_CODEX_MODELS：[{ model, displayName, efforts: string[], isDefault }]，efforts[0] 是默认档位。
 */
const { appendFileSync } = require("node:fs");
const { createInterface } = require("node:readline");

const log = (entry) => appendFileSync(process.env.FAKE_CODEX_LOG, `${JSON.stringify(entry)}\n`);
const args = process.argv.slice(2);
const models = JSON.parse(process.env.FAKE_CODEX_MODELS || "[]");

if (args[0] === "exec") {
  log({ kind: "exec", args });
  process.stdin.resume();
  process.stdin.on("end", () => {
    process.stdout.write(`${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "摘要" } })}\n`);
    process.exit(0);
  });
} else {
  const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  createInterface({ input: process.stdin }).on("line", (line) => {
    const message = JSON.parse(line);
    if (message.id === undefined) return;
    log({ kind: "rpc", method: message.method, params: message.params });
    if (message.method === "model/list") {
      send({
        id: message.id,
        result: {
          nextCursor: null,
          data: models.map((item) => ({
            id: item.model,
            model: item.model,
            displayName: item.displayName,
            isDefault: item.isDefault,
            defaultReasoningEffort: item.efforts[0],
            supportedReasoningEfforts: item.efforts.map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })),
          })),
        },
      });
    } else if (message.method === "thread/start") {
      send({ id: message.id, result: { thread: { id: "thread-1" } } });
    } else if (message.method === "turn/start") {
      send({ id: message.id, result: { turn: { id: "turn-1" } } });
      send({ method: "item/agentMessage/delta", params: { threadId: "thread-1", turnId: "turn-1", delta: "好" } });
      send({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } } });
    } else {
      send({ id: message.id, result: {} });
    }
  });
}
