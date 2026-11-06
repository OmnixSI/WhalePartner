import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { applySettingsPatch, defaultSettings, settingsFromRow } from "./settings.ts";
import type {
  SurfFeedItem,
  SurfFeedQuery,
  SurfItem,
  SurfItemKind,
  SurfSessionRecord,
  SurfSessionStatus,
  SurfSettings,
  SurfSettingsPatch,
} from "./types.ts";

const SELECT_ITEM = `
  SELECT id, character, session_id AS sessionId, kind, title, url, source_site AS sourceSite,
         thumb_path AS thumbPath, summary, comment, tags_json AS tagsJson, score, dedupe_key AS dedupeKey,
         experience_id AS experienceId, created_at AS createdAt, shared_at AS sharedAt,
         shared_message_id AS sharedMessageId, hidden
  FROM surf_items
`;

const SELECT_SESSION = `
  SELECT id, character, slot, started_at AS startedAt, finished_at AS finishedAt, status,
         items_count AS itemsCount, error, queries_json AS queriesJson
  FROM surf_sessions
`;

export interface InsertItemInput {
  character: string;
  sessionId: number;
  kind: SurfItemKind;
  title: string;
  url: string;
  sourceSite: string;
  summary: string;
  comment: string;
  tags: string[];
  score: number;
  dedupeKey: string;
  createdAt: string;
  thumbPath?: string | null;
}

type ItemRow = Omit<SurfItem, "tags" | "hidden"> & { tagsJson: string; hidden: number };

