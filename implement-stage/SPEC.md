# Spec — C1/C2 local Bilibili video understanding

**Target:** Complete the local C1/C2 prototype: collect transcript evidence, sample visual frames from a Bilibili playback stream, and ask the local Codex CLI for one whole-video Chinese summary.

**Inputs:** A BV id, Bilibili video URL, or supported `b23.tv` short link; the local Bilibili session when available; platform subtitles, Bcut ASR fallback, up to 20 fetched comments, and sampled danmaku.

**Outputs:** Summary, source evidence, extracted frame images, and token usage under `.local/video-summaries/<bvid>/`. The complete source video is not saved locally.

**Success command:** `pnpm --dir apps/api run typecheck && pnpm --dir apps/api test`. Live acceptance: `pnpm --dir apps/api run summarize -- <bilibili-url-or-bvid>`.

**Base commit:** `09e62b5c60d4925e208a91902b1814dc330ffe58`.

**Scope cuts:** No app shell, remote production model provider, long-term memory write, or Bilibili publishing. Summaries are whole-video narratives, not timestamped chapter lists.
