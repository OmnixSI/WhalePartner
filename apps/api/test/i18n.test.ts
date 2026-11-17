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
