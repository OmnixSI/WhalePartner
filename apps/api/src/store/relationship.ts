import type { DatabaseSync } from "node:sqlite";
import type { Emotion } from "../chat/emotion.ts";
import { AFFINITY_DAILY_LIMIT, AFFINITY_PER_COMPLETED_DEEPSEEK_TURN, recoverMood, relationshipSnapshot, type RelationshipSnapshot } from "../relationship/policy.ts";

const RELATIONSHIP_EMOTION_INTENSITY = 100;

export class RelationshipRepository {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  recordCompletedInteraction(input: {
    userMessageId: number;
    assistantMessageId: number;
    character: string;
    emotion: Emotion;
  }, now = new Date()) {
    const stamp = now.toISOString();
    const localDay = new Date(now);
    localDay.setHours(0, 0, 0, 0);
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const inserted = this.#db.prepare(`
        INSERT OR IGNORE INTO relationship_events(assistant_message_id, user_message_id, character, points, created_at)
        SELECT ?, ?, ?, 0, ?
        WHERE EXISTS (
          SELECT 1 FROM messages user_message, messages assistant_message
          WHERE user_message.id = ? AND user_message.role = 'user'
            AND assistant_message.id = ? AND assistant_message.role = 'assistant'
            AND user_message.session_id = assistant_message.session_id
            AND user_message.character = assistant_message.character
            AND assistant_message.character = ?
        )
      `).run(input.assistantMessageId, input.userMessageId, input.character, stamp,
        input.userMessageId, input.assistantMessageId, input.character);

      if (Number(inserted.changes) === 0) {
        this.#db.exec("COMMIT");
        return false;
      }

      this.#db.prepare(`
        INSERT INTO character_moods(character, emotion, intensity, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(character) DO UPDATE SET emotion = excluded.emotion, intensity = excluded.intensity, updated_at = excluded.updated_at
      `).run(input.character, input.emotion, input.emotion === "neutral" ? 0 : RELATIONSHIP_EMOTION_INTENSITY, stamp);

      if (input.character === "deepseek") {
        const count = this.#db.prepare(`
          SELECT COALESCE(SUM(points), 0) AS points
          FROM relationship_events WHERE created_at >= ? AND character = 'deepseek'
        `).get(localDay.toISOString()) as { points: number };
        const awarded = Number(count.points) < AFFINITY_DAILY_LIMIT ? AFFINITY_PER_COMPLETED_DEEPSEEK_TURN : 0;
        if (awarded) {
          this.#db.prepare("UPDATE relationship_events SET points = ? WHERE assistant_message_id = ?").run(awarded, input.assistantMessageId);
          this.#db.prepare("UPDATE relationship_state SET affinity_points = affinity_points + ?, updated_at = ? WHERE id = 1")
            .run(awarded, stamp);
        }
      }
      this.#db.exec("COMMIT");
      return true;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  snapshot(character: string, now = new Date()): RelationshipSnapshot {
    const state = this.#db.prepare("SELECT affinity_points AS points FROM relationship_state WHERE id = 1").get() as { points: number } | undefined;
    const row = this.#db.prepare("SELECT emotion, intensity, updated_at AS updatedAt FROM character_moods WHERE character = ?")
      .get(character) as { emotion: Emotion; intensity: number; updatedAt: string } | undefined;
    const mood = recoverMood(row?.emotion ?? "neutral", Number(row?.intensity ?? 0), row?.updatedAt ?? null, now);
    return relationshipSnapshot(Number(state?.points ?? 0), mood);
  }
}
