import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ChatProvider } from "../src/llm/types.ts";
import { loadConfig } from "../src/server/config.ts";
import { FallbackChatProvider } from "../src/llm/router.ts";
import { createApiServer } from "../src/server.ts";
import { ChatStore } from "../src/store/index.ts";
import type { CodexModelOption } from "../src/codex/app-server.ts";
import { CodexBinaryError } from "../src/codex/binary.ts";
import { acquireSetupWrite, releaseSetupWrite } from "../src/routes/setup.ts";

/**
 * 模型接入（设置 › 模型接入）的契约：
 * GET 只给「配没配 + 后四位」、key 要过格式、codex effort 走白名单、写下去能读回来、同时只有一个写。
 * Codex 的选择存在大肥鱼自己的 codex-settings.json；每个用例都用临时目录，绝不碰真的 `~/.codex/config.toml`。
 */

/** 假的 key 也长得像真的：断言里只允许出现它的后四位。 */
const FAKE_KEY = "sk-live-00000000000000000000abcd";
const SAVED = `${JSON.stringify({ model: "gpt-6-luna", effort: "max" }, null, 2)}\n`;

const CODEX_MODELS: CodexModelOption[] = [
  {
    model: "gpt-6-luna",
    id: "gpt-6-luna",
    displayName: "GPT-6 Luna",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"].map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })),
    isDefault: true,
  },
  {
    model: "gpt-6-luna-preview",
    id: "gpt-6-luna-preview",
    displayName: "GPT-6 Luna Preview",
    defaultReasoningEffort: "low",
    supportedReasoningEfforts: ["low", "high"].map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })),
    isDefault: false,
  },
];

function fakeProvider(id: string, model: string): ChatProvider {
  return {
    id,
    model,
    async *stream() {
      yield { type: "delta" as const, text: "嗯。" };
    },
  } as unknown as ChatProvider;
}

interface Harness {
  base: string;
  dir: string;
  envPath: string;
  codexPath: string;
  close: () => void;
}

function serve(options: { env?: string; codex?: string | null; codexModels?: () => Promise<CodexModelOption[]> } = {}): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), "wp-setup-"));
  const envPath = join(dir, ".env");
  const codexPath = join(dir, "codex-settings.json");
  if (options.env !== undefined) writeFileSync(envPath, options.env, "utf8");
  if (options.codex !== null) writeFileSync(codexPath, options.codex ?? SAVED, "utf8");

  const store = new ChatStore(":memory:");
  const provider = new FallbackChatProvider([fakeProvider("deepseek", "deepseek-flash"), fakeProvider("codex", "gpt-6-luna")]);
  const codexModels = options.codexModels ?? (async () => CODEX_MODELS);
  const server = createApiServer({ config: loadConfig({}), provider, store, setup: { envPath, codexPath }, codexModels });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        base: `http://127.0.0.1:${port}`,
        dir,
        envPath,
        codexPath,
        close: () => {
          server.close();
          rmSync(dir, { recursive: true, force: true });
        },
      });
    });
  });
}

