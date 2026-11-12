import assert from "node:assert/strict";
import test from "node:test";
import { dayKey, dayLabel, visibleTurns } from "../src/components/chat/chatThreadUtils.ts";
import type { Turn } from "../src/components/chat/types.ts";

const now = new Date(2026, 10, 13, 12, 0, 0); // 2026-11-13 本地中午

function turn(patch: Partial<Turn> & Pick<Turn, "key" | "role" | "text">): Turn {
  return { at: new Date(2026, 10, 13, 10, 0, 0).toISOString(), status: "done", ...patch };
}

test("dayKey / dayLabel distinguish today, yesterday and older days", () => {
  assert.equal(dayKey("not-a-date"), "");
  assert.equal(dayLabel("2026-11-13T09:00:00+11:00", now), "今天");
  assert.equal(dayLabel("2026-11-12T22:00:00+11:00", now), "昨天");
  assert.match(dayLabel("2026-11-10T09:00:00+11:00", now), /^11 月 10 日 · 周二$/);
});

test("visibleTurns drops empty/failed rows, honours excludeKey and limit", () => {
  const turns: Turn[] = [
    turn({ key: "a", role: "her", text: "第一句" }),
    turn({ key: "b", role: "me", text: "第二句" }),
    turn({ key: "c", role: "her", text: "   " }),
    turn({ key: "d", role: "me", text: "没送出去", status: "failed" }),
    turn({ key: "e", role: "her", text: "正在说的这句" }),
    turn({ key: "f", role: "me", text: "最后一句" }),
  ];
  assert.deepEqual(visibleTurns(turns, "e", 3).map((t) => t.key), ["a", "b", "f"]);
  assert.deepEqual(visibleTurns(turns, undefined, 2).map((t) => t.key), ["e", "f"]);
});
