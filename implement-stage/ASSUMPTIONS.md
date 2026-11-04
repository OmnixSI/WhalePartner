# Assumption Ledger — Local Bilibili public-material summary
<!-- ASK mode: never -->

| ID | Under-determined by the request | Chosen | Class | Source |
|----|--------------------------------|--------|-------|--------|
| A-001 | Where the prototype should live | A TypeScript/Node.js CLI/service prototype under `apps/api`, ready to be wrapped by the future API | interface | user |
| A-002 | Which existing extractor to reuse | Vendor `dsh-bilibili` v0.8.0 under its MIT license and use its metadata, subtitle, comment, danmaku, and formatting paths | interface | user |
| A-003 | Which Bilibili links are supported | Bare BV ids, `bilibili.com/video/BV...` URLs, and `b23.tv` short links | interface | default |
| A-004 | What the summary may claim | It uses whichever public text evidence is available: metadata, platform subtitle, sampled comments, and danmaku; it names evidence limits and never claims visual inspection | semantic | user |
| A-005 | Which media-derived evidence is allowed | Reuse platform-hosted subtitle and danmaku text; do not download/play video or audio, run ASR, extract frames, infer visual content, or write long-term memory | semantic | user |
| A-006 | How to run model inference | Use local `codex exec` with `gpt-6-luna` and `minimal`; no cloud inference adapter in this spike | interface | user |
| A-007 | Comment sample size and saved outputs | Fetch up to 20 top-level comments; treat comments and danmaku as samples, not audience consensus; save JSON/Markdown under ignored `.local/video-summaries/` | interface | default |
| A-008 | What to do when the public comment endpoint fails | Keep metadata, report the comment retrieval note, and label the resulting evidence as limited | semantic | default |

## Notes

- **A-002** — The upstream extractor already handles Bilibili link resolution, metadata, subtitle text, comments, danmaku, and result formatting. Run it with `asrProvider: "none"`, `extractFrames: false`, and `downloadVideo: false`; retain its MIT license.
- **A-004** — Platform subtitles can support a summary of spoken content, but cannot establish visual details. Without subtitles, comments and danmaku are only sampled reactions; the result must not present them as a confirmed account of the video.
- **A-005** — Platform subtitles may be absent or login-gated. In that case, keep the available metadata/comment/danmaku evidence and state the limit; do not trigger an ASR fallback.
