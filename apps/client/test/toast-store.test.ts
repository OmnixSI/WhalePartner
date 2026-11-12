import assert from "node:assert/strict";
import { test } from "node:test";
import { toast, toastSnapshot } from "../src/components/ui/toast-store.ts";

test("onDismiss fires exactly once, however the toast leaves", () => {
  toast.clear();
  let n = 0;
  const id = toast({ title: "a", onDismiss: () => { n += 1; } });
  toast.dismiss(id);
  toast.dismiss(id);
  toast.clear();
  assert.equal(n, 1);
});

test("clear settles every open toast (route change = commit)", () => {
  toast.clear();
  const seen: string[] = [];
  toast({ title: "a", onDismiss: () => seen.push("a") });
  toast({ title: "b", onDismiss: () => seen.push("b") });
  toast.clear();
  assert.deepEqual(seen, ["a", "b"]);
  assert.equal(toastSnapshot().filter((t) => t.open).length, 0);
});

test("a toast pushed out by newer ones is settled, not silently lost", () => {
  toast.clear();
  const seen: string[] = [];
  for (const name of ["a", "b", "c", "d"]) toast({ title: name, onDismiss: () => seen.push(name) });
  assert.deepEqual(seen, ["a"]);
  assert.equal(toastSnapshot().filter((t) => t.open).length, 3);
  toast.clear();
});
