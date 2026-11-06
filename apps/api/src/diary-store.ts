import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { normalizeBilibiliInput } from "./bilibili.ts";
import { addColumn } from "./db.ts";
import type { DiaryMeta } from "./diary-mood.ts";
import type { VideoSummary } from "./video-service.ts";

export type DiaryItemStatus = "pending" | "processing" | "failed" | "done" | "duplicate";
export type DiaryMemoryStatus = "pending" | "saved" | "failed" | null;

export interface DiaryItem {
  id: number;
  inputUrl: string;
  bvid: string | null;
  title: string | null;
  sourceUrl: string | null;
  summary: string | null;
  diaryText: string | null;
  /** 她这一天的心情（B3）；旧数据或还没生成时是 null。 */
  mood: string | null;
  /** 她“心里的天气”（B3）。 */
  weather: string | null;
  /** 日记小标题（B3），最多 12 个字。 */
  diaryTitle: string | null;
  status: DiaryItemStatus;
  errorStage: "video" | "diary" | null;
  error: string | null;
  memoryStatus: DiaryMemoryStatus;
  memoryError: string | null;
  createdAt: string;
  processedAt: string | null;
  duplicateOf: number | null;
}

const SELECT_ITEM = `
  SELECT id, input_url AS inputUrl, bvid, title, source_url AS sourceUrl,
         summary, diary_text AS diaryText, mood, weather,
         diary_title AS diaryTitle, status, error_stage AS errorStage,
         error, memory_status AS memoryStatus, memory_error AS memoryError,
         created_at AS createdAt, processed_at AS processedAt,
         duplicate_of AS duplicateOf
  FROM diary_items
`;