const put = (base: string, path: string, body: unknown) =>
  fetch(`${base}${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("GET /api/setup 只说配没配和后四位，绝不回明文", async () => {
  const app = await serve({ env: `API_PORT=8787\nDEEPSEEK_API_KEY=${FAKE_KEY}\n`, codex: SAVED });
  try {
    const response = await fetch(`${app.base}/api/setup`);
    assert.equal(response.status, 200);
    const text = await response.text();

    assert.equal(text.includes(FAKE_KEY), false, "响应里不能出现明文 key");
    assert.equal(text.includes(FAKE_KEY.slice(3, -4)), false, "响应里不能出现 key 的中间段");

    const body = JSON.parse(text) as {
      deepseek: { configured: boolean; masked: string | null };
      codex: { model: string; effort: string; configPath: string; present: boolean };
      chain: string[];
    };
    assert.deepEqual(body.deepseek, { configured: true, masked: "sk-…abcd" });
    assert.deepEqual(body.codex, { model: "gpt-6-luna", effort: "max", configPath: app.codexPath, present: true });
    assert.deepEqual(body.chain, ["deepseek", "codex"]);
  } finally {
    app.close();
  }
});

test("没配 key、也没选过 Codex 模型时如实说没有", async () => {
  const app = await serve({ env: "API_PORT=8787\n", codex: null });
  try {
    const body = (await (await fetch(`${app.base}/api/setup`)).json()) as {
      deepseek: { configured: boolean; masked: string | null };
      codex: { model: string; effort: string; present: boolean };
    };
    assert.deepEqual(body.deepseek, { configured: false, masked: null });
    assert.equal(body.codex.present, false);
    assert.equal(body.codex.model, "", "没选过就是空，由界面按模型列表的默认项显示");
    assert.equal(body.codex.effort, "");
  } finally {
    app.close();
  }
});

test("GET /api/setup 不等 Codex 模型列表：列表读不到时已保存的值照样返回", async () => {
  const app = await serve({ codex: SAVED, codexModels: () => Promise.reject(new Error("app-server 起不来")) });
  try {
    const setup = await fetch(`${app.base}/api/setup`);
    assert.equal(setup.status, 200);
    const body = (await setup.json()) as { codex: { model: string; effort: string } };
    assert.equal(body.codex.model, "gpt-6-luna");
    assert.equal(body.codex.effort, "max");

    const models = await fetch(`${app.base}/api/setup/codex/models`);
    assert.equal(models.status, 503);
    assert.equal(((await models.json()) as { error: string }).error, "codex_unavailable");
  } finally {
    app.close();
  }
});

test("只找到改参数的包装脚本时，模型列表和保存都返回 503 并说明原因，不改已保存的值", async () => {
  const reason = "找到的 codex（/opt/homebrew/bin/codex）是会改写模型参数的包装脚本，大肥鱼不用它；没找到真实的 Codex CLI。请用环境变量 WP_CODEX_BIN 指向真实的 codex。";
  const app = await serve({ codex: SAVED, codexModels: () => Promise.reject(new CodexBinaryError(reason)) });
  try {
    const models = await fetch(`${app.base}/api/setup/codex/models`);
    assert.equal(models.status, 503);
    assert.deepEqual(await models.json(), { error: "codex_unavailable", message: reason });

    const saved = await fetch(`${app.base}/api/setup/codex`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "gpt-6-luna", effort: "high" }) });
    assert.equal(saved.status, 503);
    assert.equal(((await saved.json()) as { message: string }).message, reason);
    assert.deepEqual(JSON.parse(readFileSync(app.codexPath, "utf8")), JSON.parse(SAVED));
  } finally {
    app.close();
  }
});

test("GET /api/setup/codex/models 原样给出 Codex 的模型列表和每个模型支持的档位", async () => {
  const app = await serve();
  try {
    const response = await fetch(`${app.base}/api/setup/codex/models`);
    assert.equal(response.status, 200);
    assert.deepEqual(((await response.json()) as { models: CodexModelOption[] }).models, CODEX_MODELS);
    const wrongMethod = await fetch(`${app.base}/api/setup/codex/models`, { method: "POST" });
    assert.equal(wrongMethod.status, 405);
  } finally {
    app.close();
  }
});

test("PUT /api/setup/deepseek：key 要 sk- 开头、20–200 长，写下去先备份、别的行不动", async () => {
  const app = await serve({ env: `# 注释留着\nAPI_PORT=8787\nDEEPSEEK_API_KEY=sk-old-000000000000000000000000\nSURF_ENABLED=0\n` });
  try {
    for (const key of ["nope", "sk-short", `sk-${"a".repeat(16)}`, `sk-${"a".repeat(198)}`, "sk-0000 0000 0000 0000 0000"]) {
      const refused = await put(app.base, "/api/setup/deepseek", { key });
      assert.equal(refused.status, 400, `应当拒绝：${key.slice(0, 12)}…`);
      const body = (await refused.json()) as { error: string; message: string };
      assert.equal(body.error, "invalid_key");
      assert.ok(body.message.length > 0);
    }

    const saved = await put(app.base, "/api/setup/deepseek", { key: FAKE_KEY });
    assert.equal(saved.status, 200);
    const savedText = await saved.text();
    assert.equal(savedText.includes(FAKE_KEY), false, "PUT 的响应里也不能有明文");
    const savedBody = JSON.parse(savedText) as { ok: boolean; restartRequired: boolean; masked: string };
    assert.deepEqual(savedBody, { ok: true, restartRequired: true, masked: "sk-…abcd" });

    const env = readFileSync(app.envPath, "utf8");
    assert.match(env, new RegExp(`^DEEPSEEK_API_KEY=${FAKE_KEY}$`, "m"));
    assert.equal(env.includes("API_PORT=8787"), true, "其它行要留着");
    assert.equal(env.includes("SURF_ENABLED=0"), true, "其它行要留着");
    assert.equal(env.includes("# 注释留着"), true, "注释要留着");
    assert.ok(existsSync(`${app.envPath}.bak`), "写之前要备份 .env.bak");
    assert.equal(statSync(app.envPath).mode & 0o777, 0o600, ".env 装着密钥，只能自己读写");
    assert.equal(statSync(`${app.envPath}.bak`).mode & 0o777, 0o600, "备份同样只能自己读写");

    const reread = (await (await fetch(`${app.base}/api/setup`)).json()) as { deepseek: { masked: string } };
    assert.equal(reread.deepseek.masked, "sk-…abcd");
  } finally {
    app.close();
  }
});

