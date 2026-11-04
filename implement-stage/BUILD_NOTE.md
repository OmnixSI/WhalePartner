# Build Note — Local Bilibili public-material summary

| Rung | Feature | Acceptance check (ONE command) | Tier | Status |
|------|---------|-------------------------------|------|--------|
| F0 | CLI spine: fixture input → clearly marked placeholder artifact | `node apps/api/src/cli.ts --smoke` | MUST | ✅ |
| F1 | Reused Bilibili text extractor with media/ASR disabled, plus link/data tests | `pnpm --dir apps/api run test` | MUST | ✅ |
| F2 | Codex CLI summary adapter and prompt based on the evidence | `pnpm --dir apps/api run test` | MUST | ✅ |
| F3 | Live public-link collection and end-to-end local summary for a text-only sample | `pnpm --dir apps/api run summarize -- <public-bilibili-url>` | MUST | ✅ Sample verified |

## Run record

- F0: `/private/tmp/node-v26.13.0-darwin-arm64/bin/node apps/api/src/cli.ts --smoke` → exit 0; artifact `.local/PLACEHOLDER_smoke.json`.
- F1/F2: `npm test` in `apps/api` → exit 0; eight cases cover extraction, text-only media settings, prompt requirements, danmaku sampling, and Codex JSONL parsing.
- F1/F2: `npm run typecheck` in `apps/api` → exit 0.
- F3: `npm run summarize -- https://www.bilibili.com/video/BV14Baa6JENd/` → exit 0 with blank `SESSDATA`; metadata reported about 3.51 million views and 65,119 danmaku. The extractor returned 3 comments and 1,200 danmaku entries. The 1,970-character prompt was 3,660 UTF-8 bytes; it contained a 200-entry spread sample, 10 repeated-message counts, and 9 distinct timeline samples. No subtitle track was available. The local Codex adapter produced an evidence-bounded summary and saved it under `.local/video-summaries/BV14Baa6JENd/`.

## Deferred

- Full C1/C2 processing with transcript, keyframes, actual audio/video understanding, and memory write.
- A deployed API and production model provider for mobile clients.

## Limitations

The sample had no platform subtitles, so the summary could not describe its lyrics. The legacy XML danmaku endpoint returned 1,200 entries despite the metadata count of 65,119; comments returned 3 of 25,629. These are usable text samples, not complete discussion archives. The segmented protobuf danmaku endpoint is not implemented. This text-only prototype does not satisfy Issue #8's requirement for transcript and keyframe input.
