import type { DatabaseSync } from "node:sqlite";
import type { JournalSource } from "../diary/journal-store.ts";

interface SourceRow {
  id: string;
  type: JournalSource["type"];
  title: string;
  text: string;
  createdAt: string;
  sessionId: string | null;
  messageId: number | null;
  url: string | null;
}

export function journalSourcesForDay(db: DatabaseSync, _character: string | undefined, from: string, to: string): JournalSource[] {
  const rows = db.prepare(`
    SELECT 'message:' || m.id AS id, 'chat' AS type,
      CASE m.role WHEN 'user' THEN '用户说' ELSE '角色回复' END AS title,
      m.content AS text, m.created_at AS createdAt,
      m.session_id AS sessionId, m.id AS messageId, NULL AS url
    FROM messages m
    WHERE m.created_at >= ? AND m.created_at < ?
    UNION ALL
    SELECT 'experience-occurrence:' || o.id AS id,
      e.kind AS type, e.title, e.text, o.occurred_at AS createdAt,
      o.session_id AS sessionId, o.message_id AS messageId, e.url
    FROM memory_experience_occurrences o
    JOIN memory_experiences e ON e.id = o.experience_id
    WHERE e.kind IN ('video','web') AND o.occurred_at >= ? AND o.occurred_at < ?
    UNION ALL
    SELECT 'experience:' || e.id AS id,
      CASE e.kind WHEN 'video' THEN 'video' WHEN 'web' THEN 'web' ELSE 'learned' END AS type,
      e.title, e.text, e.created_at AS createdAt,
      COALESCE(e.source_session_id, (
        SELECT es.session_id FROM memory_experience_sessions es
        WHERE es.experience_id = e.id ORDER BY es.session_id LIMIT 1
      )) AS sessionId,
      e.source_message_id AS messageId, e.url
    FROM memory_experiences e
    WHERE e.kind IN ('video','web','learned') AND e.created_at >= ? AND e.created_at < ?
      AND NOT EXISTS (SELECT 1 FROM memory_experience_occurrences o WHERE o.experience_id = e.id)
    UNION ALL
    SELECT 'observation:' || o.session_id || ':' || o.through_message_id AS id,
      'reflection' AS type, s.title AS title, o.summary AS text,
      o.updated_at AS createdAt, o.session_id AS sessionId, NULL AS messageId, NULL AS url
    FROM session_observations o JOIN chat_sessions s ON s.id = o.session_id
    WHERE o.updated_at >= ? AND o.updated_at < ?
    UNION ALL
    SELECT 'note:' || n.character || ':' || n.updated_at AS id,
      'reflection' AS type, '她的近况' AS title, n.text,
      n.updated_at AS createdAt, NULL AS sessionId, NULL AS messageId, NULL AS url
    FROM character_notes n WHERE n.updated_at >= ? AND n.updated_at < ?
    ORDER BY createdAt, id
  `).all(from, to, from, to, from, to, from, to, from, to) as unknown as SourceRow[];
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    text: row.text,
    createdAt: row.createdAt,
    ...(row.sessionId ? { sessionId: row.sessionId } : {}),
    ...(row.messageId !== null ? { messageId: Number(row.messageId) } : {}),
    ...(row.url ? { url: row.url } : {}),
  }));
}
