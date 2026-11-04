# Spec — Local Bilibili public-material summary

**Target:** Build a local Node.js/TypeScript service prototype that accepts a user-shared Bilibili link, reuses the MIT-licensed `dsh-bilibili` extractor for metadata, available platform subtitles, public comments, and danmaku text, and asks the local Codex CLI for a Chinese evidence-bounded summary.

**Inputs:** A bare BV id, a Bilibili video URL, or a `b23.tv` short link. Anonymous public metadata, available platform subtitle text, danmaku text, and at most 20 top-level comments are used. No ASR fallback is run.

**Outputs:** Markdown to stdout and JSON/Markdown artifacts under `.local/video-summaries/<bvid>/`. The result identifies its text evidence and states that video/audio were not downloaded, frames were not extracted, and visual content was not seen.

**Success command:** `pnpm --dir apps/api run test && pnpm --dir apps/api run typecheck`; live acceptance is `pnpm --dir apps/api run summarize -- <public-bilibili-url>`.

**Base commit:** `3dc7b9b36cd66be5f8255d3aa568768f7e13e7f2`.

**Scope cuts:** No video/audio download or playback, ASR, keyframes, visual analysis, application shell, remote model service, or long-term memory writes. This preliminary text-only spike does not satisfy C1/C2 acceptance.
