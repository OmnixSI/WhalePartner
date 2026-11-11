import type { DatabaseSync } from "node:sqlite";
import { indexedMessageText, matchExpression } from "./search.ts";
import type { FactRepository } from "./facts.ts";
import type { MemoryDistillation, MemoryDistillationContext, MemoryTopicCandidate, StoredMemoryTopic } from "./types.ts";

export class MemoryDistillationRepository {
  readonly #db: DatabaseSync;
  readonly #facts: FactRepository;

  constructor(db: DatabaseSync, facts: FactRepository) {
    this.#db = db;
    this.#facts = facts;
  }

  context(query: string): Pick<MemoryDistillationContext, "core" | "coreSourceMessageIds" | "topics"> {
    const coreRow = this.#db.prepare("SELECT text FROM memory_core WHERE id = 1").get() as unknown as { text: string } | undefined;
    const coreSourceMessageIds = (this.#db.prepare("SELECT message_id AS id FROM memory_core_sources WHERE core_id = 1 ORDER BY message_id DESC LIMIT 12")
      .all() as unknown as Array<{ id: number }>).map((row) => row.id);
    const expression = matchExpression(query);
    const topics = expression
      ? this.#db.prepare(`
          SELECT t.id, t.topic_key AS key, t.title, t.summary, t.updated_at AS updatedAt
          FROM memory_topic_search s JOIN memory_topics t ON t.id = s.rowid
          WHERE memory_topic_search MATCH ?
          ORDER BY bm25(memory_topic_search), t.updated_at DESC LIMIT 5
        `).all(expression) as unknown as Array<{ id: number; key: string; title: string; summary: string; updatedAt: string }>
      : [];
    const storedTopics: StoredMemoryTopic[] = topics.map((topic) => ({
      key: topic.key,
      title: topic.title,
      summary: topic.summary,
      updatedAt: topic.updatedAt,
      sourceMessageIds: (this.#db.prepare("SELECT message_id AS id FROM memory_topic_sources WHERE topic_id = ? ORDER BY message_id")
        .all(topic.id) as unknown as Array<{ id: number }>).map((row) => row.id).slice(0, 8),
    }));
    return {
      ...(coreRow && coreSourceMessageIds.length > 0 ? { core: coreRow.text } : {}),
      coreSourceMessageIds,
      topics: storedTopics,
    };
  }

  workingSet(query: string): MemoryDistillationContext {
    const core = this.context(query);
    const relatedFacts = this.#facts.searchFacts(query, 16).filter((fact) => fact.status === "active");
    const currentFacts = this.#facts.listFacts(100).filter((fact) => fact.status === "active");
    const recentPlans = currentFacts.filter((fact) => fact.kind === "plan").slice(0, 8);
    const recentFacts = currentFacts.slice(0, 8);
    // 终态计划必须引用活动计划 id（#137）：先带上最近的活动计划，避免被 16 条 bm25 相关事实挤出 12 条配额。
    const leadPlans = recentPlans.slice(0, 4);
    const facts = [...new Map([...leadPlans, ...relatedFacts, ...recentPlans, ...recentFacts].map((fact) => [fact.id, fact])).values()]
      .slice(0, 12)
      .map((fact) => ({
        ...fact,
        value: fact.value.slice(0, 200),
        sources: fact.sources.slice(0, 2).map((source) => ({ ...source, quote: source.quote.slice(0, 120) })),
      }));
    const rows = this.#db.prepare(`
      SELECT id, topic_key AS key, title, summary, updated_at AS updatedAt
      FROM memory_topics ORDER BY updated_at DESC LIMIT 4
    `).all() as unknown as Array<{ id: number; key: string; title: string; summary: string; updatedAt: string }>;
    const selected = core.topics.length > 0 ? core.topics : rows.map((row) => ({
      key: row.key, title: row.title, summary: row.summary, updatedAt: row.updatedAt,
      sourceMessageIds: (this.#db.prepare("SELECT message_id AS id FROM memory_topic_sources WHERE topic_id = ? ORDER BY message_id DESC LIMIT 8")
        .all(row.id) as unknown as Array<{ id: number }>).map((item) => item.id),
    }));
    const topics = selected.slice(0, 4).map((topic) => ({
      ...topic,
      summary: topic.summary.slice(0, 500),
      sourceMessageIds: topic.sourceMessageIds.slice(0, 8),
    }));
    const activePlanSubjects = (this.#db.prepare("SELECT DISTINCT subject FROM memory_facts WHERE kind = 'plan' AND status = 'active'").all() as unknown as Array<{ subject: string }>).map((row) => row.subject);
    return { ...core, topics, facts, activePlanSubjects };
  }

  publish(
    input: MemoryDistillation,
    jobIds: number[],
    completeFactsAndSummary: boolean,
    observation?: { sessionId: string; fromMessageId: number; throughMessageId: number },
  ) {
    return this.#facts.saveFactsBatch(input.facts, ({ supersededIds }) => {
      const now = new Date().toISOString();
      const invalidatedSources = this.#invalidateSupersededNotes(supersededIds);
      for (const topic of input.topics) {
        if (topic.sourceMessageIds.some((id) => invalidatedSources.has(id))) continue;
        this.#saveTopic(topic, now);
      }
      if (input.core?.trim() && !input.coreSourceMessageIds.some((id) => invalidatedSources.has(id))) {
        this.#saveCore(input.core.trim().slice(0, 1_200), input.coreSourceMessageIds, now);
      }
      if (input.observation && observation) {
        this.#db.prepare(`
          INSERT INTO session_observations(session_id, summary, from_message_id, through_message_id, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(session_id) DO UPDATE SET summary = excluded.summary,
            from_message_id = MIN(session_observations.from_message_id, excluded.from_message_id),
            through_message_id = MAX(session_observations.through_message_id, excluded.through_message_id),
            updated_at = excluded.updated_at
        `).run(observation.sessionId, input.observation, observation.fromMessageId, observation.throughMessageId, now);
      }
      if (jobIds.length && completeFactsAndSummary) {
        const update = this.#db.prepare(`
          UPDATE memory_jobs SET facts_done = 1, summary_done = 1, legacy_done = 1, updated_at = ?
          WHERE id = ? AND status = 'running'
        `);
        for (const id of jobIds) update.run(now, id);
      }
    });
  }

  removeFact(id: number) {
    return this.#facts.removeFact(id, (sourceIds) => this.#invalidateSourceMessages(sourceIds));
  }

  #invalidateSupersededNotes(factIds: number[]) {
    const sources = new Set<number>();
    for (const factId of factIds) {
      const rows = this.#db.prepare("SELECT message_id AS id FROM memory_fact_sources WHERE fact_id = ?").all(factId) as unknown as Array<{ id: number }>;
      for (const row of rows) sources.add(row.id);
    }
    if (factIds.length > 0) {
      const placeholders = factIds.map(() => "?").join(",");
      this.#db.prepare(`UPDATE proactive_triggers SET status = 'suppressed', updated_at = ? WHERE fact_id IN (${placeholders}) AND status IN ('pending', 'generating')`)
        .run(new Date().toISOString(), ...factIds);
    }
    this.#invalidateSourceMessages([...sources]);
    return sources;
  }

  #invalidateSourceMessages(sourceIds: number[]) {
    if (sourceIds.length === 0) return;
    const placeholders = sourceIds.map(() => "?").join(",");
    const topics = this.#db.prepare(`
      SELECT DISTINCT topic_id AS id FROM memory_topic_sources WHERE message_id IN (${placeholders})
    `).all(...sourceIds) as unknown as Array<{ id: number }>;
    for (const topic of topics) {
      this.#db.prepare("DELETE FROM memory_topic_search WHERE rowid = ?").run(topic.id);
      this.#db.prepare("DELETE FROM memory_topics WHERE id = ?").run(topic.id);
    }
    this.#db.prepare(`
      DELETE FROM memory_core WHERE id = 1 AND EXISTS (
        SELECT 1 FROM memory_core_sources WHERE core_id = 1 AND message_id IN (${placeholders})
      )
    `).run(...sourceIds);
    const invalidateObservation = this.#db.prepare(`
      DELETE FROM session_observations
      WHERE session_id = (SELECT session_id FROM messages WHERE id = ?)
        AND from_message_id <= ? AND through_message_id >= ?
    `);
    for (const sourceId of sourceIds) invalidateObservation.run(sourceId, sourceId, sourceId);
  }

  #saveTopic(topic: MemoryTopicCandidate, now: string) {
    const key = topic.key.trim().slice(0, 80);
    const title = topic.title.trim().slice(0, 100);
    const summary = topic.summary.trim().slice(0, 1_200);
    const sources = [...new Set(topic.sourceMessageIds)].filter((id) => this.#messageExists(id));
    if (!/^[a-z0-9_-]{1,80}$/u.test(key) || !title || !summary || sources.length === 0) return;
    this.#db.prepare(`
      INSERT INTO memory_topics(topic_key, title, summary, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(topic_key) DO UPDATE SET title = excluded.title, summary = excluded.summary, updated_at = excluded.updated_at
    `).run(key, title, summary, now);
    const row = this.#db.prepare("SELECT id FROM memory_topics WHERE topic_key = ?").get(key) as unknown as { id: number };
    this.#db.prepare("DELETE FROM memory_topic_sources WHERE topic_id = ?").run(row.id);
    const addSource = this.#db.prepare("INSERT OR IGNORE INTO memory_topic_sources(topic_id, message_id) VALUES (?, ?)");
    for (const messageId of sources) addSource.run(row.id, messageId);
    this.#db.prepare("DELETE FROM memory_topic_search WHERE rowid = ?").run(row.id);
    this.#db.prepare("INSERT INTO memory_topic_search(rowid, terms) VALUES (?, ?)").run(row.id, indexedMessageText(`${title} ${summary}`));
  }

  #saveCore(text: string, sourceMessageIds: number[], now: string) {
    const sources = [...new Set(sourceMessageIds)].filter((id) => this.#messageExists(id));
    if (sources.length === 0) return;
    this.#db.prepare(`
      INSERT INTO memory_core(id, text, updated_at) VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at
    `).run(text, now);
    this.#db.prepare("DELETE FROM memory_core_sources WHERE core_id = 1").run();
    const addSource = this.#db.prepare("INSERT OR IGNORE INTO memory_core_sources(core_id, message_id) VALUES (1, ?)");
    for (const messageId of sources) addSource.run(messageId);
  }

  #messageExists(id: number) {
    return Boolean(this.#db.prepare("SELECT 1 FROM messages WHERE id = ?").get(id));
  }
}
