import assert from "node:assert/strict";
import { test } from "node:test";
import { clarityOf, decayForPrompt, scoreImportance } from "../src/memory/decay.ts";

const NOW = new Date("2026-11-05T00:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

test("importance is deterministic and rewards identity, promises, firsts and strong feelings", () => {
  assert.ok(scoreImportance("用户叫阿宁，养了一只猫") >= 60);
  assert.ok(scoreImportance("答应下次一起看海，不要忘") >= 24);
  assert.ok(scoreImportance("第一次见面，特别开心，谢谢你陪我") >= 60);
  assert.ok(scoreImportance("嗯") < 10);
  assert.equal(scoreImportance("今天看了个视频"), scoreImportance("今天看了个视频"));
});

test("clarity fades with age, but important memories stay at least clear", () => {
  assert.equal(clarityOf({ text: "今天看了个视频", createdAt: ago(1) }, NOW), "vivid");
  assert.equal(clarityOf({ text: "今天看了个视频", createdAt: ago(7) }, NOW), "clear");
  assert.equal(clarityOf({ text: "今天看了个视频", createdAt: ago(30) }, NOW), "fuzzy");
  assert.equal(clarityOf({ text: "今天看了个视频", createdAt: ago(90) }, NOW), "trace");
  assert.equal(clarityOf({ text: "用户叫阿宁，养了一只猫", createdAt: ago(200) }, NOW), "clear");
  assert.equal(clarityOf({ text: "没有时间戳的条目" }, NOW), "vivid");
});

test("the prompt view keeps clear memories, blurs old ones and drops very old ones", () => {
  const view = decayForPrompt(
    [
      { text: "刚学的新梗：芭比Q了就是完蛋了", createdAt: ago(1) },
      { text: "一个月前看过的一段很长很长很长很长很长很长很长很长的视频摘要内容", createdAt: ago(30) },
      { text: "三个月前随便聊的一件小事", createdAt: ago(90) },
      { text: "用户叫阿宁", createdAt: ago(300) },
    ],
    NOW,
  );
  assert.equal(view.length, 3);
  assert.equal(view[0], "刚学的新梗：芭比Q了就是完蛋了");
  assert.ok(view[1].endsWith("…（记不太清了）"));
  assert.equal(view[2], "用户叫阿宁");
});