function parseTags(raw: unknown): string[] {
  try {
    const parsed: unknown = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function toItem(row: ItemRow): SurfItem {
  const { tagsJson, hidden, ...rest } = row;
  return { ...rest, tags: parseTags(tagsJson), hidden: Number(hidden) === 1 };
}

/**
 * 「她自己去逛」的存储（§10.6.2）。和聊天记录共用同一个 SQLite 文件，但用自己的连接：
 * 这样 surf 的读写不会和聊天事务缠在一起，测试里也能用独立的临时库。
 * `usage_ledger` 的列名与 P-B 的记账表对齐（character, kind, units, at），P-B 合进来时不用迁移。
 */
export class SurfRepository {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS surf_settings (
        character TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        frequency TEXT NOT NULL DEFAULT 'normal',
        interests_json TEXT NOT NULL DEFAULT '[]',
        blocked_json TEXT NOT NULL DEFAULT '[]',
        quiet_start TEXT NOT NULL DEFAULT '23:00',
        quiet_end TEXT NOT NULL DEFAULT '08:00',
        video INTEGER NOT NULL DEFAULT 1,
        web INTEGER NOT NULL DEFAULT 1,
        share_to_chat INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS surf_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        character TEXT NOT NULL,
        slot TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL,
        items_count INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        queries_json TEXT,
        UNIQUE (character, slot)
      );
      CREATE TABLE IF NOT EXISTS surf_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        character TEXT NOT NULL,
        session_id INTEGER NOT NULL REFERENCES surf_sessions(id),
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        source_site TEXT NOT NULL,
        thumb_path TEXT,
        summary TEXT NOT NULL,
        comment TEXT NOT NULL,
        tags_json TEXT NOT NULL DEFAULT '[]',
        score INTEGER NOT NULL DEFAULT 3,
        dedupe_key TEXT NOT NULL,
        experience_id TEXT,
        created_at TEXT NOT NULL,
        shared_at TEXT,
        shared_message_id INTEGER,
        hidden INTEGER NOT NULL DEFAULT 0,
        UNIQUE (character, dedupe_key)
      );
      CREATE INDEX IF NOT EXISTS idx_surf_items_feed ON surf_items(character, hidden, created_at DESC);
      CREATE TABLE IF NOT EXISTS usage_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        character TEXT NOT NULL,
        kind TEXT NOT NULL,
        units INTEGER NOT NULL,
        at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_usage_ledger_at ON usage_ledger(character, at);
      UPDATE surf_sessions SET status = 'failed', error = 'interrupted', finished_at = started_at
        WHERE status = 'running';
    `);
  }

  // ---- 设置 ----

  getSettings(character: string): SurfSettings {
    const row = this.#db.prepare("SELECT * FROM surf_settings WHERE character = ?").get(character) as Record<string, unknown> | undefined;
    return row ? settingsFromRow({ ...row }, character) : defaultSettings(character);
  }

  putSettings(character: string, patch: SurfSettingsPatch, at: string): SurfSettings {
    const next = applySettingsPatch(this.getSettings(character), patch);
    this.#db
      .prepare(
        `INSERT INTO surf_settings (character, enabled, frequency, interests_json, blocked_json, quiet_start, quiet_end, video, web, share_to_chat, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(character) DO UPDATE SET
           enabled = excluded.enabled, frequency = excluded.frequency,
           interests_json = excluded.interests_json, blocked_json = excluded.blocked_json,
           quiet_start = excluded.quiet_start, quiet_end = excluded.quiet_end,
           video = excluded.video, web = excluded.web,
           share_to_chat = excluded.share_to_chat, updated_at = excluded.updated_at`,
      )
      .run(
        character,
        next.enabled ? 1 : 0,
        next.frequency,
        JSON.stringify(next.interests),
        JSON.stringify(next.blocked),
        next.quiet.start,
        next.quiet.end,
        next.video ? 1 : 0,
        next.web ? 1 : 0,
        next.shareToChat ? 1 : 0,
        at,
      );
    return this.getSettings(character);
  }

  // ---- 会话 ----

  /** 槽位唯一：同一 (角色, 槽位) 第二次调用拿不到新行，返回 created:false。 */
  startSession(character: string, slot: string, at: string, queries: string[] = []): { session: SurfSessionRecord; created: boolean } {
    const result = this.#db
      .prepare("INSERT OR IGNORE INTO surf_sessions (character, slot, started_at, status, queries_json) VALUES (?, ?, ?, 'running', ?)")
      .run(character, slot, at, JSON.stringify(queries));
    const created = Number(result.changes) > 0;
    const session = this.sessionBySlot(character, slot)!;
    return { session, created };
  }

  sessionBySlot(character: string, slot: string): SurfSessionRecord | undefined {
    const row = this.#db.prepare(`${SELECT_SESSION} WHERE character = ? AND slot = ?`).get(character, slot) as
      | (Omit<SurfSessionRecord, "queries"> & { queriesJson: string | null })
      | undefined;
    return row ? this.#session(row) : undefined;
  }

  session(id: number): SurfSessionRecord | undefined {
    const row = this.#db.prepare(`${SELECT_SESSION} WHERE id = ?`).get(id) as
      | (Omit<SurfSessionRecord, "queries"> & { queriesJson: string | null })
      | undefined;
    return row ? this.#session(row) : undefined;
  }

  hasSession(character: string, slot: string): boolean {
    return Boolean(this.sessionBySlot(character, slot));
  }

  finishSession(id: number, status: SurfSessionStatus, itemsCount: number, error: string | null, at: string) {
    this.#db
      .prepare("UPDATE surf_sessions SET status = ?, items_count = ?, error = ?, finished_at = ? WHERE id = ?")
      .run(status, itemsCount, error, at, id);
  }

  setQueries(id: number, queries: string[]) {
    this.#db.prepare("UPDATE surf_sessions SET queries_json = ? WHERE id = ?").run(JSON.stringify(queries), id);
  }

  lastSession(character: string, statuses: SurfSessionStatus[] = ["done"]): SurfSessionRecord | undefined {
    const marks = statuses.map(() => "?").join(",");
    const row = this.#db
      .prepare(`${SELECT_SESSION} WHERE character = ? AND status IN (${marks}) ORDER BY started_at DESC LIMIT 1`)
      .get(character, ...statuses) as (Omit<SurfSessionRecord, "queries"> & { queriesJson: string | null }) | undefined;
    return row ? this.#session(row) : undefined;
  }

  /** 正在跑的那个会话（POST /run 回 202 时用它拿 sessionId）。 */
  runningSession(character: string): SurfSessionRecord | undefined {
    const row = this.#db
      .prepare(`${SELECT_SESSION} WHERE character = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1`)
      .get(character) as (Omit<SurfSessionRecord, "queries"> & { queriesJson: string | null }) | undefined;
    return row ? this.#session(row) : undefined;
  }

  /** 上一次手动触发（30 分钟冷却用）。 */
  lastManualSession(character: string): SurfSessionRecord | undefined {
    const row = this.#db
      .prepare(`${SELECT_SESSION} WHERE character = ? AND slot LIKE 'manual-%' ORDER BY started_at DESC LIMIT 1`)
      .get(character) as (Omit<SurfSessionRecord, "queries"> & { queriesJson: string | null }) | undefined;
    return row ? this.#session(row) : undefined;
  }

  /** 这次会话里最值得分享的一条（score 最高的未分享条目）。 */
  bestShareable(sessionId: number): SurfItem | undefined {
    const row = this.#db
      .prepare(`${SELECT_ITEM} WHERE session_id = ? AND hidden = 0 AND shared_at IS NULL ORDER BY score DESC, id ASC LIMIT 1`)
      .get(sessionId) as ItemRow | undefined;
    return row ? toItem(row) : undefined;
  }

  #session(row: Omit<SurfSessionRecord, "queries"> & { queriesJson: string | null }): SurfSessionRecord {
    const { queriesJson, ...rest } = row;
    let queries: string[] = [];
    try {
      const parsed: unknown = JSON.parse(queriesJson ?? "[]");
      if (Array.isArray(parsed)) queries = parsed.filter((item): item is string => typeof item === "string");
    } catch {
      queries = [];
    }
    return { ...rest, itemsCount: Number(rest.itemsCount), queries };
  }

  // ---- 条目 ----

  /** 去重键重复时返回 undefined（UNIQUE 兜住，不报错、不覆盖）。 */
  insertItem(input: InsertItemInput): SurfItem | undefined {
    const result = this.#db
      .prepare(
        `INSERT OR IGNORE INTO surf_items
           (character, session_id, kind, title, url, source_site, summary, comment, tags_json, score, dedupe_key, created_at, thumb_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.character,
        input.sessionId,
        input.kind,
        input.title,
        input.url,
        input.sourceSite,
        input.summary,
        input.comment,
        JSON.stringify(input.tags),
        input.score,
        input.dedupeKey,
        input.createdAt,
        input.thumbPath ?? null,
      );
    if (Number(result.changes) === 0) return undefined;
    const row = this.#db.prepare(`${SELECT_ITEM} WHERE id = ?`).get(Number(result.lastInsertRowid)) as ItemRow;
    return toItem(row);
  }

  item(id: number): SurfItem | undefined {
    const row = this.#db.prepare(`${SELECT_ITEM} WHERE id = ?`).get(id) as ItemRow | undefined;
    return row ? toItem(row) : undefined;
  }

  itemByMessage(messageId: number): SurfItem | undefined {
    const row = this.#db.prepare(`${SELECT_ITEM} WHERE shared_message_id = ?`).get(messageId) as ItemRow | undefined;
    return row ? toItem(row) : undefined;
  }

  feed(query: SurfFeedQuery): { items: SurfFeedItem[]; total: number } {
    const where = ["character = ?", "hidden = 0"];
    const args: Array<string | number> = [query.character];
    if (query.kind) {
      where.push("kind = ?");
      args.push(query.kind);
    }
    if (query.q?.trim()) {
      where.push("(title LIKE ? OR summary LIKE ? OR comment LIKE ? OR tags_json LIKE ?)");
      const like = `%${query.q.trim()}%`;
      args.push(like, like, like, like);
    }
    const clause = where.join(" AND ");
    const total = Number((this.#db.prepare(`SELECT COUNT(*) AS n FROM surf_items WHERE ${clause}`).get(...args) as { n: number }).n);
    const pageSize = Math.min(50, Math.max(1, query.pageSize));
    const page = Math.max(1, query.page);
    const rows = this.#db
      .prepare(`${SELECT_ITEM} WHERE ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...args, pageSize, (page - 1) * pageSize) as ItemRow[];
    return { items: rows.map((row) => this.#feedItem(toItem(row))), total };
  }

  #feedItem(item: SurfItem): SurfFeedItem {
    return {
      id: item.id,
      kind: item.kind,
      title: item.title,
      url: item.url,
      sourceSite: item.sourceSite,
      thumb: item.thumbPath ? `/api/surf/thumb/${item.id}` : null,
      summary: item.summary,
      comment: item.comment,
      tags: item.tags,
      createdAt: item.createdAt,
      sharedAt: item.sharedAt,
    };
  }

  /** 「忘掉」：软删除，保留去重键（免得以后又逛回来）。调用方负责删经验与缩略图。 */
  hideItem(id: number): SurfItem | undefined {
    const item = this.item(id);
    if (!item) return undefined;
    this.#db.prepare("UPDATE surf_items SET hidden = 1 WHERE id = ?").run(id);
    return item;
  }

  setExperience(itemId: number, experienceId: string | null) {
    this.#db.prepare("UPDATE surf_items SET experience_id = ? WHERE id = ?").run(experienceId, itemId);
  }

  setThumb(itemId: number, thumbPath: string) {
    this.#db.prepare("UPDATE surf_items SET thumb_path = ? WHERE id = ?").run(thumbPath, itemId);
  }

  markShared(itemId: number, at: string, messageId: number) {
    this.#db.prepare("UPDATE surf_items SET shared_at = ?, shared_message_id = ? WHERE id = ?").run(at, messageId, itemId);
  }

  /** 已逛过的去重键（含隐藏的），用于选题时排除。 */
  seenKeys(character: string): string[] {
    return (this.#db.prepare("SELECT dedupe_key AS key FROM surf_items WHERE character = ?").all(character) as Array<{ key: string }>).map(
      (row) => row.key,
    );
  }

  countSince(character: string, kind: SurfItemKind, sinceIso: string): number {
    const row = this.#db
      .prepare("SELECT COUNT(*) AS n FROM surf_items WHERE character = ? AND kind = ? AND created_at >= ?")
      .get(character, kind, sinceIso) as { n: number };
    return Number(row.n);
  }

  /** 今天每个域名已访问几次（同一域名每天最多 2 次）。 */
  hostCountsSince(character: string, sinceIso: string): Record<string, number> {
    const rows = this.#db
      .prepare("SELECT source_site AS site, COUNT(*) AS n FROM surf_items WHERE character = ? AND kind = 'web' AND created_at >= ? GROUP BY source_site")
      .all(character, sinceIso) as Array<{ site: string; n: number }>;
    return Object.fromEntries(rows.map((row) => [row.site, Number(row.n)]));
  }

  countSharedSince(character: string, sinceIso: string): number {
    const row = this.#db
      .prepare("SELECT COUNT(*) AS n FROM surf_items WHERE character = ? AND shared_at IS NOT NULL AND shared_at >= ?")
      .get(character, sinceIso) as { n: number };
    return Number(row.n);
  }

  lastSharedAt(character: string): string | null {
    const row = this.#db
      .prepare("SELECT shared_at AS at FROM surf_items WHERE character = ? AND shared_at IS NOT NULL ORDER BY shared_at DESC LIMIT 1")
      .get(character) as { at: string } | undefined;
    return row?.at ?? null;
  }

  // ---- 记账 ----

  addLedger(character: string, kind: string, units: number, at: string) {
    this.#db.prepare("INSERT INTO usage_ledger (character, kind, units, at) VALUES (?, ?, ?, ?)").run(character, kind, units, at);
  }

  ledgerUnits(character: string, sinceIso?: string): number {
    const row = sinceIso
      ? (this.#db.prepare("SELECT COALESCE(SUM(units), 0) AS n FROM usage_ledger WHERE character = ? AND at >= ?").get(character, sinceIso) as { n: number })
      : (this.#db.prepare("SELECT COALESCE(SUM(units), 0) AS n FROM usage_ledger WHERE character = ?").get(character) as { n: number });
    return Number(row.n);
  }

  ledgerRows(character: string): Array<{ kind: string; units: number; at: string }> {
    return this.#db
      .prepare("SELECT kind, units, at FROM usage_ledger WHERE character = ? ORDER BY id ASC")
      .all(character) as Array<{ kind: string; units: number; at: string }>;
  }

  // ---- 和聊天表的只读接触点 ----

  /** 最近 N 天有聊天记录的角色才出去逛（messages 由 ChatStore 建，表不在就当作没有）。 */
  hasRecentChat(character: string, sinceIso: string): boolean {
    try {
      const row = this.#db
        .prepare("SELECT COUNT(*) AS n FROM messages WHERE character = ? AND created_at >= ?")
        .get(character, sinceIso) as { n: number };
      return Number(row.n) > 0;
    } catch {
      return false;
    }
  }

  /** 最近 7 天的用户消息（选题用），新的在前。 */
  recentUserMessages(character: string, sinceIso: string, limit = 40): string[] {
    try {
      const rows = this.#db
        .prepare("SELECT content FROM messages WHERE character = ? AND role = 'user' AND created_at >= ? ORDER BY id DESC LIMIT ?")
        .all(character, sinceIso, limit) as Array<{ content: string }>;
      return rows.map((row) => row.content);
    } catch {
      return [];
    }
  }

  close() {
    this.#db.close();
  }
}
