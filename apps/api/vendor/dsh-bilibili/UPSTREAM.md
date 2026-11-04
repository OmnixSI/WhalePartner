# Upstream source

The files in this directory are from [`CZX2244/dsh-bilibili`](https://github.com/CZX2244/dsh-bilibili), version 0.8.0, under the MIT license. The original license is in `LICENSE`.

- `lib/extractor.js` reuses BV/short-link resolution and the video metadata, platform subtitle, comment, and danmaku extractors.
- `lib/keyframes.js` is a dependency of the extractor and formatter. The local CLI disables keyframe extraction.
- `lib/format.js` reuses the upstream model-facing evidence formatter. Its final hint was adjusted to say “text only” when frame extraction is disabled.
- `templates/summary-upstream.md` retains the upstream summary template for reference. The active prompt adapts its evidence-based structure to this prototype.
- `lib/extractor.js` reuses the upstream WBI signer for metadata lookup through `/x/web-interface/wbi/view`. It serializes Bilibili requests with a two-second gap. HTTP 412/429 and API risk-control codes `-352`/`-412` stop queued requests without retrying; the local CLI persists a 15-minute pause, or a longer server `Retry-After` value.
- `lib/format.js` bounds model input to 8,000 transcript characters, a 500-character description, 10 hot comments, 10 repeated danmaku messages, and up to 30 timeline samples. The local extractor spreads up to 200 samples across the XML result; the formatter removes repeated text within a time window and omits timeline messages already represented by the frequency list.

The local service calls the extractor with `asrProvider: "none"`, `extractFrames: false`, and `downloadVideo: false`.

## Local Bilibili login

The CLI obtains a QR login URL from Bilibili's passport API and renders it locally with macOS Core Image. It does not send the QR URL to a third-party image service. After successful login, the CLI verifies the session through Bilibili's `nav` endpoint and stores only `SESSDATA` in `.local/bilibili-session.json` with owner-only file permissions. The session is omitted from extraction results and logs.

Run `pnpm --dir apps/api run login` to create a QR code, then `pnpm --dir apps/api run login -- --wait` after scanning to confirm and save the session. `pnpm --dir apps/api run status` checks the saved session; `logout` removes it. A single `summarize` command accepts multiple links and uses the local session for the whole run. The CLI remains the current local prototype; it has no front-end UI.

Each successful summary stores Codex-reported input, cached-input, and output token counts in `usage.json` beside `summary.md` when the CLI includes usage in its JSONL response. It also stores prompt and summary character counts.

## Request pacing

One process sends Bilibili requests sequentially, with at least two seconds between requests. A rate-control response aborts remaining requests and creates `.local/bilibili-rate-limit.json`; future CLI commands make no Bilibili requests until the stored pause expires. Network failures get at most one retry after ten seconds. This lowers request pressure but cannot guarantee Bilibili will never apply a restriction.

## Anonymous sample

On 2026-11-04, `BV14Baa6JENd` was collected without `SESSDATA`. Metadata, description, comments, and danmaku were returned. The public metadata reported 65,119 danmaku, while the legacy XML endpoint returned 1,200 entries for summarization. The model received a 1,970-character (3,660-byte) prompt; it did not receive the full `source.json`. The XML result is a sample, not the full danmaku history. Bilibili's segmented protobuf endpoint is a possible source for broader coverage ([API reference](https://github.com/melon-444/bilibili-API-collect-fork/blob/master/docs/danmaku/danmaku_proto.md)); it is not implemented here.
