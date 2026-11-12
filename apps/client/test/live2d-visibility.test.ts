import assert from "node:assert/strict";
import { test } from "node:test";
import { syncTickerToVisibility } from "../src/avatar/live2d/visibility.ts";

function fakeTicker() {
  return {
    started: true, starts: 0, stops: 0,
    start() { this.started = true; this.starts += 1; },
    stop() { this.started = false; this.stops += 1; },
  };
}

test("hidden stops the ticker, visible starts it again", () => {
  const ticker = fakeTicker();
  syncTickerToVisibility(ticker, true);
  assert.equal(ticker.started, false);
  syncTickerToVisibility(ticker, false);
  assert.equal(ticker.started, true);
  assert.deepEqual([ticker.starts, ticker.stops], [1, 1]);
});

test("repeated syncs in the same state do not restart or re-stop the ticker", () => {
  const ticker = fakeTicker();
  syncTickerToVisibility(ticker, false);
  syncTickerToVisibility(ticker, false);
  syncTickerToVisibility(ticker, true);
  syncTickerToVisibility(ticker, true);
  assert.deepEqual([ticker.starts, ticker.stops], [0, 1]);
});
