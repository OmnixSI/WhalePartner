import assert from "node:assert/strict";
import { test } from "node:test";
import type { IncomingMessage } from "node:http";
import { currentLang, msg, requestLang, resetLangForTest, runWithLang } from "../src/i18n/index.ts";
import { zh } from "../src/i18n/zh.ts";
import { en } from "../src/i18n/en.ts";
import { buildPersonaCore } from "../src/persona/persona.ts";

const request = (lang?: string) => ({ headers: lang ? { "x-wp-lang": lang } : {} }) as unknown as IncomingMessage;

function shape(value: unknown): unknown {
  if (typeof value === "function") return `fn/${value.length}`;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)]));
  return typeof value;
}

test("后端中英文案的键和参数个数完全一致", () => {
  assert.deepEqual(shape(en), shape(zh));
});

test("请求头决定这次请求的语言，没带头的请求沿用最近一次", () => {
  resetLangForTest("zh");
  assert.equal(requestLang(request("en")), "en");
  assert.equal(requestLang(request("fr")), null);
  assert.equal(runWithLang(requestLang(request("en")), () => msg().common.unknownCharacter), "Unknown character.");
  assert.equal(runWithLang(requestLang(request()), () => currentLang()), "en");
  assert.equal(runWithLang("zh", () => msg().common.unknownCharacter), "未知的角色。");
  resetLangForTest("zh");
});

test("英文界面给人设追加用英文说话的要求，中文界面提示词不变", () => {
  resetLangForTest("zh");
  const zhCore = buildPersonaCore("deepseek");
  assert.ok(!zhCore.includes("## Language"));
  const enCore = runWithLang("en", () => buildPersonaCore("deepseek"));
  assert.ok(enCore.startsWith(zhCore));
  assert.match(enCore, /Speak natural, casual English/);
  assert.match(enCore, /your name is Big Fat Fish/);
  resetLangForTest("zh");
});

test("库里的默认会话标题按当前语言显示，库里不改；手动改过名的原样显示", async () => {
  const { ChatStore } = await import("../src/store/index.ts");
  const store = new ChatStore(":memory:");
  const zhSession = runWithLang("zh", () => store.createSession("whale"));
  const enSession = runWithLang("en", () => store.createSession("whale"));
  const manual = store.createSession("whale");
  store.renameSession(manual.id, "whale", "新聊天"); // i18n-ignore：测试数据
  runWithLang("en", () => {
    const titles = new Map(store.listSessions("whale").map((session) => [session.id, session.title]));
    assert.equal(titles.get(zhSession.id), "New chat");
    assert.equal(titles.get(enSession.id), "New chat");
    assert.equal(titles.get(manual.id), "新聊天"); // i18n-ignore：测试数据
    assert.equal(store.getSession(zhSession.id)?.title, "New chat");
  });
  runWithLang("zh", () => assert.equal(store.getSession(enSession.id)?.title, "新聊天")); // i18n-ignore：测试数据
  resetLangForTest("zh");
});

test("「她学到的」库里的内置分类标题按当前语言显示，库里不改；写入仍存中文标签", async () => {
  const { ChatStore } = await import("../src/store/index.ts");
  const { createApiServer } = await import("../src/server.ts");
  const { loadConfig } = await import("../src/server/config.ts");
  const { FallbackChatProvider } = await import("../src/llm/router.ts");
  const { learnFrom } = await import("../src/chat/learning.ts");
  const { displayExperienceTitle } = await import("../src/store/experiences.ts");
  const store = new ChatStore(":memory:");
  // i18n-ignore-start：测试数据
  const reply = '[{"kind":"meme","text":"Touch grass means go outside."},{"kind":"knowledge","text":"Whales talk across oceans."}]';
  const provider = { id: "fake", model: "m", async *stream() { yield { text: reply }; } };
  await runWithLang("en", () => learnFrom({ provider, store }, { title: "t", text: "x" }, "web:1"));
  store.upsertExperience({ kind: "learned", title: "New knowledge", text: "英文标签的旧数据", sourceId: "learned:old:0" });
  store.upsertExperience({ kind: "learned", title: "自定义标题", text: "不认识的标题原样显示", sourceId: "learned:old:1" });
  store.upsertExperience({ kind: "video", title: "新知识", text: "别的来源同名标题不翻译", sourceId: "BV-same-title" });
  const raw = new Map(store.listExperiences(50, false).map((e) => [e.sourceId, e.title]));
  assert.equal(raw.get("learned:web:1:0"), "新梗 / 说法");
  assert.equal(raw.get("learned:web:1:1"), "新知识");

  const enTitles = runWithLang("en", () => new Map(store.listMemoryExplorer({ character: "whale", category: "all", status: "all", role: "all", page: 1, pageSize: 50 }).items.map((i) => [i.sourceId, i.title])));
  assert.equal(enTitles.get("learned:web:1:0"), "New slang / sayings");
  assert.equal(enTitles.get("learned:web:1:1"), "New knowledge");
  assert.equal(enTitles.get("learned:old:0"), "New knowledge");
  assert.equal(enTitles.get("learned:old:1"), "自定义标题");
  assert.equal(enTitles.get("BV-same-title"), "新知识");
  const zhTitles = runWithLang("zh", () => new Map(store.listMemoryExplorer({ character: "whale", category: "learned", status: "all", role: "all", page: 1, pageSize: 50 }).items.map((i) => [i.sourceId, i.title])));
  assert.equal(zhTitles.get("learned:web:1:0"), "新梗 / 说法");
  assert.equal(zhTitles.get("learned:old:0"), "新知识");

  const server = createApiServer({ config: loadConfig({}), provider: new FallbackChatProvider([provider]), store });
  const base = await new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}`)));
  try {
    for (const [lang, meme, knowledge] of [["en", "New slang / sayings", "New knowledge"], ["zh", "新梗 / 说法", "新知识"]]) {
      const { entries } = await (await fetch(`${base}/api/memories`, { headers: { "x-wp-lang": lang } })).json() as { entries: Array<{ sourceId?: string; title?: string }> };
      const titles = new Map(entries.map((e) => [e.sourceId, e.title]));
      assert.equal(titles.get("learned:web:1:0"), meme);
      assert.equal(titles.get("learned:web:1:1"), knowledge);
      assert.equal(titles.get("learned:old:0"), knowledge);
      assert.equal(titles.get("BV-same-title"), "新知识");
    }
  } finally { server.close(); }
  assert.equal(runWithLang("en", () => displayExperienceTitle("learned", undefined)), undefined);
  // i18n-ignore-end
  resetLangForTest("zh");
});

test("后台任务在运行时读最近一次的语言，不继承安排时的请求语言", async () => {
  const { runInBackgroundLang, currentLang } = await import("../src/i18n/index.ts");
  const inherited = runWithLang("zh", () => new Promise<string>((resolve) => setTimeout(() => resolve(currentLang()), 5)));
  const background = runWithLang("zh", () => new Promise<string>((resolve) => setTimeout(() => runInBackgroundLang(() => resolve(currentLang())), 5)));
  runWithLang("en", () => undefined);
  assert.equal(await inherited, "zh", "普通定时器会继承请求语言（这正是要绕开的）");
  assert.equal(await background, "en");
  resetLangForTest("zh");
});