/** 本地待看队列和日记记录，和聊天记录共用同一个 SQLite 文件。 */
export class DiaryStore {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS diary_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        input_url TEXT NOT NULL UNIQUE,
        bvid TEXT,
        title TEXT,
        source_url TEXT,
        summary TEXT,
        diary_text TEXT,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending','processing','failed','done','duplicate')),
        error_stage TEXT CHECK (error_stage IN ('video','diary') OR error_stage IS NULL),
        error TEXT,
        memory_status TEXT CHECK (memory_status IN ('pending','saved','failed') OR memory_status IS NULL),
        memory_error TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        processed_at TEXT,
        duplicate_of INTEGER REFERENCES diary_items(id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS diary_items_bvid_entry
        ON diary_items (bvid) WHERE diary_text IS NOT NULL;
      UPDATE diary_items SET status = 'pending', error = NULL, error_stage = NULL
        WHERE status = 'processing';
    `);
    // B3：旧库补三列，旧数据是 NULL。
    addColumn(this.#db, "diary_items", "mood", "TEXT");
    addColumn(this.#db, "diary_items", "weather", "TEXT");
    addColumn(this.#db, "diary_items", "diary_title", "TEXT");
  }

  enqueue(input: string): { item: DiaryItem; created: boolean } {
    const inputUrl = normalizeBilibiliInput(input);
    const existing = this.#getByInput(inputUrl);
    if (existing) return { item: existing, created: false };
    this.#db.prepare("INSERT INTO diary_items (input_url) VALUES (?)").run(inputUrl);
    return { item: this.#getByInput(inputUrl)!, created: true };
  }

  list(limit = 100): DiaryItem[] {
    const rows = this.#db.prepare(`${SELECT_ITEM} ORDER BY created_at DESC, id DESC LIMIT ?`).all(limit) as unknown as DiaryItem[];
    return rows.map((row) => ({ ...row }));
  }

  get(id: number): DiaryItem | undefined {
    const row = this.#db.prepare(`${SELECT_ITEM} WHERE id = ?`).get(id) as unknown as DiaryItem | undefined;
    return row ? { ...row } : undefined;
  }

  nextPending(): DiaryItem | undefined {
    const row = this.#db.prepare(`${SELECT_ITEM} WHERE status = 'pending' ORDER BY created_at, id LIMIT 1`).get() as unknown as DiaryItem | undefined;
    return row ? { ...row } : undefined;
  }

  pendingMemories(): DiaryItem[] {
    const rows = this.#db.prepare(`${SELECT_ITEM} WHERE diary_text IS NOT NULL AND memory_status = 'pending' ORDER BY created_at, id`).all() as unknown as DiaryItem[];
    return rows.map((row) => ({ ...row }));
  }

  findDiaryByBvid(bvid: string, exceptId?: number): DiaryItem | undefined {
    const row = this.#db
      .prepare(`${SELECT_ITEM} WHERE bvid = ? AND diary_text IS NOT NULL AND (? IS NULL OR id <> ?) LIMIT 1`)
      .get(bvid, exceptId ?? null, exceptId ?? null) as unknown as DiaryItem | undefined;
    return row ? { ...row } : undefined;
  }

  markProcessing(id: number) {
    this.#db.prepare("UPDATE diary_items SET status = 'processing', error = NULL, error_stage = NULL WHERE id = ? AND status = 'pending'").run(id);
  }

  saveSummary(id: number, video: VideoSummary) {
    this.#db.prepare(`
      UPDATE diary_items
      SET bvid = ?, title = ?, source_url = ?, summary = ?, error = NULL, error_stage = NULL
      WHERE id = ?
    `).run(video.bvid, video.title, video.url, video.summary, id);
  }

  saveDiary(id: number, text: string): DiaryItem {
    this.#db.prepare(`
      UPDATE diary_items
      SET diary_text = ?, status = 'done', error = NULL, error_stage = NULL,
          memory_status = 'pending', memory_error = NULL,
          processed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?
    `).run(text, id);
    return this.get(id)!;
  }

  /** 保存心情、心里的天气和小标题（B3）。 */
  saveDiaryMeta(id: number, meta: DiaryMeta): DiaryItem {
    this.#db.prepare("UPDATE diary_items SET mood = ?, weather = ?, diary_title = ? WHERE id = ?")
      .run(meta.mood, meta.weather, meta.title, id);
    return this.get(id)!;
  }

  /** 启动回填用：最近 30 条有正文但还没有心情的日记，新的在前。 */
  listNeedingMood(limit = 30): DiaryItem[] {
    const rows = this.#db
      .prepare(`${SELECT_ITEM} WHERE diary_text IS NOT NULL AND mood IS NULL ORDER BY processed_at DESC, id DESC LIMIT ?`)
      .all(limit) as unknown as DiaryItem[];
    return rows.map((row) => ({ ...row }));
  }

  markDuplicate(id: number, existing: DiaryItem) {
    this.#db.prepare(`
      UPDATE diary_items
      SET bvid = ?, title = ?, source_url = ?, status = 'duplicate', duplicate_of = ?,
          error = NULL, error_stage = NULL, memory_status = NULL, memory_error = NULL,
          processed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?
    `).run(existing.bvid, existing.title, existing.sourceUrl, existing.id, id);
  }

  markPending(id: number) {
    this.#db.prepare("UPDATE diary_items SET status = 'pending', error = NULL, error_stage = NULL WHERE id = ?").run(id);
  }

  markFailed(id: number, stage: "video" | "diary", error: string) {
    this.#db.prepare("UPDATE diary_items SET status = 'failed', error_stage = ?, error = ? WHERE id = ?").run(stage, error.slice(0, 1000), id);
  }

  markMemorySaved(id: number) {
    this.#db.prepare("UPDATE diary_items SET memory_status = 'saved', memory_error = NULL WHERE id = ?").run(id);
  }

  markMemoryFailed(id: number, error: string) {
    this.#db.prepare("UPDATE diary_items SET memory_status = 'failed', memory_error = ? WHERE id = ?").run(error.slice(0, 1000), id);
  }

  retry(id: number): "queued" | "memory" | "unchanged" | "missing" {
    const item = this.get(id);
    if (!item) return "missing";
    if (item.diaryText && item.memoryStatus === "failed") {
      this.#db.prepare("UPDATE diary_items SET memory_status = 'pending', memory_error = NULL WHERE id = ?").run(id);
      return "memory";
    }
    if (item.status === "failed") {
      this.markPending(id);
      return "queued";
    }
    return "unchanged";
  }

  close() {
    this.#db.close();
  }

  #getByInput(inputUrl: string): DiaryItem | undefined {
    const row = this.#db.prepare(`${SELECT_ITEM} WHERE input_url = ?`).get(inputUrl) as unknown as DiaryItem | undefined;
    return row ? { ...row } : undefined;
  }
}
