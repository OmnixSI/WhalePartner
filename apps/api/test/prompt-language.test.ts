import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { outputLanguageNote, resetLangForTest, runWithLang } from "../src/i18n/index.ts";
import { sharedParagraph } from "../src/video/service.ts";
import { capturePrompts } from "./prompt-capture.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 会话 id 和时间戳每次运行都不同，比较前抹掉。 */
const normalize = (text: string) =>
  text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>").replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, "<time>");
const sha = (text: string) => createHash("sha256").update(normalize(text)).digest("hex");
const NOTE = /\n\n## Output language\n[^\n]*/g;
/** 人设末尾的英文说话指令（persona.ts 的 ENGLISH_REPLY，聊天、日记等共用）。 */
const PERSONA_EN = /\n\n## Language\n[\s\S]*?In English, your name is [^\n]*\./g;

/**
 * 0.3.6（52500e4）用同一份 prompt-capture.ts 抓到的提示词指纹。中文模式下必须完全相同：
 * 这次改动不能动中文提示词的任何一个字。（每日手帐的提示词带当天日期，不在这里比。）
 */
const MAIN_0_3_6: Record<string, string> = {
  videoSummary: "fd8610d1339830ff9059e7f783d11a6d43806a0eab2833c70fc98b1ef162afed",
  reflect: "65a14066cad79761901563d4ec3a5c4f3b63a417e8c509a7f253e8039bfe5042",
  learning: "c0b540517023254791e126db993a4584c8935ae076dba6e520f3ce9dc2992456",
  webSummary: "1ae71571fcc9d8eb7c45a417f2ff218d57782f1be4b757749f85fae4db704e99",
  distill: "b7c198e078db52316b557955fb1490ae3a76da1b0566bc2f892f417779ec7ca1",
  videoDiary: "3c27a58c3c4dacb1ff855ec3db598e4854ecc6d2568741d1ced3f8326ee54ab0",
  proactive: "37cc356edbca244f3f500786862d89377b5d06f5f8fc6bfa08dec9384e014ec2",
};

test("中文模式：会显示给用户的 AI 输出，提示词与 0.3.6 逐字相同", async () => {
  const zh = await runWithLang("zh", () => capturePrompts(root));
  for (const [name, hash] of Object.entries(MAIN_0_3_6)) {
    assert.equal(sha(zh[name]), hash, `${name} 的中文提示词和 0.3.6 不一样`);
    assert.doesNotMatch(zh[name], NOTE, name);
  }
  assert.equal(zh.videoDiaryCalls, "2", "中文日记照旧再过一遍「说人话」改写");
  assert.equal(runWithLang("zh", () => outputLanguageNote("x")), "");
  resetLangForTest("zh");
});

test("English 模式：同一份提示词末尾多一段输出语言指令，其余不变", async () => {
  const zh = await runWithLang("zh", () => capturePrompts(root));
  const en = await runWithLang("en", () => capturePrompts(root));
  for (const name of [...Object.keys(MAIN_0_3_6), "journal"]) {
    assert.ok(en[name], `${name} 没有抓到提示词`);
    assert.match(en[name], NOTE, `${name} 缺少英文输出指令`);
    assert.equal(normalize(en[name].replace(NOTE, "").replace(PERSONA_EN, "")), normalize(zh[name]), `${name} 除了语言指令还改了别的`);
  }
  assert.match(en.videoSummary, /# Sharing with you/);
  assert.equal(en.videoDiaryCalls, "1", "英文日记不套用只针对中文的「说人话」改写");
  resetLangForTest("zh");
});

test("视频总结的英文小标题也能取出「分享给你」那一段", () => {
  assert.equal(sharedParagraph("# Sharing with you\n\nA video about whale songs.\n\n# Sources & basis\n\n- Title: Whales"), "A video about whale songs.");
  assert.equal(sharedParagraph("## Sharing with you\nShort one.\n## Sources & basis\n- x"), "Short one.");
  assert.equal(sharedParagraph("# 分享给你\n\n讲蓝鲸。\n\n# 来源与依据\n\n- 标题"), "讲蓝鲸。"); // i18n-ignore：测试数据
});