test("PUT /api/setup/deepseek：.env 里原来写的是 export 那一行，也只留一行", async () => {
  const app = await serve({ env: `export DEEPSEEK_API_KEY=${FAKE_KEY}\nexport API_PORT=8787\n` });
  try {
    const saved = await put(app.base, "/api/setup/deepseek", { key: `${FAKE_KEY.slice(0, -4)}zzzz` });
    assert.equal(saved.status, 200);

    const env = readFileSync(app.envPath, "utf8");
    const lines = env.split("\n").filter((line) => line.includes("DEEPSEEK_API_KEY"));
    assert.equal(lines.length, 1, "不能既留着旧行又追加新行");
    assert.equal(lines[0], `export DEEPSEEK_API_KEY=${FAKE_KEY.slice(0, -4)}zzzz`);
    assert.equal(env.includes("export API_PORT=8787"), true);

    const reread = (await (await fetch(`${app.base}/api/setup`)).json()) as { deepseek: { masked: string } };
    assert.equal(reread.deepseek.masked, "sk-…zzzz");
  } finally {
    app.close();
  }
});

test("PUT /api/setup/codex：effort 只认当前模型清单，model 不许带空格", async () => {
  const app = await serve({ codex: SAVED });
  try {
    const badEffort = await put(app.base, "/api/setup/codex", { effort: "turbo" });
    assert.equal(badEffort.status, 400);
    assert.equal(((await badEffort.json()) as { error: string }).error, "invalid_effort");

    const unsupportedEffort = await put(app.base, "/api/setup/codex", { model: "gpt-6-luna-preview", effort: "max" });
    assert.equal(unsupportedEffort.status, 400);
    assert.equal(((await unsupportedEffort.json()) as { error: string }).error, "invalid_effort");

    for (const model of ["a", "has space", "not-in-list", `x${"y".repeat(64)}`]) {
      const refused = await put(app.base, "/api/setup/codex", { model });
      assert.equal(refused.status, 400, `应当拒绝模型名：${model}`);
      assert.equal(((await refused.json()) as { error: string }).error, "invalid_model");
    }

    const empty = await put(app.base, "/api/setup/codex", {});
    assert.equal(empty.status, 400);

    // 被拒之后文件一个字节都没动
    assert.equal(readFileSync(app.codexPath, "utf8"), SAVED);
  } finally {
    app.close();
  }
});

test("PUT /api/setup/codex：写进大肥鱼自己的设置文件，能读回来", async () => {
  const app = await serve({ codex: SAVED });
  try {
    const saved = await put(app.base, "/api/setup/codex", { model: "gpt-6-luna-preview", effort: "high" });
    assert.equal(saved.status, 200);
    const body = (await saved.json()) as {
      ok: boolean;
      restartRequired: boolean;
      codex: { model: string; effort: string; present: boolean };
    };
    assert.equal(body.ok, true);
    assert.equal(body.restartRequired, false);
    assert.equal(body.codex.model, "gpt-6-luna-preview");
    assert.equal(body.codex.effort, "high");
    assert.deepEqual(JSON.parse(readFileSync(app.codexPath, "utf8")), { model: "gpt-6-luna-preview", effort: "high" });

    const reread = (await (await fetch(`${app.base}/api/setup`)).json()) as { codex: { model: string; effort: string } };
    assert.equal(reread.codex.model, "gpt-6-luna-preview");
    assert.equal(reread.codex.effort, "high");
  } finally {
    app.close();
  }
});

test("PUT /api/setup/codex：只给 effort 时沿用已保存的模型；没选过模型就用列表默认模型", async () => {
  const app = await serve({ codex: null });
  try {
    const saved = await put(app.base, "/api/setup/codex", { effort: "xhigh" });
    assert.equal(saved.status, 200);
    assert.deepEqual(JSON.parse(readFileSync(app.codexPath, "utf8")), { model: "gpt-6-luna", effort: "xhigh" });
  } finally {
    app.close();
  }
});

test("同时只允许一个写：抢不到锁就回 409", async () => {
  const app = await serve({ codex: SAVED });
  try {
    assert.equal(acquireSetupWrite(), true, "先占住写锁，模拟另一个请求正在写");
    try {
      const refused = await put(app.base, "/api/setup/deepseek", { key: FAKE_KEY });
      assert.equal(refused.status, 409);
      const body = (await refused.json()) as { error: string; message: string };
      assert.equal(body.error, "busy");
      assert.ok(body.message.length > 0);

      const refusedCodex = await put(app.base, "/api/setup/codex", { effort: "low" });
      assert.equal(refusedCodex.status, 409);
      assert.equal(((await refusedCodex.json()) as { error: string }).error, "busy");
    } finally {
      releaseSetupWrite();
    }

    const allowed = await put(app.base, "/api/setup/codex", { effort: "low" });
    assert.equal(allowed.status, 200, "放锁之后要能写");
    assert.equal(JSON.parse(readFileSync(app.codexPath, "utf8")).effort, "low");
  } finally {
    app.close();
  }
});
