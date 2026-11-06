import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { inflateRawSync } from "node:zlib";
import { loadConfig } from "../src/config.ts";
import { DiaryStore } from "../src/diary-store.ts";
import { FallbackChatProvider } from "../src/llm/router.ts";
import type { ChatProvider } from "../src/llm/types.ts";
import type { ExperienceInput, MemoryEntry, MemoryStore } from "../src/memory/types.ts";
import { setNickname } from "../src/profile.ts";
import { QuotaService } from "../src/quota.ts";
import { createApiServer } from "../src/server.ts";
import { ChatStore } from "../src/store.ts";

function fakeProvider(): ChatProvider {
  return { id: "fake", model: "fake", async *stream() { yield { text: "好" }; } };
}

function fakeMemory(seed: MemoryEntry[] = []) {
  const entries = [...seed];
  const memory: MemoryStore = {
    async remember() {},
    async recall() { return []; },
    async recentExperiences() { return []; },
    async recentLearnings() { return []; },
    async addExperience(input: ExperienceInput) {
      const entry: MemoryEntry = { id: `e${entries.length + 1}`, kind: "experience", text: input.text, title: input.title, url: input.url, sourceId: input.sourceId };
      entries.push(entry);
      return entry;
    },
    async list() { return entries.map((entry) => ({ ...entry })); },
    async remove() {},
  };
  return { memory, entries };
}

/** 手写 zip 读取：中央目录 → 本地文件头 → inflateRawSync。等价于 `unzip -p`。 */
function readZip(buffer: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  assert.notEqual(eocd, -1, "找不到 zip 结束记录");
  const count = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  for (let index = 0; index < count; index += 1) {
    assert.equal(buffer.readUInt32LE(cursor), 0x02014b50, "中央目录签名不对");
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    assert.equal(buffer.readUInt32LE(localOffset), 0x04034b50, `本地文件头签名不对：${name}`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = buffer.subarray(dataStart, dataStart + compressedSize);
    files.set(name, method === 0 ? Buffer.from(data) : inflateRawSync(data));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

test("POST /api/export writes a readable zip with manifest counts and no credentials", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "whalepartner-export-"));
  const store = new ChatStore(join(dir, "app.db"));
  const diaryStore = new DiaryStore(join(dir, "app.db"));
  const { memory, entries } = fakeMemory([
    { id: "f1", kind: "fact", text: "用户养了一只叫团子的猫", createdAt: "2026-11-01T00:00:00.000Z" },
    { id: "e1", kind: "experience", text: "鲸鱼纪录片\n讲了发光水母", source: "video", title: "鲸鱼纪录片", createdAt: "2026-11-02T00:00:00.000Z" },
  ]);
  const config = loadConfig({ EXPORT_DIR: dir });
  const provider = new FallbackChatProvider([fakeProvider()]);
  const quota = new QuotaService(store.db, config);
  const server = createApiServer({ config, provider, store, memory, quota });
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    diaryStore.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  store.add("user", "你好");
  store.add("assistant", "你好呀", "happy", "whale", { kind: "video", title: "鲸鱼的歌声" });
  setNickname(store.db, "小周");
  quota.record("chat", 1, { character: "whale" });
  const item = diaryStore.enqueue("BV1TESTTEST1").item;
  diaryStore.saveDiary(item.id, "今天听鲸鱼的歌声，想起声音也能把远处的生命连在一起。");
  diaryStore.saveDiaryMeta(item.id, { mood: "happy", weather: "sunny", title: "海边的声音" });

  const base = await new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  const res = await fetch(`${base}/api/export`, { method: "POST" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; path: string; bytes: number; files: number; createdAt: string };
  assert.equal(body.ok, true);
  assert.ok(body.path.startsWith(dir), body.path);
  assert.equal(existsSync(body.path), true);
  assert.ok(body.bytes > 0);
  assert.ok(body.files >= 8);
  assert.match(body.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(entries.length === 2);

  const zip = readZip(await readFile(body.path));
  for (const name of ["manifest.json", "README.txt", "profile.json", "messages.json", "memories/facts.json", "memories/experiences.json", "diary.json", "usage.json", "memory-seq.json"]) {
    assert.equal(zip.has(name), true, `zip 缺文件：${name}`);
  }
  const manifest = JSON.parse(zip.get("manifest.json")!.toString("utf8")) as { app: string; version: string; exportedAt: string; counts: Record<string, number> };
  assert.equal(manifest.app, "WhalePartner");
  assert.equal(manifest.exportedAt, body.createdAt);
  assert.equal(manifest.counts.messages, 2);
  assert.equal(manifest.counts.diary_items, 1);
  assert.equal(manifest.counts.usage_ledger, 1);
  assert.equal(manifest.counts.user_profile, 1);
  assert.equal(manifest.counts.facts, 1);
  assert.equal(manifest.counts.experiences, 1);

  const messages = JSON.parse(zip.get("messages.json")!.toString("utf8")) as Array<{ attachment: unknown }>;
  assert.deepEqual(messages[1].attachment, { kind: "video", title: "鲸鱼的歌声" });
  assert.equal(messages[0].attachment, null);
  const diary = JSON.parse(zip.get("diary.json")!.toString("utf8")) as Array<{ mood: string; weather: string; diaryTitle: string }>;
  assert.deepEqual([diary[0].mood, diary[0].weather, diary[0].diaryTitle], ["happy", "sunny", "海边的声音"]);
  const profile = JSON.parse(zip.get("profile.json")!.toString("utf8")) as { nickname: string };
  assert.equal(profile.nickname, "小周");

  for (const [name, data] of zip) {
    assert.equal(/token|cookie|sessdata/i.test(data.toString("utf8")), false, `${name} 里出现了凭据字样`);
  }

  const download = await fetch(`${base}/api/export`);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("content-type"), "application/zip");
  assert.match(download.headers.get("content-disposition") ?? "", /^attachment; filename="whalepartner-export-\d{8}-\d{6}\.zip"$/);
  const downloaded = readZip(Buffer.from(await download.arrayBuffer()));
  assert.equal(downloaded.has("manifest.json"), true);
});
