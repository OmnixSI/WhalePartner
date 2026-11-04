# Assumption Ledger — C1/C2 video understanding
<!-- ASK mode: never -->

| ID | Under-determined by the request | Chosen | Class | Source |
|---|---|---|---|---|
| A-001 | Whether C2 should output timestamped chapters or one narrative summary | Produce one coherent whole-video summary; use timestamps only to align evidence and preserve source duration/link | semantic | user |
| A-002 | How the local model receives visual evidence | Attach extracted frame files with `codex exec --image`; use GPT-6 Luna at minimal reasoning | interface | user + existing Codex CLI |
| A-003 | What to do when a platform subtitle track has no usable text | Call Bilibili Bcut ASR when no transcript body is available; reuse a valid cached ASR result | semantic | existing vendored extractor + C1 requirement |
| A-004 | How to balance visual coverage and sampling cost without saving the source video | Select one subtitle-aligned frame per duration bucket, use the bucket center when no candidate exists, cap at 8 frames, and resize to 768px width | semantic | user preference + existing extractor |
| A-005 | Which media should persist locally | Stream selected frames from Bilibili; keep frame images, transcript, and summary, but not the complete source video | interface | user preference |
| A-006 | How much text evidence and audience reaction to send to the model | Send at most 12,000 transcript characters; when truncated, keep the first 4,800 characters and one short excerpt per 3-minute interval, up to 60 intervals. Add 8 fetched comments with one reply each and 12 sampled danmaku messages | semantic | token efficiency requirement + scope judgment |
| A-007 | What to do when neither transcript nor frame images are available | Save source evidence and stop before Codex; do not infer a video summary from metadata or audience reaction alone | semantic | user priority for video-grounded understanding |
| A-008 | Reader-facing summary layout | Use a natural whole-video share paragraph followed by compact source/evidence details; do not add a chapter timeline | interface | user request |
| A-009 | How the CLI signals and saves an incomplete evidence run | Return a non-zero exit status when rate limiting stops a run or direct video evidence is insufficient; remove the prior summary and usage record before saving newly collected evidence | interface | sweep |

## Notes

- **A-003** — Bcut is a Bilibili service. The fallback submits the Bilibili audio stream URL only when no subtitle text is available. Platform subtitle text remains preferred.
- **A-004** — Duration buckets keep frame coverage across the video; the nearest subtitle segment anchors each bucket when available. Without a local source file, FFmpeg cannot scan the entire video for scene changes.
- **A-006** — The transcript cap preserves the beginning and samples later intervals. Comments and danmaku remain supporting context, not primary evidence.
- **A-007** — If one direct evidence source is available, the summary prompt must disclose the missing source; if both are absent, the CLI saves evidence and does not call the model.
