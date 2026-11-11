import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { frequencyLimit, nextLocalDay, normalizedProactiveText, PROACTIVE_DELAY_MS, PROACTIVE_EXPIRY_MS, type CompanionFrequency, type CompanionSettings, type CompanionSettingsPatch } from "../proactive/policy.ts";
import type { StoredMessage } from "./types.ts";
import { SessionRepository } from "./sessions.ts";
import { DailyCounters } from "./daily-counters.ts";

interface ProactiveRow {
  id: string;
  sourceMessageId: number;
  factId: number;
  sessionId: string;
  planText: string;
  evidence: string;
  dueAt: string;
  expiresAt: string;
  status: "pending" | "generating" | "sent" | "suppressed" | "expired" | "failed";
  attempts: number;
  messageId?: number | null;
}

interface SendCheck {
  allowed: boolean;
  nextAt?: string;
}

export class ProactiveRepository {
  readonly #db: DatabaseSync;
  readonly #sessions: SessionRepository;
  /** 已发的主动消息记在独立账本里：删会话不会让当天的次数和冷却清零。 */
  readonly #counters: DailyCounters;

  constructor(db: DatabaseSync, sessions: SessionRepository) {
    this.#db = db;
    this.#sessions = sessions;
    this.#counters = new DailyCounters(db);
  }

  settings(): CompanionSettings {
    const row = this.#db.prepare("SELECT enabled, frequency, quiet_start AS quietStart, quiet_end AS quietEnd FROM companion_settings WHERE id = 1").get() as { enabled: number; frequency: string; quietStart: string; quietEnd: string };
    const frequency: CompanionFrequency = row.frequency === "normal" ? "normal" : "rare";
    return { enabled: row.enabled === 1, frequency, quiet: { start: row.quietStart, end: row.quietEnd } };
  }

  putSettings(patch: CompanionSettingsPatch): CompanionSettings {
    const current = this.settings();
    const next = { ...current, ...patch, quiet: { ...current.quiet, ...(patch.quiet ?? {}) } };
    this.#db.prepare("UPDATE companion_settings SET enabled = ?, frequency = ?, quiet_start = ?, quiet_end = ?, updated_at = ? WHERE id = 1")
      .run(next.enabled ? 1 : 0, next.frequency, next.quiet.start, next.quiet.end, new Date().toISOString());
    return next;
  }

  enqueue(input: { sourceMessageId: number; factId: number; sessionId: string; planText: string; evidence: string }, now = new Date()): string | undefined {
    if (!this.settings().enabled) return undefined;
    const source = this.#db.prepare("SELECT role, content FROM messages WHERE id = ? AND session_id = ?").get(input.sourceMessageId, input.sessionId) as { role: string; content: string } | undefined;
    if (!source || source.role !== "user" || !source.content.includes(input.evidence.trim())) return undefined;
    const fact = this.#db.prepare("SELECT kind, status FROM memory_facts WHERE id = ?").get(input.factId) as { kind: string; status: string } | undefined;
    const sourceLink = this.#db.prepare("SELECT 1 FROM memory_fact_sources WHERE fact_id = ? AND message_id = ? AND quote = ?")
      .get(input.factId, input.sourceMessageId, input.evidence.trim());
    if (!fact || fact.kind !== "plan" || fact.status !== "active" || !sourceLink) return undefined;
    const id = randomUUID();
    const createdAt = now.toISOString();
    const dueAt = new Date(now.getTime() + PROACTIVE_DELAY_MS).toISOString();
    const expiresAt = new Date(now.getTime() + PROACTIVE_EXPIRY_MS).toISOString();
    this.#db.prepare(`
      INSERT OR IGNORE INTO proactive_triggers(id, source_message_id, fact_id, session_id, plan_text, evidence, due_at, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.sourceMessageId, input.factId, input.sessionId, input.planText.trim().slice(0, 600), input.evidence.trim().slice(0, 500), dueAt, expiresAt, createdAt, createdAt);
    const row = this.#db.prepare("SELECT id FROM proactive_triggers WHERE source_message_id = ? AND status = 'pending'").get(input.sourceMessageId) as { id: string } | undefined;
    return row?.id;
  }

