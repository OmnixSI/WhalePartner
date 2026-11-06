import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";
import { DiaryStore } from "../src/diary-store.ts";
import { DiaryService } from "../src/diary-service.ts";
import { FallbackChatProvider } from "../src/llm/router.ts";
import { isExclusiveActive } from "../src/locks.ts";
import type { ExperienceInput, MemoryEntry, MemoryStore } from "../src/memory/types.ts";
import { getNickname, setNickname } from "../src/profile.ts";
import { QuotaService } from "../src/quota.ts";
import { createApiServer } from "../src/server.ts";
import { ChatStore } from "../src/store.ts";
import type { VideoService } from "../src/video-service.ts";

function fakeManager() {
  const entries: MemoryEntry[] = [];
  let delay = 0;
  const memory: MemoryStore = {
    async remember() {},
    async recall() { return []; },
    async recentExperiences() { return []; },
    async recentLearnings() { return []; },
    async addExperience(input: ExperienceInput) {
      const entry: MemoryEntry = { id: `e${entries.length + 1}`, kind: "experience", text: input.text };
      entries.push(entry);
      return entry;
    },
    async list() {
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      return entries.map((entry) => ({ ...entry }));
    },
    async remove(id: string) {
      const index = entries.findIndex((entry) => entry.id === id);
      if (index >= 0) entries.splice(index, 1);
    },
  };
  return { memory, entries, setDelay: (value: number) => { delay = value; } };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000) {
  const end = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= end) throw new Error("等待超时。");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function counts(store: ChatStore): Record<string, number> {
  const tables = ["messages", "character_notes", "user_profile", "usage_ledger", "memory_seq", "memory_seq_counter"];
  const result: Record<string, number> = {};
  for (const table of tables) {
    const row = store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as unknown as { n: number };
    result[table] = Number(row.n);
  }
  return result;
}

test("DELETE /api/data needs confirm=DELETE_ALL, then clears every whitelisted table", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "whalepartner-delete-"));
  const store = new ChatStore(join(dir, "app.db"));
  const diaryStore = new DiaryStore(join(dir, "app.db"));
  const { memory, entries, setDelay } = fakeManager();
  entries.push({ id: "f1", kind: "fact", text: "用户养了一只叫团子的猫" });
  const provider = new FallbackChatProvider([{ id: "fake", model: "fake", async *stream() { yield { text: "好" }; } }]);
  const config = loadConfig({});
  const quota = new QuotaService(store.db, config);
  const video: VideoService = {
    async collect() { throw new Error("测试不读视频"); },
    async summarize() { throw new Error("测试不读视频"); },
  };
  const diary = new DiaryService({ store: diaryStore, provider, memory, video });
  const server = createApiServer({ config, provider, store, memory, quota, diary });
  const base = await new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    diaryStore.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  const seed = () => {
    store.add("user", "你好");
    store.add("assistant", "你好呀", "happy");
    store.setNote("whale", "今天心情不错。", 1);
    setNickname(store.db, "小周");
    quota.record("chat", 1);
    const item = diaryStore.enqueue("BV1TESTTEST1").item;
    diaryStore.saveDiary(item.id, "今天看鲸鱼。");
  };
  seed();
  assert.equal(counts(store).messages, 2);

  const wrong = await fetch(`${base}/api/data`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: "nope" }) });
  assert.equal(wrong.status, 400);
  const wrongBody = (await wrong.json()) as { error: string; message: string };
  assert.equal(wrongBody.error, "confirm_required");
  assert.match(wrongBody.message, /DELETE_ALL/);
  assert.equal(counts(store).messages, 2);
  assert.equal(diaryStore.list().length, 1);

  const missing = await fetch(`${base}/api/data`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
  assert.equal(missing.status, 400);

  const ok = await fetch(`${base}/api/data`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: "DELETE_ALL" }) });
  assert.equal(ok.status, 200);
  const okBody = (await ok.json()) as { ok: boolean; deleted: Record<string, number> };
  assert.equal(okBody.ok, true);
  assert.equal(okBody.deleted.messages, 2);
  assert.equal(okBody.deleted.diary_items, 1);
  assert.equal(okBody.deleted.user_profile, 1);
  assert.deepEqual(counts(store), { messages: 0, character_notes: 0, user_profile: 0, usage_ledger: 0, memory_seq: 0, memory_seq_counter: 0 });
  assert.equal(getNickname(store.db), null);
  assert.equal(diaryStore.list().length, 0);
  assert.equal(entries.length, 0);
  assert.equal(getNickname(store.db), null);

  const memories = (await (await fetch(`${base}/api/memories`)).json()) as { entries: MemoryEntry[] };
  assert.deepEqual(memories.entries, []);
  const journals = (await (await fetch(`${base}/api/diary`)).json()) as { items: unknown[] };
  assert.deepEqual(journals.items, []);
  const profile = (await (await fetch(`${base}/api/profile`)).json()) as { nickname: string | null };
  assert.equal(profile.nickname, null);

  // 删除过程中并发的聊天请求被锁挡住。
  seed();
  setDelay(150);
  const deleting = fetch(`${base}/api/data`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: "DELETE_ALL" }) });
  await waitFor(() => isExclusiveActive());
  const busy = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "在吗" }) });
  assert.equal(busy.status, 409);
  assert.equal(((await busy.json()) as { error: string }).error, "busy");
  assert.equal((await deleting).status, 200);
  assert.equal(isExclusiveActive(), false);
});
