import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ApiConfig } from "../src/server/config.ts";
import type { ChatMessage, ChatProvider, LlmDelta, StreamOptions } from "../src/llm/types.ts";
import type { ExperienceInput, MemoryEntry, MemoryStore } from "../src/memory/types.ts";
import { SurfRepository } from "../src/surf/store.ts";
import type { VideoCandidate, VideoSource, WebPageText, WebResult, WebSource } from "../src/surf/types.ts";

/** 测试用的假件集合：不连外网、不依赖任何真实 provider。 */

export function tempDb(name = "surf"): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), `wp-${name}-`));
  return { dir, path: join(dir, "app.db") };
}

export function baseConfig(overrides: Partial<ApiConfig> = {}): ApiConfig {
  const { dir } = tempDb("cfg");
  return {
    host: "127.0.0.1",
    dbPath: join(dir, "app.db"),
    memoryEnabled: false,
    memoryDir: join(dir, "memory"),
    port: 0,
    diaryCron: "0 20 * * *",
    journalCron: "0 22 * * *",
    codexFallback: false,
    llmTimeoutMs: 10_000,
    surfEnabled: true,
    surfDir: join(dir, "surf"),
    ...overrides,
  } as ApiConfig;
}

/** 按提示词内容回不同的 JSON，模拟一次完整会话里的几次模型调用。 */
export function replyFor(messages: ChatMessage[]): string {
  const user = messages.filter((message) => message.role === "user").map((message) => message.content).join("\n");
  if (user.includes("worth_sharing")) {
    const title = /标题：(.+)/.exec(user)?.[1]?.trim() ?? "某个东西";
    return JSON.stringify({
      summary: `这是关于${title}的一段客观摘要，写清了它讲了什么，长度也够撑起一张明信片。`.repeat(2).slice(0, 120),
      comment: "这个我想讲给你听。",
      tags: ["海洋", "记录"],
      worth_sharing: 5,
      safe: true,
    });
  }
  if (user.includes("顺口讲给对方听")) return "我今天看到一段特别安静的视频，讲的正是你喜欢的那种海。";
  if (user.includes("想看的那一个的编号")) return JSON.stringify({ index: 0, reason: "看起来会很有意思。" });
  if (user.includes("挑不超过")) return JSON.stringify({ picks: [{ index: 0 }, { index: 1 }] });
  if (user.includes("提炼不超过 4 个")) return JSON.stringify({ topics: ["海洋", "手帐"] });
  return "嗯。";
}

export function fakeProvider(reply: (messages: ChatMessage[]) => string = replyFor) {
  const calls: ChatMessage[][] = [];
  const provider: ChatProvider = {
    id: "fake",
    model: "fake-1",
    async *stream(messages: ChatMessage[], _options: StreamOptions = {}): AsyncGenerator<LlmDelta> {
      calls.push(messages);
      yield { text: reply(messages) };
    },
  };
  return { provider, calls };
}

export function makeStore(): { store: SurfRepository; dir: string; path: string } {
  const { dir, path } = tempDb("store");
  return { store: new SurfRepository(path), dir, path };
}

export function videoCandidate(overrides: Partial<VideoCandidate> = {}): VideoCandidate {
  return {
    bvid: "BV1xx411c7mD",
    title: "深海里的声音",
    author: "海洋频道",
    durationSeconds: 300,
    play: 12000,
    description: "记录深海里的声音。",
    pic: "https://i0.hdslb.com/thumb.jpg",
    url: "https://www.bilibili.com/video/BV1xx411c7mD",
    ...overrides,
  };
}

export function fakeVideo(overrides: Partial<VideoSource> = {}): VideoSource & { searches: string[] } {
  const searches: string[] = [];
  let round = 0;
  return {
    searches,
    async search(keyword) {
      searches.push(keyword);
      round += 1;
      // 每次搜索给不同的 BV 号，模拟“隔一会儿又刷到新视频”。
      return [videoCandidate({ bvid: `BV1xx411c7m${round % 10}`, url: `https://www.bilibili.com/video/BV1xx411c7m${round % 10}` })];
    },
    async watch(candidate) {
      return { bvid: candidate.bvid, title: candidate.title, url: candidate.url, text: `${candidate.bvid} 这支视频里讲了鲸歌的三种用法，还有一段水下录音，作者特意在深夜录下了整整二十分钟的海浪声。` };
    },
    ...overrides,
  };
}

export function webResult(overrides: Partial<WebResult> = {}): WebResult {
  return { title: "鲸歌是什么", url: "https://example.com/a", snippet: "讲鲸歌的科普。", ...overrides };
}

export function fakeWeb(options: { delayMs?: number; available?: boolean; /** 每次搜索都换一批地址（模拟真在逛新东西） */ fixed?: boolean } = {}): WebSource & { searches: string[]; reads: string[] } {
  const searches: string[] = [];
  const reads: string[] = [];
  let round = 0;
  return {
    searches,
    reads,
    async search(keyword) {
      searches.push(keyword);
      round += 1;
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      const tag = options.fixed === false ? `?n=${round}` : "";
      return [webResult({ url: `https://example.com/a${tag}` }), webResult({ url: `https://example.org/b${tag}`, title: "鲸歌二" })];
    },
    async read(url): Promise<WebPageText> {
      reads.push(url);
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      return {
        url,
        title: `读到的 ${url}`,
        text: `来自 ${url} 的一篇网页。${"这是一篇讲鲸歌的网页，正文有两百多个字……".repeat(12)}`,
        siteName: new URL(url).hostname.replace(/^www\./, ""),
      };
    },
    async available() {
      return options.available ?? true;
    },
  };
}

export function fakeMemory(): MemoryStore & { added: ExperienceInput[]; removed: string[] } {
  const added: ExperienceInput[] = [];
  const removed: string[] = [];
  let seq = 0;
  const store: MemoryStore & { added: ExperienceInput[]; removed: string[] } = {
    added,
    removed,
    async remember() {},
    async recall() {
      return [];
    },
    async recentExperiences() {
      return [];
    },
    async recentLearnings() {
      return [];
    },
    async addExperience(input: ExperienceInput) {
      added.push(input);
      seq += 1;
      const entry: MemoryEntry = { id: `exp-${seq}`, text: input.text, kind: "experience", title: input.title, url: input.url, sourceId: input.sourceId };
      return entry;
    },
    async list() {
      return [];
    },
    async remove(id: string) {
      removed.push(id);
    },
  };
  return store;
}

/** 在同一个临时库里补一张 messages 表并塞一条聊天记录（冲浪只给活跃角色跑）。 */
export function seedChat(path: string, character = "whale", content = "在吗", at = new Date().toISOString()) {
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT, content TEXT, character TEXT, created_at TEXT)");
  db.prepare("INSERT INTO messages (role, content, character, created_at) VALUES ('user', ?, ?, ?)").run(content, character, at);
  db.close();
}

export function messageSink() {
  const added: Array<{ id: number; role: string; content: string; character?: string }> = [];
  let next = 100;
  return {
    added,
    add(role: "user" | "assistant", content: string, _emotion?: string | null, character?: string) {
      next += 1;
      const message = { id: next, role, content, character };
      added.push(message);
      return { id: message.id };
    },
  };
}
