# Upstream source

The files in this directory are from [`CZX2244/dsh-bilibili`](https://github.com/CZX2244/dsh-bilibili), version 0.8.0, under the MIT license. The original license is in `LICENSE`.

- `lib/extractor.js` reuses BV/short-link resolution and the video metadata, platform subtitle, comment, and danmaku extractors.
- `lib/keyframes.js` is a dependency of the extractor and formatter. The local CLI disables keyframe extraction.
- `lib/format.js` reuses the upstream model-facing evidence formatter. Its final hint was adjusted to say “text only” when frame extraction is disabled.
- `templates/summary-upstream.md` retains the upstream summary template for reference. The active prompt adapts its evidence-based structure to this prototype.

The local service calls the extractor with `asrProvider: "none"`, `extractFrames: false`, and `downloadVideo: false`.
