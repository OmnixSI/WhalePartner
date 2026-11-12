import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { queueReflection, queueReflectionIfDue, resetReflectionScheduleForTests, waitForBackgroundJobs } from "../src/chat/background.ts";
import { buildWeekChat, REFLECT_CHAT_BUDGET } from "../src/chat/reflect.ts";
import type { ChatProvider } from "../src/llm/types.ts";
import { ChatStore } from "../src/store/index.ts";

const DAY = 86_400_000;

function capture() {
  const prompts: string[] = [];
  const provider: ChatProvider = {
    id: "fake", model: "reflect-week-test",
    async *stream(messages) {
      prompts.push(messages.map((message) => message.content).join("\n"));
      yield { text: "这一周我过得挺开心的，聊了很多海里的事。" };
    },
  };
  return { prompts, provider };
}

type Backdate = (id: number, msAgo: number) => void;
type BackdateNote = (msAgo: number) => void;

async function withStore(run: (store: ChatStore, backdate: Backdate, backdateNote: BackdateNote) => Promise<void>) {
  await waitForBackgroundJobs();
  const directory = mkdtempSync(join(tmpdir(), "whalepartner-week-"));
  const path = join(directory, "chat.db");
  const store = new ChatStore(path);
  const raw = new DatabaseSync(path);
  const backdate = (id: number, msAgo: number) => {
    raw.prepare("UPDATE messages SET created_at = ? WHERE id = ?").run(new Date(Date.now() - msAgo).toISOString(), id);
  };
  const backdateNote = (msAgo: number) => {
    raw.prepare("UPDATE character_notes SET updated_at = ?").run(new Date(Date.now() - msAgo).toISOString());
  };
  resetReflectionScheduleForTests();
  try {
    await run(store, backdate, backdateNote);
  } finally {
    raw.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("reflection reads the last 7 days and nothing older", async () => {
  await withStore(async (store, backdate) => {
    const session = store.createSession("whale", "一周");
    const old = store.add("user", "八天前聊的珊瑚礁", null, "whale", session.id);
    const edge = store.add("user", "差一小时满七天聊的灯塔", null, "whale", session.id);
    const today = store.add("assistant", "今天聊的海豚", null, "whale", session.id);
    backdate(old.id, 8 * DAY);
    backdate(edge.id, 7 * DAY - 3_600_000);
    backdate(today.id, 60_000);
    const { prompts, provider } = capture();
    queueReflection({ provider, store }, "whale", true);
    await waitForBackgroundJobs();
    assert.equal(prompts.length, 1);
    assert.match(prompts[0]!, /这一周的近况/);
    assert.match(prompts[0]!, /这一周的聊天（最近 7 天/);
    assert.match(prompts[0]!, /灯塔/);
    assert.match(prompts[0]!, /海豚/);
    assert.doesNotMatch(prompts[0]!, /珊瑚礁/);
    assert.equal(store.getNote("whale")?.text, "这一周我过得挺开心的，聊了很多海里的事。");
  });
});

test("reflection combines every session from the week in time order", async () => {
  await withStore(async (store, backdate) => {
    const first = store.createSession("whale", "周一的会话");
    const second = store.createSession("whale", "周四的会话");
    const a = store.add("user", "周一说的潮汐", null, "whale", first.id);
    const b = store.add("user", "周四说的鲸歌", null, "whale", second.id);
    const c = store.add("user", "今天回到周一会话说的海星", null, "whale", first.id);
    backdate(a.id, 5 * DAY);
    backdate(b.id, 2 * DAY);
    backdate(c.id, 60_000);
    const { prompts, provider } = capture();
    queueReflection({ provider, store }, "whale", true);
    await waitForBackgroundJobs();
    const prompt = prompts[0]!;
    const order = ["潮汐", "鲸歌", "海星"].map((word) => prompt.indexOf(word));
    assert.ok(order.every((index) => index >= 0), prompt);
    assert.deepEqual([...order].sort((x, y) => x - y), order);
    // 三天各有一段日期标题。
    assert.equal(prompt.match(/^— \d+月\d+日 —$/gm)?.length, 3);
    assert.doesNotMatch(prompt, /已略去/);
  });
});

test("a week longer than the budget keeps the newest chat and says the rest was dropped", async () => {
  await withStore(async (store, backdate) => {
    const session = store.createSession("whale", "话很多的一周");
    const total = 80; // 80 × 164 ≈ 13K 字，超过 6000 的上限
    for (let index = 0; index < total; index += 1) {
      const message = store.add(index % 2 ? "assistant" : "user", `第${index}条：${"浪".repeat(200)}`, null, "whale", session.id);
      backdate(message.id, (total - index) * 60_000);
    }
    const { prompts, provider } = capture();
    queueReflection({ provider, store }, "whale", true);
    await waitForBackgroundJobs();
    const prompt = prompts[0]!;
    assert.match(prompt, /（更早的聊天太长，已略去）/);
    assert.match(prompt, /第79条/);
    assert.doesNotMatch(prompt, /第0条：/);
    const chatPart = prompt.slice(prompt.indexOf("已略去"));
    assert.ok(chatPart.length <= REFLECT_CHAT_BUDGET + 200, `chat part is ${chatPart.length} chars`);
  });
});

test("buildWeekChat drops the oldest lines first and keeps whole messages", () => {
  const at = new Date().toISOString();
  const messages = [
    { role: "user" as const, content: "最早的一条", createdAt: at },
    { role: "assistant" as const, content: "中间的一条", createdAt: at },
    { role: "user" as const, content: "最新的一条", createdAt: at },
  ];
  const all = buildWeekChat(messages, 1000);
  assert.equal(all.truncated, false);
  assert.equal(all.kept.length, 3);
  const cut = buildWeekChat(messages, 2 * (5 + 4));
  assert.equal(cut.truncated, true);
  assert.deepEqual(cut.kept.map((message) => message.content), ["中间的一条", "最新的一条"]);
  assert.deepEqual(cut.chat.slice(1), ["她：中间的一条", "用户：最新的一条"]);
});

test("no new version before 3 days have passed, even with new chat", async () => {
  await withStore(async (store, backdate, backdateNote) => {
    store.setNote("whale", "两天前的近况。", 0);
    backdateNote(2 * DAY);
    const session = store.createSession("whale", "近两天");
    backdate(store.add("user", "昨天聊的水母", null, "whale", session.id).id, DAY);
    const { prompts, provider } = capture();
    queueReflectionIfDue({ provider, store }, "whale");
    await waitForBackgroundJobs();
    assert.equal(prompts.length, 0);
    assert.equal(store.getNote("whale")?.text, "两天前的近况。");
  });
});

test("no new version after 3 days when nobody chatted since the last one", async () => {
  await withStore(async (store, backdate, backdateNote) => {
    const session = store.createSession("whale", "很久以前");
    backdate(store.add("user", "五天前聊的海龟", null, "whale", session.id).id, 5 * DAY);
    store.setNote("whale", "四天前的近况。", 0);
    backdateNote(4 * DAY);
    const { prompts, provider } = capture();
    queueReflectionIfDue({ provider, store }, "whale");
    await waitForBackgroundJobs();
    assert.equal(prompts.length, 0);
    assert.equal(store.getNote("whale")?.text, "四天前的近况。");
  });
});

test("a new version is written once 3 days have passed and there is new chat", async () => {
  await withStore(async (store, backdate, backdateNote) => {
    const session = store.createSession("whale", "三天后");
    backdate(store.add("user", "五天前聊的海龟", null, "whale", session.id).id, 5 * DAY);
    store.setNote("whale", "三天多以前的近况。", 0);
    backdateNote(3 * DAY + 60_000);
    backdate(store.add("user", "今天聊的海马", null, "whale", session.id).id, 60_000);
    const { prompts, provider } = capture();
    // 回复后连着判断两次，只排一次生成。
    queueReflectionIfDue({ provider, store }, "whale");
    queueReflectionIfDue({ provider, store }, "whale");
    await waitForBackgroundJobs();
    assert.equal(prompts.length, 1);
    assert.match(prompts[0]!, /海马/);
    assert.match(prompts[0]!, /海龟/);
    assert.equal(store.getNote("whale")?.text, "这一周我过得挺开心的，聊了很多海里的事。");
    // 刚写完新的一版，再判断就不到期了。
    queueReflectionIfDue({ provider, store }, "whale");
    await waitForBackgroundJobs();
    assert.equal(prompts.length, 1);
  });
});

test("upgrading continues chat learning from where the old note left off", () => {
  const directory = mkdtempSync(join(tmpdir(), "whalepartner-learn-state-"));
  const path = join(directory, "chat.db");
  const oldDb = new DatabaseSync(path);
  oldDb.exec(`
    CREATE TABLE character_notes (
      character TEXT PRIMARY KEY, text TEXT NOT NULL,
      assistant_count INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
    );
    INSERT INTO character_notes VALUES ('shared', '升级前的近况', 123, '2026-11-12T02:14:12.821Z');
  `);
  oldDb.close();
  try {
    let store = new ChatStore(path);
    assert.equal(store.chatLearningState().learnedAt, 123);
    store.markChatLearned(135);
    store.close();
    store = new ChatStore(path);
    assert.equal(store.chatLearningState().learnedAt, 135, "再次打开不会覆盖进度");
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
