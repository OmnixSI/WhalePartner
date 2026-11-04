# Build Note — C1/C2 Local Bilibili Video Pipeline

## Current status

The local C1/C2 prototype is merged. It is a CLI proof of the video pipeline; the app shell, long-term memory, diary workflow, and end-to-end integration remain separate MVP work.

## Pipeline

1. Accept a Bilibili URL, short link, or BV ID and load the saved local Bilibili session when it is valid.
2. Collect video metadata and platform subtitles. If no usable subtitle text is available, request Bcut ASR. Comments and danmaku are supporting context.
3. Use FFmpeg to sample up to eight frames from the remote playback stream. The complete video is not saved locally.
4. Send transcript text and sampled frames to the local Codex CLI using GPT-6 Luna with minimal reasoning.
5. Save source evidence, frames, the whole-video summary, and reported token usage under .local/video-summaries/<BV ID>/. These local artifacts are ignored by Git.

Bilibili API requests are serialized with a two-second gap; multi-video CLI batches also wait five seconds between video requests.

## Ten-video benchmark

The ten-video baseline and its per-video source, summary, usage, and frame paths are recorded in the local file `.local/video-summaries/benchmark_2026-11-04.csv`. All assets remain local and Git-ignored.

Run the repeatable benchmark with `pnpm --dir apps/api run benchmark:videos`. It uses the saved local Bilibili session through the CLI, preserves the five-second batch gap, and rebuilds the CSV from the resulting per-video assets. Pass `-- --export-only` to rebuild the CSV from existing assets without making network requests; existing manual review values in the CSV are retained.

| Measure | Result |
|---|---:|
| Videos summarized | 10 / 10 |
| Codex input tokens | 247,977 (109,824 cached) |
| Codex output tokens | 14,839 |
| Total reported model tokens | 262,816 |
| Evidence collection | 518.76 s total; 51.88 s average |
| Keyframe extraction | 362.69 s total; 36.27 s average |
| Codex summarization | 313.52 s total; 31.35 s average |
| Input-to-summary ready | 13m 58.19s total; 83.82 s average; 73.46 s median; 53.16–185.47 s range |
| Batch estimate including measured waits | 14m 43.20s |
| Frames | 64 saved; 4 failed |
| Supporting data | 200 comments fetched; 1,479 danmaku samples |

Each row records video ID resolution, metadata, subtitle/ASR, keyframe extraction, comments, danmaku, Codex summary, artifact writes, session setup, and input-to-summary time. The batch estimate sums each video's input-to-summary time and the recorded five-second inter-video waits; it is derived from stage measurements rather than a separate wall-clock stopwatch. The repeatable script prints these aggregates and preserves any manual review values already present in the CSV.

## Verified runs

| Video | Transcript | Supporting data | Frames | Codex usage |
|---|---|---|---:|---|
| BV1YJxP6KE65 | 4,624 characters, 391 segments | Platform AI subtitles | 8 | 27,444 input (11,520 cached), 1,497 output |
| BV1Ac4c61E2C | 3,564 characters, 441 segments | 20 comments; 1,717 danmaku total, 200 sampled | 8 | 27,587 input (11,520 cached), 756 output |

Both runs produced whole-video summaries with source links and evidence notes. The latest run also verified the saved Bilibili login session, subtitle retrieval, comments, danmaku, remote frame extraction, and Codex token reporting in one invocation.

## Validation

- The local CLI completed live end-to-end runs on BV1YJxP6KE65 and BV1Ac4c61E2C.
- The API TypeScript typecheck completed successfully; pnpm reports that the installed Node 24.21.0 is below the package's declared Node 26 range.
- The extractor JavaScript syntax check completed successfully.
- The Bcut ASR fallback is covered by a mocked response. Its remote fallback path has not yet been verified on a real video without usable platform subtitles.

## Remaining work

- Connect the local pipeline to the app's video submission and backend interfaces.
- Agree and implement the summary-to-memory contract; add the scheduled diary and diary page flows.
- Measure dollar cost per video hour and assess summary quality across a broader sample. Current Codex runs expose token counts, not a per-run dollar charge.
- Bilibili may return HTTP 412 or 429. Requests are serialized, and the CLI records a cooldown and stops instead of retrying aggressively.
- Production model hosting and multi-device operation are outside this local prototype.
