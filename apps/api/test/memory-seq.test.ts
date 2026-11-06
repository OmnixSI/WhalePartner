import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";
import { FallbackChatProvider } from "../src/llm/router.ts";
import { clearAllData } from "../src/maintenance.ts";
import type { ExperienceInput, MemoryEntry, MemoryStore } from "../src/memory/types.ts";
import { createApiServer } from "../src/server.ts";
import { ChatStore } from "../src/store.ts";

function fakeMemory(seed: MemoryEntry[] = []) {
  const entries = [...seed];
  const memory: MemoryStore = {
    async remember() {},
    async recall() { return []; },
    async recentExperiences() { return []; },
    async recentLearnings() { return []; },
    async addExperience(input: ExperienceInput) {
      const entry: MemoryEntry = { id: `m${entries.length + 1}`, kind: "experience", text: input.text, createdAt: new Date().toISOString() };
      entries.push(entry);
      return entry;
    },
    async list() { return entries.map((entry) => ({ ...entry })); },
    async remove(id: string) {
      const index = entries.findIndex((entry) => entry.id === id);
      if (index >= 0) entries.splice(index, 1);
    },
  };
  return { memory, entries };
}

function memories(count: number, kind: MemoryEntry["kind"] = "fact"): MemoryEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `s${index + 1}`,
    kind,
    text: `记忆 ${index + 1}`,
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString(),
  }));
}

async function withServer(store: ChatStore, memory: MemoryStore, run: (base: string) => Promise<void>) {
  const config = loadConfig({});
  const server = createApiServer({ config, provider: new FallbackChatProvider([{ id: "fake", model: "fake", async *stream() { yield { text: "好" }; } }]), store, memory });
  const base = await new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  try {
    await run(base);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function list(base: string, character?: string) {
  const res = await fetch(`${base}/api/memories${character ? `?character=${character}` : ""}`);
  assert.equal(res.status, 200);
  return ((await res.json()) as { entries: Array<MemoryEntry & { seq: number | null }> }).entries;
}

test("an old library assigns numbers 1..n by creation order on the first list", async () => {
  const store = new ChatStore(":memory:");
  const { memory } = fakeMemory(memories(5));
  await withServer(store, memory, async (base) => {
    const entries = await list(base);
    assert.deepEqual(entries.map((entry) => [entry.id, entry.seq]), [["s1", 1], ["s2", 2], ["s3", 3], ["s4", 4], ["s5", 5]]);
  });
  store.close();
});

test("new memories continue from the counter and deleted numbers are never reused", async () => {
  const store = new ChatStore(":memory:");
  const { memory, entries } = fakeMemory(memories(5));
  await withServer(store, memory, async (base) => {
    assert.deepEqual((await list(base)).map((entry) => entry.seq), [1, 2, 3, 4, 5]);
    entries.push({ id: "s6", kind: "fact", text: "记忆 6", createdAt: "2026-11-01T00:00:00.000Z" });
    entries.push({ id: "s7", kind: "experience", text: "记忆 7", createdAt: "2026-11-02T00:00:00.000Z" });
    assert.deepEqual((await list(base)).map((entry) => entry.seq), [1, 2, 3, 4, 5, 6, 7]);

    const third = entries.findIndex((entry) => entry.id === "s3");
    entries.splice(third, 1);
    const afterDelete = await list(base);
    assert.deepEqual(afterDelete.map((entry) => [entry.id, entry.seq]), [["s1", 1], ["s2", 2], ["s4", 4], ["s5", 5], ["s6", 6], ["s7", 7]]);

    entries.push({ id: "s8", kind: "fact", text: "记忆 8", createdAt: "2026-11-03T00:00:00.000Z" });
    const afterAdd = await list(base);
    assert.equal(afterAdd.find((entry) => entry.id === "s8")?.seq, 8);
    assert.equal(new Set(afterAdd.map((entry) => entry.seq)).size, afterAdd.length);
  });
  store.close();
});

test("each character has its own numbering from 1", async () => {
  const store = new ChatStore(":memory:");
  const { memory } = fakeMemory(memories(3));
  await withServer(store, memory, async (base) => {
    assert.deepEqual((await list(base, "whale")).map((entry) => entry.seq), [1, 2, 3]);
    assert.deepEqual((await list(base, "claude")).map((entry) => entry.seq), [1, 2, 3]);
    assert.deepEqual((await list(base, "whale")).map((entry) => entry.seq), [1, 2, 3]);
  });
  store.close();
});

test("concurrent list requests never hand out the same number twice", async () => {
  const store = new ChatStore(":memory:");
  const { memory } = fakeMemory(memories(6));
  await withServer(store, memory, async (base) => {
    const results = await Promise.all(Array.from({ length: 5 }, () => list(base)));
    for (const entries of results) {
      assert.equal(new Set(entries.map((entry) => entry.seq)).size, 6);
      assert.deepEqual(entries.map((entry) => entry.seq), [1, 2, 3, 4, 5, 6]);
    }
  });
  store.close();
});

test("clearing all data resets the counter so numbering starts at 1 again", async () => {
  const store = new ChatStore(":memory:");
  const { memory, entries } = fakeMemory(memories(3));
  await withServer(store, memory, async (base) => {
    assert.deepEqual((await list(base)).map((entry) => entry.seq), [1, 2, 3]);
    await clearAllData({ db: store.db, memory });
    assert.equal(entries.length, 0);
    const counter = store.db.prepare("SELECT COUNT(*) AS n FROM memory_seq_counter").get() as unknown as { n: number };
    assert.equal(Number(counter.n), 0);

    entries.push({ id: "n1", kind: "fact", text: "新的记忆", createdAt: "2026-11-05T00:00:00.000Z" });
    const fresh = await list(base);
    assert.deepEqual(fresh.map((entry) => [entry.id, entry.seq]), [["n1", 1]]);
  });
  store.close();
});
