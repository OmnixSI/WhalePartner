# Spec — C1/C2 local Bilibili video understanding

**Status (2026-11-05):** The local CLI pipeline is complete and merged in PR #15. The ten-video benchmark and browser-based local test page are on the open PR #16 branch. Product-shell and memory integration remain out of scope for this local prototype.

**Target:** Complete the local C1/C2 prototype: collect transcript evidence, sample visual frames from a Bilibili playback stream, and ask the local Codex CLI for one whole-video Chinese summary.

**Inputs:** A BV id, Bilibili video URL, or supported `b23.tv` short link; the local Bilibili session when available; platform subtitles, Bcut ASR fallback, up to 20 fetched comments, and sampled danmaku.

**Outputs:** The CLI saves the summary, source evidence, extracted frame images, and token usage under `.local/video-summaries/<bvid>/`. The local browser test page displays the same result and measurements without persisting them; its temporary frame directory is deleted after the request. The complete source video is not saved locally.

**Entry points:** `pnpm --dir apps/api run summarize -- <bilibili-url-or-bvid>` for the artifact-saving CLI; double-click `启动视频摘要测试.command` for the local browser test page.

**Current validation:** The API typecheck and browser inline-script syntax check pass. Live CLI runs and the ten-video benchmark are documented in `BUILD_NOTE.md`. The browser page has not yet been exercised with live Bilibili/Codex requests.

**Base commit:** `09e62b5c60d4925e208a91902b1814dc330ffe58`.

**Scope cuts:** No app shell, remote production model provider, long-term memory write, or Bilibili publishing. Summaries are whole-video narratives, not timestamped chapter lists.
