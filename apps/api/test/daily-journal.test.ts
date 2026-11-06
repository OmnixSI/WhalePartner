import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import { DailyJournalService } from "../src/daily-journal.ts";
import { loadConfig } from "../src/config.ts";
import type { ChatProvider } from "../src/llm/types.ts";
import { FallbackChatProvider } from "../src/llm/router.ts";
import { JournalStore } from "../src/journal-store.ts";
import { createApiServer } from "../src/server.ts";
import { ChatStore } from "../src/store.ts";

function localDayRange(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const from = new Date(year, month - 1, day);
  const to = new Date(year, month - 1, day + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

function shiftLocalDate(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

test("daily journal combines local-day chat and shared media, keeps revisions, and stays out of its own sources", async () => {
  const directory = mkdtempSync(join(tmpdir(), "whale-journal-"));
  const path = join(directory, "chat.db");
  const archive = new ChatStore(path);
  const journals = new JournalStore(path);
  const session = archive.createSession("whale", "今天的聊天");
  archive.add("user", "我今天总算把记忆页面做完了", null, "whale", session.id);
  archive.add("assistant", "你为这件事花了不少心思，我替你开心。", null, "whale", session.id);
  let calls = 0;
  const provider: ChatProvider = {
    id: "fake", model: "diary-test",
    async *stream(messages) {
      calls++;
      assert.ok(messages[1].content.includes("我今天总算把记忆页面做完了"));
      yield { text: "今天陪着用户把记忆页面的事情一点点理顺，能看到他终于完成了，心里也跟着亮堂起来。" };
    },
  };
  const service = new DailyJournalService({ store: journals, archive, provider });
  const today = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  try {
    const first = await service.generate("whale", today);
    assert.ok(first);
    assert.equal(first.id, `journal:whale:${today}`);
    assert.equal(first.sources.filter((source) => source.type === "chat").length, 2);
    assert.equal(first.revision, 1);

    const same = await service.generate("whale", today);
    assert.equal(same?.revision, 1);
    assert.equal(calls, 1);

    archive.upsertExperience({ kind: "video", title: "蓝鲸的一天", text: "观察到蓝鲸在海面换气。", sourceId: "video:journal-test", sourceSessionId: session.id });
    const updated = await service.generate("whale", today);
    assert.equal(updated?.revision, 2);
    assert.equal(updated?.sources.some((source) => source.type === "video"), true);
    assert.equal(journals.revisions(first!.id).length, 2);

    const regenerated = await service.generate("whale", today, true);
    assert.equal(regenerated?.revision, 3);
    assert.equal(journals.revisions(first!.id).length, 3);

    archive.deleteSession(session.id, "whale");
    assert.equal(journals.current("whale", today), undefined);
    assert.equal(archive.experienceBySourceId(first!.id), undefined);
  } finally {
    journals.close();
    archive.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("daily journal source packing keeps evidence from across a long day", async () => {
  const directory = mkdtempSync(join(tmpdir(), "whale-journal-packing-"));
  const path = join(directory, "chat.db");
  const archive = new ChatStore(path);
  const journals = new JournalStore(path);
  const session = archive.createSession("whale", "长对话");
  for (let index = 0; index < 36; index++) {
    archive.add("user", `片段开头 ${index} ${"今天聊到海洋和鲸鱼。".repeat(30)} 片段结尾 ${index}`, null, "whale", session.id);
  }
  let prompt = "";
  const provider: ChatProvider = {
    id: "fake", model: "packing-test",
    async *stream(messages) {
      prompt = messages[1].content;
      yield { text: "今天我们聊了很久，许多细小的话题都留在了这一天里。" };
    },
  };
  const service = new DailyJournalService({ store: journals, archive, provider });
  const today = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  try {
    await service.generate("whale", today);
    assert.match(prompt, /片段开头 0/u);
    assert.match(prompt, /片段结尾 35/u);
    assert.ok(prompt.length < 22_000);
  } finally {
    journals.close();
    archive.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("startup resumes an interrupted journal generation and indexes a saved body without another model call", async () => {
  const directory = mkdtempSync(join(tmpdir(), "whale-journal-resume-"));
  const path = join(directory, "chat.db");
  const archive = new ChatStore(path);
  const journals = new JournalStore(path);
  const session = archive.createSession("whale", "恢复测试");
  archive.add("user", "今天聊了海边的事。", null, "whale", session.id);
  const today = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const bounds = localDayRange(today);
  const sources = archive.journalSources("whale", bounds.from, bounds.to);
  let calls = 0;
  const provider: ChatProvider = {
    id: "fake", model: "resume-test",
    async *stream() { calls++; yield { text: "今天我们聊到了海边。" }; },
  };
  try {
    journals.enqueueTask("whale", today);
    assert.equal(journals.claimTask("whale", today), true);
    journals.save({
      id: `journal:whale:${today}`,
      character: "whale",
      localDate: today,
      text: "已经保存的日记正文。",
      sources,
      modelId: "fake/resume-test",
    });

    const service = new DailyJournalService({ store: journals, archive, provider });
    await service.resumeInterrupted();

    assert.equal(calls, 0);
    assert.equal(journals.task("whale", today)?.status, "complete");
    assert.equal(archive.experienceBySourceId(`journal:whale:${today}`)?.text, "已经保存的日记正文。");
  } finally {
    journals.close();
    archive.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("startup does not restore a pending journal after its source session was deleted", async () => {
  const directory = mkdtempSync(join(tmpdir(), "whale-journal-delete-resume-"));
  const path = join(directory, "chat.db");
  const archive = new ChatStore(path);
  const journals = new JournalStore(path);
  const session = archive.createSession("whale", "删除后恢复");
  archive.add("user", "这段内容之后会被删除。", null, "whale", session.id);
  const today = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  let calls = 0;
  const provider: ChatProvider = {
    id: "fake", model: "deleted-source-test",
    async *stream() { calls++; yield { text: "不应恢复的日记。" }; },
  };
  try {
    journals.enqueueTask("whale", today);
    assert.equal(journals.claimTask("whale", today), true);
    archive.deleteSession(session.id, "whale");

    await new DailyJournalService({ store: journals, archive, provider }).resumeInterrupted();

    assert.equal(calls, 0);
    assert.equal(journals.current("whale", today), undefined);
    assert.equal(journals.task("whale", today)?.status, "complete");
  } finally {
    journals.close();
    archive.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a failed journal generation releases the deletion lock", async () => {
  const directory = mkdtempSync(join(tmpdir(), "whale-journal-lock-"));
  const path = join(directory, "chat.db");
  const archive = new ChatStore(path);
  const journals = new JournalStore(path);
  const session = archive.createSession("whale", "日记锁测试");
  archive.add("user", "今天聊了海边的事。", null, "whale", session.id);
  let start: () => void = () => {};
  let failGeneration: () => void = () => {};
  const started = new Promise<void>((resolve) => { start = resolve; });
  const blocked = new Promise<void>((_resolve, reject) => { failGeneration = () => reject(new Error("模型暂时不可用")); });
  let calls = 0;
  const provider: ChatProvider = {
    id: "fake", model: "lock-recovery-test",
    async *stream() {
      calls++;
      if (calls === 1) {
        start();
        await blocked;
      }
      yield { text: "今天聊起海边，我也想起了那阵清爽的海风。" };
    },
  };
  const service = new DailyJournalService({ store: journals, archive, provider });
  const today = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  try {
    const failedGeneration = service.generate("whale", today);
    await started;
    const acquiringLock = service.lockForSessionDeletion();
    failGeneration();
    await assert.rejects(failedGeneration, /模型暂时不可用/u);
    await assert.rejects(acquiringLock, /模型暂时不可用/u);

    const journal = await service.generate("whale", today);
    assert.ok(journal);
    assert.equal(journal.revision, 1);
    assert.equal(calls, 2);
  } finally {
    journals.close();
    archive.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("daily journal keeps separate occurrences when the same video is watched again", async () => {
  const directory = mkdtempSync(join(tmpdir(), "whale-journal-repeat-"));
  const path = join(directory, "chat.db");
  const archive = new ChatStore(path);
  const journals = new JournalStore(path);
  const session = archive.createSession("whale", "重复看视频");
  const firstMessage = archive.add("user", "第一次看这段视频", null, "whale", session.id);
  const secondMessage = archive.add("user", "过会儿又看了一遍", null, "whale", session.id);
  archive.upsertExperience({ kind: "video", title: "蓝鲸的一天", text: "观察到蓝鲸在海面换气。", sourceId: "video:repeat-test", sourceSessionId: session.id, sourceMessageId: firstMessage.id });
  archive.upsertExperience({ kind: "video", title: "蓝鲸的一天", text: "观察到蓝鲸在海面换气。", sourceId: "video:repeat-test", sourceSessionId: session.id, sourceMessageId: secondMessage.id });
  const provider: ChatProvider = { id: "fake", model: "repeat-test", async *stream() { yield { text: "今天又一起看了蓝鲸的视频。" }; } };
  const service = new DailyJournalService({ store: journals, archive, provider });
  const today = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  try {
    const journal = await service.generate("whale", today);
    const videoSources = journal?.sources.filter((source) => source.type === "video") ?? [];
    assert.equal(videoSources.length, 2);
    assert.deepEqual(videoSources.map((source) => source.messageId).sort(), [firstMessage.id, secondMessage.id].sort());
  } finally {
    journals.close();
    archive.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("journal routes generate, list, and expose prior revisions", async () => {
  const directory = mkdtempSync(join(tmpdir(), "whale-journal-route-"));
  const path = join(directory, "chat.db");
  const archive = new ChatStore(path);
  const journals = new JournalStore(path);
  const session = archive.createSession("whale", "今天的聊天");
  archive.add("user", "我今天去了海边", null, "whale", session.id);
  archive.add("assistant", "海风听起来很舒服。", null, "whale", session.id);
  const retainedSession = archive.createSession("whale", "另一段聊天");
  const retainedMessage = archive.add("user", "后来又聊了海里的小鱼", null, "whale", retainedSession.id);
  const provider: ChatProvider = { id: "fake", model: "route-test", async *stream() { yield { text: "今天你跟我说了海边的事，我也跟着想象了一下那阵海风。" }; } };
  const journal = new DailyJournalService({ store: journals, archive, provider });
  const today = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  for (const date of [shiftLocalDate(today, -2), shiftLocalDate(today, -1)]) journals.save({
    id: `journal:whale:${date}`,
    character: "whale",
    localDate: date,
    text: `日期 ${date} 的日记。`,
    sources: [],
    modelId: "fake/route-test",
  });
  const server = createApiServer({ config: loadConfig({}), provider: new FallbackChatProvider([provider]), store: archive, journal });
  const base = await new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  try {
    const generated = await fetch(`${base}/api/journals/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ character: "whale", date: today }) });
    assert.equal(generated.status, 200);
    const body = await generated.json() as { journal: { id: string; revision: number } };
    assert.equal(body.journal.id, `journal:whale:${today}`);
    assert.equal(body.journal.revision, 1);
    const listed = await fetch(`${base}/api/journals?character=whale`);
    assert.equal((await listed.json() as { items: unknown[]; total: number }).total, 3);
    const page = await fetch(`${base}/api/journals?character=whale&from=${shiftLocalDate(today, -2)}&to=${today}&limit=1&offset=1`);
    const pageBody = await page.json() as { items: Array<{ localDate: string }>; total: number };
    assert.equal(pageBody.total, 3);
    assert.equal(pageBody.items[0].localDate, shiftLocalDate(today, -1));
    const invalidDate = await fetch(`${base}/api/journals?character=whale&from=2026-02-30&to=${today}`);
    assert.equal(invalidDate.status, 400);
    const revisions = await fetch(`${base}/api/journals/${encodeURIComponent(body.journal.id)}/revisions`);
    assert.equal((await revisions.json() as { revisions: unknown[] }).revisions.length, 1);
    const deleted = await fetch(`${base}/api/chat/sessions/${session.id}?character=whale`, { method: "DELETE" });
    assert.equal(deleted.status, 200);
    const afterDelete = await fetch(`${base}/api/journals?character=whale`);
    const refreshed = (await afterDelete.json() as { items: Array<{ sources: Array<{ id: string }> }> }).items[0];
    assert.ok(refreshed.sources.some((source) => source.id === `message:${retainedMessage.id}`));
    assert.equal(refreshed.sources.some((source) => source.id.startsWith("message:") && source.id !== `message:${retainedMessage.id}`), false);
    const invalid = await fetch(`${base}/api/journals/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ character: "unknown" }) });
    assert.equal(invalid.status, 400);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    journals.close();
    archive.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
