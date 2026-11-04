# Assumption Ledger — Local Bilibili public-material summary
<!-- ASK mode: never -->

| ID | Under-determined by the request | Chosen | Class | Source |
|----|--------------------------------|--------|-------|--------|
| A-001 | Where the prototype should live | A TypeScript/Node.js CLI/service prototype under `apps/api`, ready to be wrapped by the future API | interface | user |
| A-002 | Which existing extractor to reuse | Vendor `dsh-bilibili` v0.8.0 under its MIT license and use its metadata, subtitle, comment, danmaku, and formatting paths | interface | user |
| A-003 | Which Bilibili links are supported | Bare BV ids, `bilibili.com/video/BV...` URLs, and `b23.tv` short links | interface | default |
| A-004 | What the summary may claim | It is an inference from public title, description, metadata, and sampled comments; it must say the video was not watched and mark insufficient evidence | semantic | user |
| A-005 | Which media-derived evidence is allowed | Reuse platform-hosted subtitle and danmaku text; do not download/play video or audio, run ASR, extract frames, infer visual content, or write long-term memory | semantic | user |
| A-006 | How to run model inference | Use local `codex exec` with `gpt-6-luna` and `minimal`; no cloud inference adapter in this spike | interface | user |
| A-007 | Comment sample size and saved outputs | Fetch up to 20 top-level comments; treat comments and danmaku as samples, not audience consensus; save JSON/Markdown under ignored `.local/video-summaries/` | interface | default |
| A-008 | What to do when the public comment endpoint fails | Keep metadata, report the comment retrieval note, and label the resulting evidence as limited | semantic | default |

## Notes

- **A-002** — The upstream extractor already handles Bilibili link resolution, metadata, subtitle text, comments, danmaku, and result formatting. Run it with `asrProvider: "none"`, `extractFrames: false`, and `downloadVideo: false`; retain its MIT license.
- **A-004** — Text evidence can support a content summary when a platform subtitle is available, but cannot establish visual details. The result must label sampled audience reactions and must not imply visual inspection.
- **A-005** — Platform subtitles may be absent or login-gated. In that case, keep the available metadata/comment/danmaku evidence and state the limit; do not trigger an ASR fallback.
