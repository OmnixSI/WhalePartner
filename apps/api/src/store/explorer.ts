import type { DatabaseSync } from "node:sqlite";
import { matchExpression } from "./search.ts";
import type { StoredFact } from "./types.ts";

export type MemoryCategory = "all" | "fact" | "conversation" | "video" | "web" | "diary" | "learned" | "reflection";
export type MemoryStatusFilter = "all" | "current" | "historical";

export interface MemoryExplorerFilters {
  character: string;
  query?: string;
  category?: MemoryCategory;
  status?: MemoryStatusFilter;
  role?: "all" | "user" | "assistant";
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface MemoryExplorerItem {
  id: string;
  type: "fact" | "message" | "experience" | "reflection";
  category: Exclude<MemoryCategory, "all">;
  title: string;
  text: string;
  createdAt: string;
  character: string;
  role?: "user" | "assistant";
  sessionId?: string;
  sessionTitle?: string;
  messageId?: number;
  status?: "active" | "superseded";
  validFrom?: string;
  validTo?: string | null;
  sources?: StoredFact["sources"];
  sourceId?: string;
  url?: string;
  sourceMissing?: boolean;
}

export interface MemoryExplorerResult {
  items: MemoryExplorerItem[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<Exclude<MemoryCategory, "all">, number>;
}

interface Row extends Omit<MemoryExplorerItem, "status" | "role" | "sessionId" | "sessionTitle" | "messageId" | "validFrom" | "validTo" | "sourceId" | "url" | "sourceMissing"> {
  status: "active" | "superseded" | null;
  role: "user" | "assistant" | null;
  sessionId: string | null;
  sessionTitle: string | null;
  messageId: number | null;
  validFrom: string | null;
  validTo: string | null;
  sourceId: string | null;
  url: string | null;
  sourceMissing: number | null;
}

const CATEGORIES: Array<Exclude<MemoryCategory, "all">> = ["fact", "conversation", "video", "web", "diary", "learned", "reflection"];

export function listMemoryExplorer(db: DatabaseSync, filters: MemoryExplorerFilters): MemoryExplorerResult {
  const pageSize = Math.min(100, Math.max(1, Math.floor(filters.pageSize ?? 30)));
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const offset = (page - 1) * pageSize;
  const category = filters.category ?? "all";
  const records = buildRecords(filters, category);
  const rows = db.prepare(`${records.sql} SELECT * FROM records ORDER BY createdAt DESC, type, id LIMIT ? OFFSET ?`)
    .all(...records.params, pageSize, offset) as unknown as Row[];
  const totalRow = db.prepare(`${records.sql} SELECT COUNT(*) AS total FROM records`)
    .get(...records.params) as unknown as { total: number };
  const counts = Object.fromEntries(CATEGORIES.map((item) => [item, 0])) as MemoryExplorerResult["counts"];
  const allRecords = buildRecords({ ...filters, status: "all" }, "all");
  const categoryRows = db.prepare(`${allRecords.sql} SELECT category, COUNT(*) AS count FROM records GROUP BY category`)
    .all(...allRecords.params) as unknown as Array<{ category: MemoryCategory; count: number }>;
  for (const row of categoryRows) if (row.category !== "all" && row.category in counts) counts[row.category] = Number(row.count);

  const items = rows.map((row) => {
    const item: MemoryExplorerItem = {
      id: row.id,
      type: row.type,
      category: row.category,
      title: row.title,
      text: row.text,
      createdAt: row.createdAt,
      character: row.character,
      ...(row.role ? { role: row.role } : {}),
      ...(row.sessionId ? { sessionId: row.sessionId } : {}),
      ...(row.sessionTitle ? { sessionTitle: row.sessionTitle } : {}),
      ...(row.messageId !== null ? { messageId: Number(row.messageId) } : {}),
      ...(row.status ? { status: row.status } : {}),
      ...(row.validFrom ? { validFrom: row.validFrom } : {}),
      ...(row.status === "superseded" ? { validTo: row.validTo } : {}),
      ...(row.sourceId ? { sourceId: row.sourceId } : {}),
      ...(row.url ? { url: row.url } : {}),
      ...(row.sourceMissing ? { sourceMissing: true } : {}),
    };
    if (row.type === "fact") {
      const factId = Number(row.id.slice("fact:".length));
      const sourceRows = db.prepare(`
        SELECT fs.message_id AS messageId, m.session_id AS sessionId, m.character AS character, m.created_at AS createdAt, fs.quote
        FROM memory_fact_sources fs JOIN messages m ON m.id = fs.message_id
        WHERE fs.fact_id = ? ORDER BY fs.recorded_at DESC
      `).all(factId) as unknown as StoredFact["sources"];
      item.sources = sourceRows;
    }
    return item;
  });
  return { items, total: Number(totalRow.total), page, pageSize, counts };
}

function buildRecords(filters: MemoryExplorerFilters, category: MemoryCategory) {
  const ctes: string[] = [];
  const params: Array<string | number> = [];
  const query = filters.query?.trim() ? matchExpression(filters.query) : undefined;
  const append = (sql: string, values: Array<string | number>) => {
    ctes.push(sql);
    params.push(...values);
  };
  const dates = (column: string, values: Array<string | number>) => {
    const conditions: string[] = [];
    if (filters.from) { conditions.push(`${column} >= ?`); values.push(filters.from); }
    if (filters.to) { conditions.push(`${column} < ?`); values.push(filters.to); }
    return conditions;
  };

  if (category === "all" || category === "fact") {
    const values: Array<string | number> = [filters.character];
    const where = ["1 = 1", ...dates("f.valid_from", values)];
    if (filters.status === "current") where.push("f.status = 'active'");
    if (filters.status === "historical") where.push("f.status = 'superseded'");
    if (query) { where.push("f.id IN (SELECT rowid FROM fact_search WHERE fact_search MATCH ?)"); values.push(query); }
    append(`
      SELECT 'fact:' || f.id AS id, 'fact' AS type, 'fact' AS category,
        f.subject || ' · ' || f.predicate AS title,
        f.value AS text, f.valid_from AS createdAt, ? AS character,
        NULL AS role, NULL AS sessionId, NULL AS sessionTitle, NULL AS messageId, f.status AS status,
        f.valid_from AS validFrom, f.valid_to AS validTo, NULL AS sourceId, NULL AS url, NULL AS sourceMissing
      FROM memory_facts f WHERE ${where.join(" AND ")}
    `, values);
  }

  if (category === "all" || category === "conversation") {
    const values: Array<string | number> = [filters.character];
    const where = ["m.character = ?", ...dates("m.created_at", values)];
    if (filters.role && filters.role !== "all") { where.push("m.role = ?"); values.push(filters.role); }
    if (query) { where.push("m.id IN (SELECT rowid FROM message_search WHERE message_search MATCH ?)"); values.push(query); }
    append(`
      SELECT 'message:' || m.id AS id, 'message' AS type, 'conversation' AS category,
        CASE m.role WHEN 'user' THEN '你说的话' ELSE '她的回复' END AS title,
        m.content AS text, m.created_at AS createdAt, m.character AS character,
        m.role AS role, m.session_id AS sessionId, s.title AS sessionTitle, m.id AS messageId,
        NULL AS status, NULL AS validFrom, NULL AS validTo, NULL AS sourceId, NULL AS url, NULL AS sourceMissing
      FROM message_search JOIN messages m ON m.id = message_search.rowid
      JOIN chat_sessions s ON s.id = m.session_id
      WHERE ${where.join(" AND ")}
    `, values);

    const valuesForExperiences: Array<string | number> = [filters.character, filters.character, filters.character, filters.character, filters.character];
    const expWhere = ["e.kind = 'chat'", "(s.character = ? OR EXISTS (SELECT 1 FROM memory_experience_sessions es JOIN chat_sessions cs ON cs.id = es.session_id WHERE es.experience_id = e.id AND cs.character = ?))", ...dates("e.created_at", valuesForExperiences)];
    if (query) { expWhere.push("e.id IN (SELECT rowid FROM experience_search WHERE experience_search MATCH ?)"); valuesForExperiences.push(query); }
    append(`
        SELECT 'experience:' || e.id AS id, 'experience' AS type, 'conversation' AS category,
          e.title AS title, e.text AS text, e.created_at AS createdAt, ? AS character,
          NULL AS role, COALESCE(e.source_session_id, (SELECT es.session_id FROM memory_experience_sessions es JOIN chat_sessions cs ON cs.id = es.session_id WHERE es.experience_id = e.id AND cs.character = ? LIMIT 1)) AS sessionId,
          (SELECT title FROM chat_sessions WHERE id = COALESCE(e.source_session_id, (SELECT es.session_id FROM memory_experience_sessions es JOIN chat_sessions cs ON cs.id = es.session_id WHERE es.experience_id = e.id AND cs.character = ? LIMIT 1))) AS sessionTitle,
          e.source_message_id AS messageId,
          NULL AS status, NULL AS validFrom, NULL AS validTo, e.source_id AS sourceId, e.url AS url, e.source_missing AS sourceMissing
        FROM experience_search JOIN memory_experiences e ON e.id = experience_search.rowid
        LEFT JOIN chat_sessions s ON s.id = e.source_session_id
        WHERE ${expWhere.join(" AND ")}
      `, valuesForExperiences);
  }

  const experienceCategories: Array<Exclude<MemoryCategory, "all" | "fact" | "conversation" | "reflection">> = ["video", "web", "diary", "learned"];
  for (const experienceCategory of experienceCategories) {
    if (category !== "all" && category !== experienceCategory) continue;
    const values: Array<string | number> = [
      filters.character,
      filters.character,
      filters.character,
      filters.character,
      filters.character,
      filters.character,
    ];
    const kindClause = experienceCategory === "diary" ? "e.kind IN ('diary','journal')" : "e.kind = ?";
    if (experienceCategory !== "diary") values.push(experienceCategory);
    const where = [kindClause, ...dates("e.created_at", values)];
    if (query) { where.push("e.id IN (SELECT rowid FROM experience_search WHERE experience_search MATCH ?)"); values.push(query); }
    where.push(`(
      (e.source_session_id IS NULL AND NOT EXISTS (SELECT 1 FROM memory_experience_sessions es WHERE es.experience_id = e.id)
        AND e.source_id NOT LIKE 'learned:chat:%' AND (e.kind <> 'journal' OR e.source_id LIKE ?))
      OR EXISTS (SELECT 1 FROM chat_sessions cs WHERE cs.id = e.source_session_id AND cs.character = ?)
      OR EXISTS (SELECT 1 FROM memory_experience_sessions es JOIN chat_sessions cs ON cs.id = es.session_id WHERE es.experience_id = e.id AND cs.character = ?)
      OR (e.source_id LIKE 'learned:chat:%' AND e.source_id LIKE ?)
    )`);
    values.push(`journal:${filters.character}:%`, filters.character, filters.character, `learned:chat:${filters.character}:%`);
    append(`
      SELECT 'experience:' || e.id AS id, 'experience' AS type, '${experienceCategory}' AS category,
        e.title AS title, e.text AS text, e.created_at AS createdAt, ? AS character,
        NULL AS role, display_session.id AS sessionId, display_session.title AS sessionTitle,
        CASE WHEN s.character = ? THEN e.source_message_id ELSE (
          SELECT o.message_id FROM memory_experience_occurrences o
          JOIN chat_sessions occurrence_session ON occurrence_session.id = o.session_id
          WHERE o.experience_id = e.id AND occurrence_session.character = ?
          ORDER BY o.occurred_at DESC, o.id DESC LIMIT 1
        ) END AS messageId,
        NULL AS status, NULL AS validFrom, NULL AS validTo, e.source_id AS sourceId, e.url AS url, e.source_missing AS sourceMissing
      FROM experience_search JOIN memory_experiences e ON e.id = experience_search.rowid
      LEFT JOIN chat_sessions s ON s.id = e.source_session_id
      LEFT JOIN chat_sessions display_session ON display_session.id = COALESCE(
        CASE WHEN s.character = ? THEN e.source_session_id END,
        (SELECT o.session_id FROM memory_experience_occurrences o
          JOIN chat_sessions occurrence_session ON occurrence_session.id = o.session_id
          WHERE o.experience_id = e.id AND occurrence_session.character = ?
          ORDER BY o.occurred_at DESC, o.id DESC LIMIT 1),
        (SELECT es.session_id FROM memory_experience_sessions es
          JOIN chat_sessions linked_session ON linked_session.id = es.session_id
          WHERE es.experience_id = e.id AND linked_session.character = ? LIMIT 1)
      )
      WHERE ${where.join(" AND ")}
    `, values);
  }

  if (category === "all" || category === "reflection") {
    const values: Array<string | number> = [filters.character];
    const where = ["s.character = ?", ...dates("o.updated_at", values)];
    if (query) { where.push("o.summary LIKE ?"); values.push(`%${filters.query!.trim()}%`); }
    append(`
      SELECT 'observation:' || o.session_id AS id, 'reflection' AS type, 'reflection' AS category,
        s.title AS title, o.summary AS text, o.updated_at AS createdAt, s.character AS character,
        NULL AS role, o.session_id AS sessionId, s.title AS sessionTitle, o.through_message_id AS messageId,
        NULL AS status, NULL AS validFrom, NULL AS validTo, NULL AS sourceId, NULL AS url, NULL AS sourceMissing
      FROM session_observations o JOIN chat_sessions s ON s.id = o.session_id
      WHERE ${where.join(" AND ")}
    `, values);

    const noteValues: Array<string | number> = [filters.character];
    const noteWhere = ["character = ?", ...dates("updated_at", noteValues)];
    if (query) { noteWhere.push("text LIKE ?"); noteValues.push(`%${filters.query!.trim()}%`); }
    append(`
      SELECT 'note:' || character AS id, 'reflection' AS type, 'reflection' AS category,
        '她的近况' AS title, text AS text, updated_at AS createdAt, character AS character,
        NULL AS role, NULL AS sessionId, NULL AS sessionTitle, NULL AS messageId,
        NULL AS status, NULL AS validFrom, NULL AS validTo, NULL AS sourceId, NULL AS url, NULL AS sourceMissing
      FROM character_notes WHERE ${noteWhere.join(" AND ")}
    `, noteValues);
  }

  return { sql: `WITH records AS (${ctes.length ? ctes.join(" UNION ALL ") : "SELECT NULL AS id WHERE 0"})`, params };
}
