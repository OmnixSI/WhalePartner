import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { inflateRawSync } from "node:zlib";
import type { ChatProvider } from "../src/llm/types.ts";
import { loadConfig } from "../src/server/config.ts";
import { FallbackChatProvider } from "../src/llm/router.ts";
import { createApiServer } from "../src/server.ts";
import type { ServerDeps } from "../src/server/types.ts";
import { ChatStore } from "../src/store/index.ts";

/** B2：导出与删除全部的契约。数据目录一律用临时目录，不碰开发者的 apps/api/.local。 */

function fakeProvider(): ChatProvider {
  return {
    id: "deepseek",
    model: "deepseek-model",
    async *stream() { yield { type: "delta" as const, text: "嗯。" }; },
  } as unknown as ChatProvider;
}

function serve(extra: Partial<ServerDeps> = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "wp-export-"));
  const config = loadConfig({ WP_DATA_DIR: dataDir });
  // 和正式服务一样：聊天、昵称、额度都在同一个数据库文件里。
  const store = new ChatStore(config.dbPath);
  const provider = new FallbackChatProvider([fakeProvider()]);
  const server = createApiServer({ config, provider, store, ...extra });
  return new Promise<{ base: string; close: () => void; store: ChatStore; config: typeof config }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        base: `http://127.0.0.1:${port}`,
        close: () => { server.close(); store.close(); rmSync(dataDir, { recursive: true, force: true }); },
        store,
        config,
      });
    });
  });
}

/** 只读本地文件头就够了：我们自己的 zip 每个文件都带压缩后长度。 */
function unzip(bytes: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    const method = bytes.readUInt16LE(offset + 8);
    const size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const start = offset + 30 + nameLength + extraLength;
    const data = bytes.subarray(start, start + size);
    files.set(name, method === 8 ? inflateRawSync(data) : data);
    offset = start + size;
  }
  return files;
}

async function exportZip(base: string) {
  const created = await fetch(`${base}/api/export`, { method: "POST" });
  assert.equal(created.status, 201);
  const { id } = (await created.json()) as { id: string };
  const download = await fetch(`${base}/api/export?id=${encodeURIComponent(id)}`);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("content-type"), "application/zip");
  return Buffer.from(await download.arrayBuffer());
}

async function deleteAll(base: string, confirm = "DELETE_ALL") {
  return fetch(`${base}/api/data`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirm }),
  });
}

test("export packs a zip and delete-all needs an explicit confirmation", async () => {
  const { base, close, store } = await serve();
  try {
    const session = store.getOrCreateSession("whale");
    store.add("user", "我想记住海玻璃要滚三天沙子", null, "whale", session.id);

    const bytes = await exportZip(base);
    assert.equal(bytes.subarray(0, 2).toString("latin1"), "PK", "zip 必须以本地文件头开头");

    const missing = await fetch(`${base}/api/export?id=nope`);
    assert.equal(missing.status, 404);

    const refused = await deleteAll(base, "nope");
    assert.equal(refused.status, 400);
    assert.equal((await refused.json()).error, "confirm_required");

    const removed = await deleteAll(base);
    assert.equal(removed.status, 200);
    assert.equal(store.recent(10, "whale").length, 0, "删除全部之后聊天记录应为空");
  } finally {
    close();
  }
});

test("export keeps every message instead of the newest 500", async () => {
  const { base, close, store } = await serve();
  try {
    const session = store.getOrCreateSession("whale");
    for (let index = 0; index < 600; index += 1) store.add("user", `第 ${index} 句`, null, "whale", session.id);
    const files = unzip(await exportZip(base));
    const messages = JSON.parse(files.get("chat/messages.json")!.toString("utf8")) as unknown[];
    assert.equal(messages.length, 600);
    for (const name of ["diary/journals.json", "diary/video-diary.json", "surf/items.json", "relationship.json", "profile.json", "usage.json"]) {
      assert.ok(files.has(name), `导出里应有 ${name}`);
    }
  } finally {
    close();
  }
});

