# Build Note — Local Bilibili public-material summary

| Rung | Feature | Acceptance check (ONE command) | Tier | Status |
|------|---------|-------------------------------|------|--------|
| F0 | CLI spine: fixture input → clearly marked placeholder artifact | `node apps/api/src/cli.ts --smoke` | MUST | ✅ |
| F1 | Reused Bilibili text extractor with media/ASR disabled, plus link/data tests | `pnpm --dir apps/api run test` | MUST | ✅ |
| F2 | Codex CLI summary adapter and prompt based on the evidence | `pnpm --dir apps/api run test` | MUST | ⬜ |
| F3 | Live public-link collection and end-to-end local summary | `pnpm --dir apps/api run summarize -- <public-bilibili-url>` | MUST | ⬜ |

## Run record

- F0: `/private/tmp/node-v26.13.0-darwin-arm64/bin/node apps/api/src/cli.ts --smoke` → exit 0; artifact `.local/PLACEHOLDER_smoke.json`; fix attempts: 0.
- F1: `pnpm --dir apps/api run test` → exit 0; three cases cover supported links, available subtitle extraction, and no-ASR behavior when subtitles are absent.
- F1: `pnpm --dir apps/api run typecheck` → exit 0; the vendored JavaScript extractor and TypeScript adapter compile together.

## Deferred

- Full C1/C2 processing with transcript, keyframes, actual audio/video understanding, and memory write.
- A deployed API and production model provider for mobile clients.

## Blockers
