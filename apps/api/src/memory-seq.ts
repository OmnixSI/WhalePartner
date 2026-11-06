import type { DatabaseSync } from "node:sqlite";
import type { MemoryEntry, MemoryKind } from "./memory/types.ts";

/** 会被编号的记忆类型。聊天消息本身不编号。 */
export const SEQ_KINDS: readonly MemoryKind[] = ["fact", "experience"];

interface SeqRow {
  ref_type: string;
  ref_id: string;
  seq: number;
}

function keyOf(entry: Pick<MemoryEntry, "kind" | "id">) {
  return `${entry.kind}:${entry.id}`;
}

function compareEntries(a: MemoryEntry, b: MemoryEntry) {
  const byTime = (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
  if (byTime !== 0) return byTime;
  const aNumber = Number(a.id);
  const bNumber = Number(b.id);
  if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) return aNumber - bNumber;
  return a.id.localeCompare(b.id);
}

/**
 * 惰性分配“图鉴编号”（B4）：每个角色的记忆按创建顺序拿到 1、2、3…，永不改变、永不复用。
 *
 * - 第一次打开记忆列表时，为还没有编号的记录按 `createdAt, id` 顺序补号（旧库迁移）。
 * - 已经不存在的记录，编号行删掉；计数器不回退，所以空出来的号不会补给别人。
 * - 分配在事务里一次做完，`UNIQUE(character, seq)` 兜住并发。
 */
export function ensureSeq(db: DatabaseSync, character: string, entries: MemoryEntry[]): Map<string, number> {
  const relevant = entries.filter((entry) => SEQ_KINDS.includes(entry.kind));
  const alive = new Set(relevant.map(keyOf));
  const assigned = new Map<string, number>();

  db.exec("BEGIN IMMEDIATE");
  try {
    const rows = db.prepare("SELECT ref_type, ref_id, seq FROM memory_seq WHERE character = ?").all(character) as unknown as SeqRow[];
    const existing = new Map<string, number>();
    for (const row of rows) {
      const key = `${row.ref_type}:${row.ref_id}`;
      if (alive.has(key)) existing.set(key, Number(row.seq));
      else db.prepare("DELETE FROM memory_seq WHERE ref_type = ? AND ref_id = ?").run(row.ref_type, row.ref_id);
    }

    const counterRow = db.prepare("SELECT last FROM memory_seq_counter WHERE character = ?").get(character) as { last?: number } | undefined;
    let last = Number(counterRow?.last ?? 0);
    const missing = relevant.filter((entry) => !existing.has(keyOf(entry))).sort(compareEntries);
    for (const entry of missing) {
      last += 1;
      db.prepare("INSERT INTO memory_seq (ref_type, ref_id, character, seq) VALUES (?, ?, ?, ?)")
        .run(entry.kind, entry.id, character, last);
      existing.set(keyOf(entry), last);
    }
    if (missing.length > 0) {
      db.prepare("INSERT INTO memory_seq_counter (character, last) VALUES (?, ?) ON CONFLICT(character) DO UPDATE SET last = excluded.last")
        .run(character, last);
    }
    for (const [key, seq] of existing) assigned.set(key, seq);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return assigned;
}

export function seqOf(assigned: Map<string, number>, entry: Pick<MemoryEntry, "kind" | "id">): number | null {
  return assigned.get(keyOf(entry)) ?? null;
}