test("delete-all removes every kind of user data but keeps settings", async () => {
  const removedVectors: string[] = [];
  let vectors = Array.from({ length: 3 }, (_, index) => ({ id: `vector-${index}`, kind: "experience" }));
  const memory = {
    async list() { return vectors.slice(0, 2); },
    async remove(id: string) { removedVectors.push(id); vectors = vectors.filter((entry) => entry.id !== id); },
  } as unknown as ServerDeps["memory"];
  let loggedOut = false;
  const accounts = { async logout() { loggedOut = true; } } as unknown as ServerDeps["accounts"];
  const { base, close, store, config } = await serve({ memory, accounts });
  try {
    const session = store.getOrCreateSession("deepseek");
    const user = store.add("user", "我下周去青岛看海", null, "deepseek", session.id);
    const assistant = store.add("assistant", "好呀", "happy", "deepseek", session.id);
    store.recordCompletedInteraction({ userMessageId: user.id, assistantMessageId: assistant.id, character: "deepseek", emotion: "happy" });
    store.upsertExperience({ kind: "video", title: "海边日落", text: "一起看了海边日落的视频。", sourceId: "video:BV1test" });
    store.putCompanionSettings({ enabled: false });
    const profile = await fetch(`${base}/api/profile`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ userName: "阿明" }) });
    assert.equal(profile.status, 200);

    const thumbs = join(config.surfDir, "thumbs");
    mkdirSync(thumbs, { recursive: true });
    writeFileSync(join(thumbs, "1.jpg"), "jpg");
    mkdirSync(config.memoryDir, { recursive: true });
    const history = new DatabaseSync(join(config.memoryDir, "history.db"));
    history.exec("CREATE TABLE memory_history (id TEXT, new_value TEXT); INSERT INTO memory_history VALUES ('1', '我下周去青岛看海');");
    history.close();

    assert.ok(store.relationshipSnapshot("deepseek").points > 0);
    const removed = await deleteAll(base);
    assert.equal(removed.status, 200);
    assert.deepEqual(await removed.json(), { ok: true, memoriesCleared: true });

    assert.equal(store.recent(10).length, 0);
    assert.equal(store.listExperiences(10, true).length, 0, "视频、网页经历也要删掉");
    assert.equal(store.relationshipSnapshot("deepseek").points, 0, "好感度要清零");
    assert.equal(store.companionSettings().enabled, false, "陪伴设置属于配置，要保留");
    assert.equal(((await (await fetch(`${base}/api/profile`)).json()) as { userName: string | null }).userName, null, "昵称要清掉");
    assert.deepEqual(removedVectors.sort(), ["vector-0", "vector-1", "vector-2"], "向量要分几轮全部删掉");
    assert.equal(existsSync(thumbs), false, "见闻封面要删掉");
    const after = new DatabaseSync(join(config.memoryDir, "history.db"));
    assert.equal((after.prepare("SELECT COUNT(*) AS n FROM memory_history").get() as { n: number }).n, 0, "mem0 的变更历史要清空");
    after.close();
    assert.equal(loggedOut, true, "B 站登录要退出");
  } finally {
    close();
  }
});

test("export includes the current note, every note version and session observations", async () => {
  const { base, close, store } = await serve();
  try {
    const session = store.getOrCreateSession("whale");
    const first = store.add("user", "周末想去海边", null, "whale", session.id);
    const last = store.add("assistant", "好呀，带上那块海玻璃", null, "whale", session.id);
    store.setNote("whale", "导出里应有的第一版近况", 12);
    store.setNote("whale", "导出里应有的第二版近况", 24);
    store.saveObservation(session.id, "导出里应有的聊天观察", first.id, last.id);

    const files = unzip(await exportZip(base));
    const read = (name: string) => {
      assert.ok(files.has(name), `导出里应有 ${name}`);
      return files.get(name)!.toString("utf8");
    };
    assert.match(read("memories/note.json"), /导出里应有的第二版近况/);
    const history = read("memories/note-history.json");
    assert.match(history, /导出里应有的第一版近况/);
    assert.match(history, /导出里应有的第二版近况/);
    assert.match(read("memories/session-observations.json"), /导出里应有的聊天观察/);
  } finally {
    close();
  }
});
