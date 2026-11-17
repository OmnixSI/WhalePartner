import assert from "node:assert/strict";
import { test } from "node:test";
import { zh } from "../src/i18n/locales/zh/index.ts";
import { en } from "../src/i18n/locales/en/index.ts";
import { lang, resolveLang, systemLang } from "../src/i18n/index.ts";

function shape(value: unknown): unknown {
  if (typeof value === "function") return `fn/${value.length}`;
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)]));
  return typeof value;
}

test("前端中英文案的键、数组长度和参数个数完全一致", () => {
  assert.deepEqual(shape(en), shape(zh));
});

test("非浏览器环境按中文；手动选择优先于系统语言", () => {
  assert.equal(systemLang(), "zh");
  assert.equal(lang, "zh");
  assert.equal(resolveLang("en"), "en");
  assert.equal(resolveLang("zh"), "zh");
  assert.equal(resolveLang("system"), "zh");
});