  trigger(id: string): ProactiveRow | undefined {
    const row = this.#db.prepare(`
      SELECT id, source_message_id AS sourceMessageId, fact_id AS factId, session_id AS sessionId, plan_text AS planText,
        evidence, due_at AS dueAt, expires_at AS expiresAt, status, attempts, message_id AS messageId
      FROM proactive_triggers WHERE id = ?
    `).get(id) as unknown as ProactiveRow | undefined;
    return row ? { ...row, attempts: Number(row.attempts), sourceMessageId: Number(row.sourceMessageId), factId: Number(row.factId) } : undefined;
  }

  pending(now = new Date()): ProactiveRow[] {
    const rows = this.#db.prepare(`
      SELECT id, source_message_id AS sourceMessageId, fact_id AS factId, session_id AS sessionId, plan_text AS planText,
        evidence, due_at AS dueAt, expires_at AS expiresAt, status, attempts, message_id AS messageId
      FROM proactive_triggers WHERE status = 'pending' AND due_at > ? AND expires_at > ? ORDER BY due_at, id
    `).all(now.toISOString(), now.toISOString()) as unknown as ProactiveRow[];
    return rows.map((row) => ({ ...row, attempts: Number(row.attempts), sourceMessageId: Number(row.sourceMessageId), factId: Number(row.factId) }));
  }

  recover(now = new Date()) {
    const stamp = now.toISOString();
    this.#db.prepare("UPDATE proactive_triggers SET status = 'expired', updated_at = ? WHERE status IN ('pending','generating') AND (expires_at <= ? OR due_at <= ?)")
      .run(stamp, stamp, stamp);
    this.#db.prepare("UPDATE proactive_triggers SET status = 'pending', updated_at = ? WHERE status = 'generating' AND due_at > ? AND expires_at > ?")
      .run(stamp, stamp, stamp);
  }

  claim(id: string, now = new Date()): ProactiveRow | undefined {
    const row = this.#db.prepare(`
      UPDATE proactive_triggers SET status = 'generating', attempts = attempts + 1, updated_at = ?
      WHERE id = ? AND status = 'pending' AND due_at <= ? AND expires_at > ?
      RETURNING id, source_message_id AS sourceMessageId, fact_id AS factId, session_id AS sessionId, plan_text AS planText,
        evidence, due_at AS dueAt, expires_at AS expiresAt, status, attempts, message_id AS messageId
    `).get(now.toISOString(), id, now.toISOString(), now.toISOString()) as unknown as ProactiveRow | undefined;
    return row ? { ...row, attempts: Number(row.attempts), sourceMessageId: Number(row.sourceMessageId), factId: Number(row.factId) } : undefined;
  }

  activePlanFact(id: number): boolean {
    return Boolean(this.#db.prepare("SELECT 1 FROM memory_facts WHERE id = ? AND kind = 'plan' AND status = 'active'").get(id));
  }

  defer(id: string, dueAt: Date, now = new Date()) {
    const stamp = now.toISOString();
    const expires = this.trigger(id)?.expiresAt;
    if (!expires || Date.parse(expires) <= dueAt.getTime()) {
      this.#db.prepare("UPDATE proactive_triggers SET status = 'expired', updated_at = ? WHERE id = ? AND status IN ('pending','generating')").run(stamp, id);
      return false;
    }
    this.#db.prepare("UPDATE proactive_triggers SET status = 'pending', due_at = ?, updated_at = ? WHERE id = ? AND status IN ('pending','generating')")
      .run(dueAt.toISOString(), stamp, id);
    return true;
  }

  suppress(id: string, now = new Date()) {
    this.#db.prepare("UPDATE proactive_triggers SET status = 'suppressed', updated_at = ? WHERE id = ? AND status IN ('pending','generating')")
      .run(now.toISOString(), id);
  }

  expire(id: string, now = new Date()) {
    this.#db.prepare("UPDATE proactive_triggers SET status = 'expired', updated_at = ? WHERE id = ? AND status IN ('pending','generating')")
      .run(now.toISOString(), id);
  }

  fail(id: string, error: string, retryAt: Date, now = new Date()): boolean {
    const row = this.trigger(id);
    if (!row || row.status !== "generating") return false;
    const stamp = now.toISOString();
    if (row.attempts >= 2 || Date.parse(row.expiresAt) <= retryAt.getTime()) {
      this.#db.prepare("UPDATE proactive_triggers SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ? AND status = 'generating'")
        .run(error.slice(0, 500), stamp, id);
      return false;
    }
    this.#db.prepare("UPDATE proactive_triggers SET status = 'pending', due_at = ?, last_error = ?, updated_at = ? WHERE id = ? AND status = 'generating'")
      .run(retryAt.toISOString(), error.slice(0, 500), stamp, id);
    return true;
  }

  sendCheck(frequency: CompanionFrequency, now = new Date()): SendCheck {
    const count = this.#counters.value("proactive_sent", "", now);
    const last = this.#counters.lastAt("proactive_sent");
    const limit = frequencyLimit(frequency);
    if (count >= limit.daily) return { allowed: false, nextAt: nextLocalDay(now).toISOString() };
    if (last) {
      const next = new Date(last.getTime() + limit.cooldownMs);
      if (next.getTime() > now.getTime()) return { allowed: false, nextAt: next.toISOString() };
    }
    return { allowed: true };
  }

  deliver(id: string, content: string, emotion: string, now = new Date()):
    | { kind: "sent"; message: StoredMessage }
    | { kind: "duplicate" }
    | { kind: "stale" }
    | { kind: "limited"; dueAt: string }
    | undefined {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const trigger = this.trigger(id);
      if (!trigger || trigger.status !== "generating") {
        this.#db.exec("COMMIT");
        return undefined;
      }
      if (!this.activePlanFact(trigger.factId)) {
        this.#db.prepare("UPDATE proactive_triggers SET status = 'suppressed', updated_at = ? WHERE id = ? AND status = 'generating'")
          .run(now.toISOString(), id);
        this.#db.exec("COMMIT");
        return { kind: "stale" };
      }
      const check = this.sendCheck(this.settings().frequency, now);
      if (!check.allowed) {
        this.#db.prepare("UPDATE proactive_triggers SET status = 'pending', due_at = ?, updated_at = ? WHERE id = ? AND status = 'generating'")
          .run(check.nextAt!, now.toISOString(), id);
        this.#db.exec("COMMIT");
        return { kind: "limited", dueAt: check.nextAt! };
      }
      const previous = this.#db.prepare("SELECT content FROM proactive_triggers WHERE status = 'sent' ORDER BY sent_at DESC LIMIT 8")
        .all() as Array<{ content: string | null }>;
      const normalized = normalizedProactiveText(content);
      if (previous.some((row) => row.content && normalizedProactiveText(row.content) === normalized)) {
        this.#db.prepare("UPDATE proactive_triggers SET status = 'suppressed', content = ?, updated_at = ? WHERE id = ? AND status = 'generating'")
          .run(content, now.toISOString(), id);
        this.#db.exec("COMMIT");
        return { kind: "duplicate" };
      }
      const attachment = { type: "proactive", source: "plan_follow_up", triggerId: id, speak: false };
      const message = this.#sessions.add("assistant", content, emotion, "deepseek", trigger.sessionId, attachment);
      this.#db.prepare("UPDATE proactive_triggers SET status = 'sent', message_id = ?, content = ?, sent_at = ?, updated_at = ? WHERE id = ? AND status = 'generating'")
        .run(message.id, content, now.toISOString(), now.toISOString(), id);
      this.#counters.add("proactive_sent", "", 1, now);
      this.#db.exec("COMMIT");
      return { kind: "sent", message: { ...message, attachment } };
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
}
