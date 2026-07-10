# X (Twitter) Video Caption Support — Design

**Date:** 2026-07-09
**Status:** Approved design, revised twice after code review (pending final plan execution)
**Feature:** Include the spoken content of a tweet's video in xTil summaries, sourced
from X's closed-caption (CC) track, by **extending the existing embedded-video
transcript framework**.

## Goal

When a tweet contains a video, feed the video's **closed captions** (the subtitle
track X ships with captioned videos) into the summarization pipeline as a transcript,
so the summary reflects what is *said* in the video — not just the tweet text and a
static poster thumbnail.

Explicitly **not** in scope:
- Audio transcription / speech-to-text (we use X's existing CC track only).
- Visual/frame analysis of the video.
- Quoted-tweet videos (detection explicitly excludes them).
- Private / age-gated / login-only videos (they degrade to the no-captions fallback).

## Decisions (from brainstorming)

| Question | Decision |
| --- | --- |
| What to extract from a video | Spoken content, via X's **closed captions** (not audio transcription). |
| Behavior when a video has **no** CC track | Keep current behavior — the poster thumbnail is already emitted as an image by the extractor — and add a note: `*(Video present; captions unavailable.)*` |
| Behavior for animated GIFs (also `<video>` on X) | Treated as "no video" via the syndication `type` field → **no note, no transcript**. |
| Surfaces covered | Direct tweet pages (`/status/<id>`) **and** feed (home/profile/search). |
| Sourcing approach | Public **syndication CDN** endpoint, wrapped in the **existing** `fetchEmbeddedVideoTranscript` framework. |

## Architecture: extend the existing framework

The codebase already has a per-provider embedded-video transcript framework for
exactly this shape of problem — a page that is not a dedicated video type but embeds
a video with captions. It lives in `fetchEmbeddedVideoTranscript`
(`content/index.ts:345`) and dispatches to sibling modules in `src/lib/`
(`cloudflare-stream.ts`, `vimeo.ts`, `dailymotion.ts`, `jwplayer.ts`,
`html5-video.ts`). It **already runs for tweets**: the guard at `content/index.ts:298`
is `content.type !== 'youtube' && content.type !== 'netflix'`, and tweets are
type `'twitter'`. It simply has no X detector today.

`cloudflare-stream.ts` performs the same master-m3u8 → subtitle-playlist → VTT chain
we need, and the shared `parseHlsSubtitleTracks`/`pickBestTrack`/`parseVtt` already
handle every parsing step (`parseVtt` strips the `<X-word-ms …>` tags X uses).

**No transcript marker, no `twitter.ts` extractor rewrite, no `App.tsx` change.** We
add: (a) an exported detector to `twitter.ts` that reuses its own proven helpers, and
(b) one background-resolved branch to `fetchEmbeddedVideoTranscript`.

### Where the work runs (revised after review): the whole chain runs in the background

The syndication endpoint's CORS (`ACAO: platform.twitter.com`) blocks a content-script
fetch, and the `.m3u8` allows only `x.com` (so a `twitter.com`-origin content script
would also be blocked). Rather than split fetches across content and background, the
**entire fetch chain runs in the background service worker**, which has `<all_urls>`
host permission and bypasses CORS on every hop. This also lets a single
`AbortController` bound both connect and body-read per request. Detection (DOM) stays
in the content script; the content branch sends one message and maps the result.

### Reused vs. genuinely new

| Concern | Reused (already exists) | New |
| --- | --- | --- |
| Detect own (non-quoted) tweet video | `<video>`+`pbs.twimg.com` poster, `isInsideQuotedTweet`, `pickMostVisibleArticle`, `findMainArticle`, `extractArticlePermalink`, `TWITTER_STATUS_RE` (all in `twitter.ts`) | thin `detectTweetVideo` wrapper |
| Parse `#EXT-X-MEDIA:TYPE=SUBTITLES` | `parseHlsSubtitleTracks` (moving to `transcript-lang.ts`) | — |
| Pick subtitle playlist line | first non-`#` line (as in `cloudflare-stream.ts:56`) | — |
| Language/track selection | `pickBestTrack` (`transcript-lang.ts:58`) | — |
| Parse WebVTT → `[H:MM:SS] text` | `parseVtt` (`transcript-lang.ts:136`) | — |
| UI word-count wiring | `content.transcriptWordCount` + `App.tsx:2781` | — |
| Poster fallback on no-CC | extractor already emits video posters as images | — |
| Derive syndication token | — | `deriveSyndicationToken` |
| Classify video / GIF / photo | — | `pickVideoM3u8` (reads syndication `mediaDetails[].type === 'video'`) |
| Resolve relative twimg URLs | — | `resolveTwimgUrl` |
| Bounded fetch (connect + body) | — | `fetchTextBounded` / `fetchJsonBounded` |
| Background orchestrator | — | `fetchTwitterVideoTranscript` + one message |

## Feasibility (validated end-to-end against tweet `2075240393419936189`)

The full chain works with **no auth and no MAIN-world bridge**:

1. `GET https://cdn.syndication.twimg.com/tweet-result?id=<id>&lang=en&token=<derived>`
   → tweet JSON with `mediaDetails[].video_info.variants[]`, including the HLS master
   `.m3u8` URL (`content_type: application/x-mpegURL`). `mediaDetails[].type` is
   `video` / `animated_gif` / `photo` — the authoritative video-vs-GIF signal.
2. `GET` the master `.m3u8` → contains `#EXT-X-MEDIA:TYPE=SUBTITLES,...,URI="..."`
   when captions exist (validated: auto-generated `en-gb` track).
3. `GET` the subtitle playlist `.m3u8` → a single `.vtt` segment path covering the
   whole video (validated: one segment, `EXTINF:9731.11`).
4. `GET` the `.vtt` → WebVTT with real spoken text wrapped in `<X-word-ms ...>` tags
   (stripped by the shared `parseVtt`).

Token derivation (react-tweet algorithm):
`((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '')`.
For `2075240393419936189` → `513k5q5yoew` → HTTP 200. Token precision loss from
`Number()` on 19-digit IDs is inherent to react-tweet and accepted.

### CORS (why the whole chain is in the background)

Observed `Access-Control-Allow-Origin`: syndication `tweet-result` →
`https://platform.twitter.com`; master/subtitle `.m3u8` → `https://x.com`; `.vtt` →
`*`. A content-script fetch is blocked on syndication (always) and on `.m3u8` when the
page origin is `twitter.com`. The background service worker (host permission
`<all_urls>`) is not subject to CORS, so running every hop there is uniform and
robust to future ACAO changes.

## Data flow

```
content/index.ts : fetchEmbeddedVideoTranscript(doc, url, langPrefs, summaryLang)
  ... existing branches (CF Stream, Vimeo, Dailymotion, JW, HTML5) ...
  NEW branch (before the generic HTML5 catch-all):
    tweetId = detectTweetVideo(doc, url)          // null unless the FOCAL, non-quoted
                                                  // tweet has its own <video> + real id
    if (tweetId):
       r = await <send FETCH_TWITTER_CAPTIONS {tweetId, langPrefs, summaryLang}>
       r.transcript                 -> return { transcript: r.transcript }
       r.captionStatus==='no-captions' -> return { status: 'no-captions' }   // note
       r.captionStatus==='no-video' | null -> fall through                    // no note
        │
background/index.ts : handleFetchTwitterCaptions -> fetchTwitterVideoTranscript(tweetId, …)
   1. token = deriveSyndicationToken(id)
   2. json = fetchJsonBounded(syndication tweet-result)
        null (network/private/age-gated) -> { status: 'no-captions' }
   3. m3u8 = pickVideoM3u8(json)          // type === 'video' only
        null (GIF/photo/none)            -> { status: 'no-video' }
   4. master = fetchTextBounded(m3u8) -> parseHlsSubtitleTracks -> pickBestTrack
        no tracks                        -> { status: 'no-captions' }
   5. subtitle playlist -> first non-# line -> resolveTwimgUrl
   6. vtt = fetchTextBounded(...) -> parseVtt
        empty                            -> { status: 'no-captions' }
                                          -> { transcript }
        │
content/index.ts call site (single site, ~line 299), discriminated result:
  • { transcript }         -> set content.transcriptWordCount;
                              content.content += `\n\n## Transcript\n\n${transcript}`
  • { status:'no-captions'}-> content.content += `\n\n*(Video present; captions unavailable.)*`
  • null                   -> nothing (non-X, GIF, or no video)
```

`fetchEmbeddedVideoTranscript`'s return type changes from `string | null` to a
discriminated `EmbeddedVideoResult = { transcript: string } | { status:
'no-captions' } | null`. Existing branches keep returning transcript-or-null (mapped
into the union); only the X branch ever returns `{ status: 'no-captions' }`, so other
providers' behavior is unchanged.

## Components / files

### New

- **`src/lib/twitter-video.ts`** — background-side orchestrator + pure helpers (no
  DOM; safe to import in the service worker):
  - `deriveSyndicationToken(id: string): string`
  - `pickVideoM3u8(json: unknown): string | null` — first `type === 'video'` media's
    `application/x-mpegURL` variant.
  - `resolveTwimgUrl(pathOrUrl: string): string`
  - `fetchTwitterVideoTranscript(tweetId, langPrefs?, summaryLang?): Promise<TwitterCaptionResult>`
    where `TwitterCaptionResult = { transcript: string } | { status: 'no-captions' } | { status: 'no-video' }`.

### Changed

- **`src/lib/extractors/twitter.ts`** — add exported
  `detectTweetVideo(doc: Document, url: string): string | null`, reusing the file's
  existing helpers (`<video>`+poster, `isInsideQuotedTweet`, `pickMostVisibleArticle`,
  `findMainArticle`, `extractArticlePermalink`, `TWITTER_STATUS_RE`). Returns the tweet
  ID iff the focal (direct) / most-visible (feed) tweet has its **own, non-quoted**
  video and a real ID resolves.
- **`src/lib/transcript-lang.ts`** — move `parseHlsSubtitleTracks` here from
  `cloudflare-stream.ts`; add HTML-entity decoding to `parseVtt`/`parseSrt`.
- **`src/lib/cloudflare-stream.ts`** — import `parseHlsSubtitleTracks` from
  `./transcript-lang`; delete the local copy.
- **`src/entrypoints/content/index.ts`** — add the X branch to
  `fetchEmbeddedVideoTranscript`; change its return type to `EmbeddedVideoResult` and
  update the single call site (~line 299); add a small `sendMessage` helper for
  `FETCH_TWITTER_CAPTIONS`.
- **`src/entrypoints/background/index.ts`** — add the `FETCH_TWITTER_CAPTIONS`
  handler calling `fetchTwitterVideoTranscript`.
- **`src/lib/messaging/types.ts`** — add `FETCH_TWITTER_CAPTIONS` /
  `FETCH_TWITTER_CAPTIONS_RESULT` to the `MessageType` union **and** the `Message`
  union, with their interfaces.

No manifest change — `host_permissions` is already `<all_urls>`. No `App.tsx` change.

## Detection details

- **Reuse proven signals.** `detectTweetVideo` finds a tweet's own video the same way
  the extractor already does: a `<video>` whose `poster` is on `pbs.twimg.com`, that
  is **not** inside a quoted tweet (`isInsideQuotedTweet`). It picks the focal article
  via `findMainArticle` (direct tweet, by URL author) or `pickMostVisibleArticle`
  (feed), and resolves the ID from `TWITTER_STATUS_RE` (direct) or
  `extractArticlePermalink` (feed) — returning null when no real ID resolves (e.g.
  `/home`). No new/unverified DOM test IDs.
- **GIF handling is authoritative, not DOM-guessed.** X renders animated GIFs as
  `<video>` too, so `detectTweetVideo` may return an ID for a GIF. The background then
  reads `mediaDetails[].type`; a GIF/photo yields `pickVideoM3u8 === null` →
  `{ status: 'no-video' }` → **no note**. One wasted syndication call per GIF tweet,
  never a user-visible artifact.

## VTT parsing & format

Reuse the shared `parseVtt` → `[H:MM:SS] text`, consistent with every other provider.
Add HTML-entity decoding to the shared helper (fixes a pre-existing gap for all
consumers). No dedup/overlap-merge: X VOD VTTs are a single, non-rolling `.vtt`
segment (validated). **Known risk:** if a rolling X VTT appears, add overlap-aware
joining in the shared helper.

## Error handling & edge cases

- **No own video / GIF-only / quoted-only / unresolved ID** → `detectTweetVideo`
  returns null (or background returns `no-video`); nothing changes, no note.
- **No SUBTITLES track / private or age-gated (syndication failure) / any network
  failure** → `{ status: 'no-captions' }` → note; poster retained.
- **Timeouts** → one `AbortController` per request bounding connect **and** body read
  (`fetchTextBounded`), ~15 s.
- **Message-channel failure** → content maps to null → no note.
- **Multiple videos** → X allows one video per tweet; `pickVideoM3u8` uses the first.

## Naming conventions

Standardize on `twitter` (matches the extractor file/type and sibling video modules):
`src/lib/twitter-video.ts`, `detectTweetVideo`, `fetchTwitterVideoTranscript`,
`FETCH_TWITTER_CAPTIONS`.

## Verification (matches how the other video providers were verified)

YouTube, Netflix, Cloudflare Stream, Vimeo, Dailymotion, and JW Player have no
diagnostic/verification scripts — they are verified via `pnpm wxt build` (tsc
typecheck) + in-extension manual testing. X captions follow the same pattern (the live
data source was already validated end-to-end during design):

- `pnpm wxt build` — typecheck/compile gate for every task.
- DevTools: validate `detectTweetVideo`'s DOM heuristic on live tweets before wiring.
- In-extension: reload → confirm captioned video (direct **and** feed) → transcript
  folded in with `transcriptWordCount` shown; caption-less video → the note, poster
  retained; **GIF tweet → no note**; quoted-video tweet whose own body has no video →
  no note; text-only tweet → unaffected.

## Risks

- **Undocumented syndication endpoint / token algorithm** could change. Mitigation:
  every failure degrades to the no-captions note; a future logged-in-session fallback
  (MAIN-world bridge) can be added behind the same detector without rework.
- **No private/age-gated video support** — accepted for MVP; those hit the note.
- **Rolling-VTT assumption** — see VTT section; revisit only if observed.
