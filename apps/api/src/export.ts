import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { tableExists } from "./db.ts";
import type { MemoryEntry, MemoryStore } from "./memory/types.ts";
import { getProfile } from "./profile.ts";
import { createZip, type ZipEntry } from "./zip.ts";

export const APP_VERSION = "0.1.0";

/** 导出白名单：只导出用户自己的数据；登录凭据、密钥、向量库二进制永远不在里面。 */
export const EXPORT_TABLES = [
  "messages",
  "character_notes",
  "diary_items",
  "usage_ledger",
  "user_profile",
  "memory_seq",
  "memory_seq_counter",
] as const;

export type ExportTable = (typeof EXPORT_TABLES)[number];
export type DumpRow = Record<string, unknown>;

/** 白名单表的全部行；库里没有这张表就跳过（例如旧库还没有 usage_ledger）。 */
export function dumpAll(db: DatabaseSync): Partial<Record<ExportTable, DumpRow[]>> {
  const dump: Partial<Record<ExportTable, DumpRow[]>> = {};
  for (const table of EXPORT_TABLES) {
    if (!tableExists(db, table)) continue;
    const rows = db.prepare(`SELECT * FROM "${table}"`).all() as unknown as DumpRow[];
    dump[table] = rows.map((row) => ({ ...row }));
  }
  return dump;
}

export interface ExportDeps {
  db: DatabaseSync;
  memory?: MemoryStore;
  exportDir: string;
  now?: () => Date;
}

export interface ExportBundle {
  buffer: Buffer;
  files: number;
  createdAt: string;
  counts: Record<string, number>;
  manifest: {
    app: "WhalePartner";
    version: string;
    exportedAt: string;
    counts: Record<string, number>;
  };
  at: Date;
}

const README = [
  "WhalePartner 数据导出",
  "",
  "这份压缩包里是你在本机用 WhalePartner 时留下的数据，按文件说明如下：",
  "",
  "manifest.json         导出时间、版本，以及每个文件里有多少条记录。",
  "profile.json          你设置过的称呼（昵称）。",
  "messages.json         聊天记录，含每轮的情绪和附件信息。",
  "character-notes.json  角色自己写的近况小记。",
  "memories/facts.json   她记住的关于你的事。",
  "memories/experiences.json  她看过的视频、网页、写过的日记（经历）。",
  "diary.json            待看队列与日记。",
  "usage.json            “贝壳”用量流水（目前只是用量透明表，不收费）。",
  "memory-seq.json       记忆的图鉴编号。",
  "",
  "登录凭据、模型密钥和向量库文件都只留在本机，不会出现在导出里。",
].join("\n");

function asArray(value: DumpRow[] | undefined): DumpRow[] {
  return value ?? [];
}

async function safeMemories(memory: MemoryStore | undefined): Promise<MemoryEntry[]> {
  if (!memory) return [];
  try {
    return await memory.list();
  } catch (error) {
    console.warn("导出时读记忆失败，跳过记忆：", error instanceof Error ? error.message : error);
    return [];
  }
}

function parseAttachment(raw: unknown): unknown {
  if (typeof raw !== "string" || !raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** 聊天记录用接口里的驼峰形状导出，附件解析成对象。 */
function messageRows(db: DatabaseSync): DumpRow[] {
  if (!tableExists(db, "messages")) return [];
  const rows = db
    .prepare("SELECT id, role, content, emotion, character, created_at AS createdAt, attachment_json AS attachmentJson FROM messages ORDER BY id")
    .all() as unknown as Array<Record<string, unknown>>;
  return rows.map(({ attachmentJson, ...rest }) => ({ ...rest, attachment: parseAttachment(attachmentJson) }));
}

/** 日记用接口里的驼峰形状导出（含 B3 的 mood / weather / diaryTitle）。 */
function diaryRows(db: DatabaseSync): DumpRow[] {
  if (!tableExists(db, "diary_items")) return [];
  return db
    .prepare(`SELECT id, input_url AS inputUrl, bvid, title, source_url AS sourceUrl, summary,
                     diary_text AS diaryText, mood, weather, diary_title AS diaryTitle, status,
                     error_stage AS errorStage, error, memory_status AS memoryStatus, memory_error AS memoryError,
                     created_at AS createdAt, processed_at AS processedAt, duplicate_of AS duplicateOf
              FROM diary_items ORDER BY id`)
    .all() as unknown as DumpRow[];
}

/** 组装 zip（不落盘）。`GET /api/export` 直接把它流给浏览器。 */
export async function buildExport(deps: ExportDeps): Promise<ExportBundle> {
  const at = (deps.now ?? (() => new Date()))();
  const createdAt = at.toISOString();
  const dump = dumpAll(deps.db);
  const messages = messageRows(deps.db);
  const diary = diaryRows(deps.db);
  const memories = await safeMemories(deps.memory);
  const facts = memories.filter((entry) => entry.kind === "fact");
  const experiences = memories.filter((entry) => entry.kind === "experience");
  const profile = getProfile(deps.db);
  const counts: Record<string, number> = {
    messages: messages.length,
    character_notes: asArray(dump.character_notes).length,
    diary_items: diary.length,
    usage_ledger: asArray(dump.usage_ledger).length,
    user_profile: asArray(dump.user_profile).length,
    memory_seq: asArray(dump.memory_seq).length,
    memory_seq_counter: asArray(dump.memory_seq_counter).length,
    facts: facts.length,
    experiences: experiences.length,
  };
  const manifest = { app: "WhalePartner" as const, version: APP_VERSION, exportedAt: createdAt, counts };
  const files: ZipEntry[] = [
    { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") },
    { name: "README.txt", data: Buffer.from(README, "utf8") },
    { name: "profile.json", data: json({ nickname: profile.nickname, updatedAt: profile.updatedAt }) },
    { name: "messages.json", data: json(messages) },
    { name: "character-notes.json", data: json(asArray(dump.character_notes)) },
    { name: "memories/facts.json", data: json(facts) },
    { name: "memories/experiences.json", data: json(experiences) },
    { name: "diary.json", data: json(diary) },
    { name: "usage.json", data: json(asArray(dump.usage_ledger)) },
    { name: "memory-seq.json", data: json({ seqs: asArray(dump.memory_seq), counters: asArray(dump.memory_seq_counter) }) },
  ];
  const buffer = createZip(files, at);
  return { buffer, files: files.length, createdAt, counts, manifest, at };
}

function json(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value, null, 2), "utf8");
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** `whalepartner-export-YYYYMMDD-HHmmss.zip`，用本地时间，用户一眼能认出是什么时候导的。 */
export function exportFileName(at: Date): string {
  const day = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`;
  const clock = `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  return `whalepartner-export-${day}-${clock}.zip`;
}

export interface ExportFileResult {
  ok: true;
  path: string;
  bytes: number;
  files: number;
  createdAt: string;
}

/** 写进导出目录（默认 `~/Downloads`），返回给设置页显示。 */
export async function writeExport(deps: ExportDeps): Promise<ExportFileResult> {
  const bundle = await buildExport(deps);
  mkdirSync(deps.exportDir, { recursive: true });
  const path = join(deps.exportDir, exportFileName(bundle.at));
  writeFileSync(path, bundle.buffer);
  return { ok: true, path, bytes: bundle.buffer.length, files: bundle.files, createdAt: bundle.createdAt };
}
