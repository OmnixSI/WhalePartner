# Build Note — Local Bilibili public-material summary

| Rung | Feature | Acceptance check(s) | Tier | Status |
|------|---------|-------------------------------|------|--------|
| F0 | CLI spine: fixture input → clearly marked placeholder artifact | `node apps/api/src/cli.ts --smoke` | MUST | ✅ |
| F1 | Reused Bilibili text extractor with media/ASR disabled, plus link/data tests | `pnpm --dir apps/api run test` | MUST | ✅ |
| F2 | Codex CLI summary adapter and prompt based on the evidence | `pnpm --dir apps/api run test` | MUST | ✅ |
| F3 | Live public-link collection and end-to-end local summary for a text-only sample | `pnpm --dir apps/api run summarize -- <public-bilibili-url>` | MUST | ✅ Sample verified |
| F4 | Local Bilibili QR login and authenticated text summary | `pnpm --dir apps/api run login` then `pnpm --dir apps/api run login -- --wait` | MUST | ✅ Three videos verified |

## Run record

- F0: `/private/tmp/node-v26.13.0-darwin-arm64/bin/node apps/api/src/cli.ts --smoke` → exit 0; artifact `.local/PLACEHOLDER_smoke.json`.
- F1/F2/F4: Node 26 `--run test` in `apps/api` → exit 0; nine cases cover extraction, text-only media settings, prompt requirements, danmaku sampling, optional `SESSDATA`, and Codex JSONL parsing.
- F1/F2/F4: Node 26 `--run typecheck` in `apps/api` → exit 0.
- F3: `npm run summarize -- https://www.bilibili.com/video/BV14Baa6JENd/` → exit 0 with blank `SESSDATA`; metadata reported about 3.51 million views and 65,119 danmaku. The extractor returned 3 comments and 1,200 danmaku entries. The 1,970-character prompt was 3,660 UTF-8 bytes; it contained a 200-entry spread sample, 10 repeated-message counts, and 9 distinct timeline samples. No subtitle track was available. The local Codex adapter produced an evidence-bounded summary and saved it under `.local/video-summaries/BV14Baa6JENd/`.
- Additional anonymous samples on 2026-11-04:

  | BV id | Public views | Comments fetched / total | Danmaku fetched / total | Formatted evidence chars | Summary basis |
  |-------|-------------:|-------------------------:|-----------------------:|-------------:|---------------|
  | `BV1YJxP6KE65` | 17,980 | 3 / 61 | 58 / 58 | 1,502 | Minecraft redstone survival challenge title, comments, and danmaku |
  | `BV1ZqJe6yEQd` | 170,303 | 3 / 191 | 285 / 285 | 1,558 | Fresh pepper and matsutake chicken title, comments, and danmaku |
  | `BV1RA4w6AE74` | 2,625,383 | 3 / 2,110 | 952 / 968 | 1,741 | ARC Raiders title, full public description, comments, and danmaku |

  These anonymous runs reported that platform subtitles required login. No subtitle text was collected. Summaries are saved under `.local/video-summaries/<bvid>/`.

- F4: On 2026-11-04, Bilibili QR login succeeded. The session was validated and stored locally under `.local/` with owner-only file permissions. The three links above were then processed serially with the authenticated session. No rate-control response occurred; no video, audio, or frames were downloaded or analyzed.

  | BV id | Subtitle | Subtitle characters / segments | Comments fetched / total | Danmaku sampled / metadata total | Prompt characters | Summary characters | Estimated prompt + answer tokens |
  |-------|----------|------------------------------:|-------------------------:|---------------------------------:|-----------------:|-------------------:|---------------------------------:|
  | `BV1YJxP6KE65` | Platform AI Chinese | 4,624 / 391 | 20 / 61 | 7,109 | 581 | ~5,800 |
  | `BV1ZqJe6yEQd` | Platform AI Chinese | 1,758 / 226 | 20 / 191 | 5,239 | 452 | ~4,300 |
  | `BV1RA4w6AE74` | Platform AI Chinese | 254 / 31 | 20 / 2,409 | 200 / 1,159 | 3,224 | 527 | ~2,400 |

  Estimated total: about 11,300 input-content tokens plus 1,300 output-content tokens, or 12,600 combined. This rough estimate counts each Chinese character as about one token and each four other characters as one token. The exact Codex CLI usage for this run was not recorded. New runs save the CLI-reported input, cached-input, and output usage in `usage.json` beside each summary.

## Deferred

- Full C1/C2 processing with transcript, keyframes, actual audio/video understanding, and memory write.
- A deployed API and production model provider for mobile clients.

## Limitations

The anonymous samples could not access platform subtitles; the authenticated run obtained AI-generated Chinese subtitle text for all three links. Token estimates for that run are character-based because the earlier Codex adapter did not retain server usage. The `usage.json` record captures exact CLI-reported usage on later runs when present in Codex JSONL output. Comments and danmaku remain samples rather than complete discussion archives. The segmented protobuf danmaku endpoint is not implemented. This text-only prototype does not satisfy Issue #8's requirement for keyframe input.
