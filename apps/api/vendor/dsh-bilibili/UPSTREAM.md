# Upstream source

The files in this directory are from [`CZX2244/dsh-bilibili`](https://github.com/CZX2244/dsh-bilibili), version 0.8.0, under the MIT license. The original license is in `LICENSE`.

- `lib/extractor.js` reuses BV/short-link resolution and the video metadata, platform subtitle, comment, and danmaku extractors.
- `lib/keyframes.js` is a dependency of the extractor and formatter. The local CLI disables keyframe extraction.
- `lib/format.js` reuses the upstream model-facing evidence formatter. Its final hint was adjusted to say “text only” when frame extraction is disabled.
- `templates/summary-upstream.md` retains the upstream summary template for reference. The active prompt adapts its evidence-based structure to this prototype.
- `lib/extractor.js` reuses the upstream WBI signer for metadata lookup through `/x/web-interface/wbi/view`, with the legacy view endpoint as a fallback when WBI returns HTTP 412. This follows the endpoint migration documented by [XZXZZX-Ai/bilibili-mcp](https://github.com/XZXZZX-Ai/bilibili-mcp/blob/master/CHANGELOG.md); no code was copied from that project.
- `lib/format.js` bounds model input to 8,000 transcript characters, a 500-character description, 10 hot comments, 10 repeated danmaku messages, and up to 30 timeline samples. The local extractor spreads up to 200 samples across the XML result; the formatter removes repeated text within a time window and omits timeline messages already represented by the frequency list.

The local service calls the extractor with `asrProvider: "none"`, `extractFrames: false`, and `downloadVideo: false`.

## Anonymous sample

On 2026-11-04, `BV14Baa6JENd` was collected without `SESSDATA`. Metadata, description, comments, and danmaku were returned. The public metadata reported 65,119 danmaku, while the legacy XML endpoint returned 1,200 entries for summarization. The model received a 1,970-character (3,660-byte) prompt; it did not receive the full `source.json`. The XML result is a sample, not the full danmaku history. Bilibili's segmented protobuf endpoint is a possible source for broader coverage ([API reference](https://github.com/melon-444/bilibili-API-collect-fork/blob/master/docs/danmaku/danmaku_proto.md)); it is not implemented here.
