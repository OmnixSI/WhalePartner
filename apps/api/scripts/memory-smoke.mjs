// 记忆冒烟：真实模型链 + 真实 mem0 + 本地向量模型，验证“写入 → 重启 → 召回”。
// 用临时目录，不碰你真实的记忆；向量模型缓存复用 .local/memory/models（没有会先下载约 25 MB）。
//   pnpm --dir apps/api run memory:smoke
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../src/server/config.ts";
import { createChatProvider } from "../src/llm/index.ts";
import { estimateTokens } from "../src/memory/context.ts";
import { LazyMemoryStore } from "../src/memory/mem0.ts";

const baseProvider = createChatProvider(loadConfig());
const providerCalls = [];
let rememberDurationMs = 0;
const provider = {
  id: baseProvider.id,
  model: baseProvider.model,
  async *stream(messages, options) {
    const started = performance.now();
    const localInputTokenEstimate = messages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
    let actualProvider = baseProvider.id;
    let usage;
    try {
      for await (const delta of baseProvider.stream(messages, options)) {
        actualProvider = delta.provider ?? actualProvider;
        if (delta.usage) usage = delta.usage;
        yield delta;
      }
    } finally {
      providerCalls.push({
        provider: actualProvider,
        model: baseProvider.model,
        durationMs: Number((performance.now() - started).toFixed(1)),
        localInputTokenEstimate,
        providerUsage: usage ?? null,
      });
    }
  },
};
const dir = mkdtempSync(join(tmpdir(), "wp-memory-smoke-"));
const cache = resolve(import.meta.dirname, "../.local/memory/models");
if (existsSync(cache)) cpSync(cache, join(dir, "models"), { recursive: true });

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "通过" : "失败"}  ${name}${detail ? `  ${detail}` : ""}`); };
const lap = (() => { let t = performance.now(); return () => { const ms = Math.round(performance.now() - t); t = performance.now(); return `${ms} ms`; }; })();

try {
  const first = new LazyMemoryStore({ dataDir: dir, provider });
  const rememberStarted = performance.now();
  await first.remember([
    { role: "user", content: "我养了一只叫团子的猫，今年三岁。" },
    { role: "assistant", content: "团子听起来好可爱呀。" },
  ]);
  rememberDurationMs = Number((performance.now() - rememberStarted).toFixed(1));
  const facts = (await first.list()).filter((e) => e.kind === "fact");
  check("写入并提炼出事实", facts.length > 0 && facts.some((f) => f.text.includes("团子")), `${lap()}  ${facts.map((f) => f.text).join(" | ")}`);

  await first.addExperience({ kind: "video", title: "深海纪录片", text: "讲了发光水母和深海鱼。", sourceId: "BV1TEST" });
  await first.addExperience({ kind: "video", title: "深海纪录片（重看）", text: "更新后的摘要。", sourceId: "BV1TEST" });
  const experiences = await first.recentExperiences();
  check("同一个来源再写入会替换旧经历", experiences.length === 1 && experiences[0].title === undefined ? experiences[0].text.includes("重看") : experiences.length === 1 && experiences[0].text.includes("重看"));

  const second = new LazyMemoryStore({ dataDir: dir, provider }); // 模拟重启：新实例，同一份数据
  const recalled = await second.recall("我的猫叫什么名字");
  check("重启后按语义召回", recalled.some((e) => e.text.includes("团子")), `${lap()}  ${recalled.map((e) => e.text).join(" | ")}`);

  const unrelated = await second.recall("今天股市怎么样");
  check("明显无关的问题不召回", unrelated.length === 0, `召回 ${unrelated.length} 条`);

  const [fact] = facts;
  await second.remove(fact.id);
  check("删除后不再召回", !(await second.list()).some((e) => e.id === fact.id));
} finally {
  const providerDurationMs = providerCalls.reduce((sum, call) => sum + call.durationMs, 0);
  console.log("模型测量（本地输入估算与提供方用量分别记录）：", JSON.stringify({
    configuredProvider: baseProvider.id,
    memoryRememberDurationMs: rememberDurationMs,
    remainingLocalProcessingMs: Number((rememberDurationMs - providerDurationMs).toFixed(1)),
    providerCalls,
  }));
  rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} 项失败` : "\n全部通过");
process.exit(failed ? 1 : 0);
