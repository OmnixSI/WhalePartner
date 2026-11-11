import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { FallbackChatProvider } from "../src/llm/router.ts";
import type { ChatProvider } from "../src/llm/types.ts";
import { loadConfig } from "../src/server/config.ts";
import { createApiServer } from "../src/server.ts";
import { ChatStore } from "../src/store/index.ts";

const silent: ChatProvider = { id: "fake", model: "m", async *stream() { yield { text: "嗯" }; } };

test("memory entries get stable No. starting from 1, and old zero numbers are repaired", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wp-seq-"));
  const store = new ChatStore(join(dir, "app.db"));
  // 模拟旧版本留下的坏数据：编号全是 0，计数表里一行 character 为 NULL。
  const legacy = new DatabaseSync(store.dbPath);
  legacy.exec(`
    CREATE TABLE IF NOT EXISTS memory_seq (character TEXT NOT NULL, ref TEXT NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY (character, ref));
    CREATE TABLE IF NOT EXISTS memory_seq_counter (character TEXT PRIMARY KEY, next INTEGER NOT NULL);
    INSERT INTO memory_seq_counter VALUES (NULL, 1);
  `);
  legacy.close();
  store.upsertExperience({ kind: "video", title: "蓝鲸的一天", text: "一起看了蓝鲸换气。", sourceId: "video:BV1seq0001" });
  store.upsertExperience({ kind: "web", title: "海玻璃", text: "读了海玻璃怎么形成。", sourceId: "web:seq-2" });
  const server = createApiServer({ config: loadConfig({ WP_DATA_DIR: dir }), provider: new FallbackChatProvider([silent]), store });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const read = async () => ((await (await fetch(`${base}/api/memories`)).json()) as { entries: Array<{ id: string; seq: number | null }> }).entries;
    const first = await read();
    assert.ok(first.length >= 2);
    const numbers = first.map((entry) => entry.seq);
    assert.ok(numbers.every((seq) => typeof seq === "number" && seq >= 1), JSON.stringify(numbers));
    assert.equal(new Set(numbers).size, numbers.length, "编号不能重复");
    const second = await read();
    assert.deepEqual(second.map((entry) => [entry.id, entry.seq]), first.map((entry) => [entry.id, entry.seq]), "第二次读编号不变");
    const check = new DatabaseSync(store.dbPath);
    assert.equal((check.prepare("SELECT COUNT(*) AS n FROM memory_seq_counter WHERE character IS NULL").get() as { n: number }).n, 0);
    check.close();
  } finally {
    server.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a fact whose vector is already gone can still be deleted", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wp-forget-"));
  const store = new ChatStore(join(dir, "app.db"));
  const removed: string[] = [];
  const memory = {
    async list() { return []; },
    async remove(id: string) {
      removed.push(id);
      throw new Error(`Memory with ID ${id} not found`);
    },
  } as unknown as Parameters<typeof createApiServer>[0]["memory"];
  const session = store.getOrCreateSession("whale");
  const user = store.add("user", "我住在北京", null, "whale", session.id);
  const { facts } = store.saveFacts(user.id, [{
    subject: "用户", predicate: "住址", value: "北京", kind: "fact", evidence: "我住在北京", confidence: 0.9, importance: 0.6, supersedes: false,
  }]);
  const fact = facts[0];
  store.setFactVectorId(fact.id, "vector-already-removed");
  const server = createApiServer({ config: loadConfig({ WP_DATA_DIR: dir }), provider: new FallbackChatProvider([silent]), store, memory });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const response = await fetch(`${base}/api/memories/local:${fact.id}`, { method: "DELETE" });
    assert.equal(response.status, 200);
    assert.deepEqual(removed, ["vector-already-removed"]);
    assert.equal(store.getFact(fact.id), undefined, "事实本身要删掉");
  } finally {
    server.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
