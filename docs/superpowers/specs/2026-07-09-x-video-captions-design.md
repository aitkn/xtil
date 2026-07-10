# X (Twitter) Video Caption Support — Design

**Date:** 2026-07-09
**Status:** Approved design, revised after code review (pending implementation plan)
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
- Quoted-tweet videos.
- Private / age-gated / login-only videos (they degrade to the no-captions fallback).

## Decisions (from brainstorming)

| Question | Decision |
| --- | --- |
| What to extract from a video | Spoken content, via X's **closed captions** (not audio transcription). |
| Behavior when a video has **no** CC track | Keep current behavior — the poster thumbnail is already emitted as an image by the extractor — and add a note: `*(Video present; captions unavailable.)*` |
| Surfaces covered | Direct tweet pages (`/status/<id>`) **and** feed (home/profile/search). |
| Sourcing approach | Public **syndication CDN** endpoint, wrapped in the **existing** `fetchEmbeddedVideoTranscript` framework (the same one used by Cloudflare Stream, Vimeo, Dailymotion, JW Player, HTML5). |

## Architecture: extend the existing framework (revised after review)

The codebase already has a per-provider embedded-video transcript framework for
exactly this shape of problem — a page that is not a dedicated video type but embeds
a video with captions. It lives in `fetchEmbeddedVideoTranscript`
(`content/index.ts:345`) and dispatches to sibling modules in `src/lib/`
(`cloudflare-stream.ts`, `vimeo.ts`, `dailymotion.ts`, `jwplayer.ts`,
`html5-video.ts`). It **already runs for tweets**: the guard at `content/index.ts:298`
is `content.type !== 'youtube' && content.type !== 'netflix'`, and tweets are
type `'twitter'`. It simply has no X detector today.

`cloudflare-stream.ts` in particular performs the **identical** master-m3u8 →
subtitle-playlist → VTT chain we need (`fetchCloudflareStreamTranscript`, steps 1–6),
inline from the content script — no MAIN-world bridge, no background worker, no
transcript marker.

**Therefore the original marker-based design is dropped.** No
`[TWITTER_TRANSCRIPT:]` marker, no new resolution block in `content/index.ts`, no
`twitter.ts` extractor change, no `App.tsx` change. We add one detector/fetcher pair
to the existing chain and reuse the shared parsers.

### Reused vs. genuinely new

| Concern | Reused (already exists) | New |
| --- | --- | --- |
| Parse `#EXT-X-MEDIA:TYPE=SUBTITLES` | `parseHlsSubtitleTracks` (moving to `transcript-lang.ts`) | — |
| Pick subtitle playlist line | first non-`#` line (as in `cloudflare-stream.ts:56`) | — |
| Language/track selection | `pickBestTrack` (`transcript-lang.ts:58`) | — |
| Parse WebVTT → `[H:MM:SS] text` | `parseVtt` (`transcript-lang.ts:136`) | — |
| UI word-count wiring | `content.transcriptWordCount` + `App.tsx:2781` | — |
| Poster fallback on no-CC | extractor already emits video posters as images (`twitter.ts:461`) | — |
| Derive syndication token | — | `deriveSyndicationToken` |
| Dig m3u8 out of syndication JSON | — | `pickVideoM3u8` |
| Resolve relative twimg URLs | — | `resolveTwimgUrl` |
| Fetch CORS-blocked syndication JSON | — | small background message |

## Feasibility (validated end-to-end against tweet `2075240393419936189`)

The full chain works with **no auth and no MAIN-world bridge**:

1. `GET https://cdn.syndication.twimg.com/tweet-result?id=<id>&lang=en&token=<derived>`
   → tweet JSON with `mediaDetails[].video_info.variants[]`, including the HLS master
   `.m3u8` URL (`content_type: application/x-mpegURL`).
2. `GET` the master `.m3u8` → contains `#EXT-X-MEDIA:TYPE=SUBTITLES,...,URI="..."`
   when captions exist (validated: auto-generated `en-gb` track).
3. `GET` the subtitle playlist `.m3u8` → **a single** `.vtt` segment path covering the
   whole video (validated: one segment, `EXTINF:9731.11`).
4. `GET` the `.vtt` → WebVTT with real spoken text wrapped in `<X-word-ms ...>` tags
   (stripped by the shared `parseVtt`).

Token derivation (react-tweet algorithm):
`((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '')`.
For `2075240393419936189` → `513k5q5yoew` → HTTP 200. Token precision loss from
`Number()` on 19-digit IDs is inherent to react-tweet and accepted.

### CORS reality (why only step 1 needs the background worker)

Observed `Access-Control-Allow-Origin` values:

| Resource | ACAO | Fetchable from x.com content script? |
| --- | --- | --- |
| syndication `tweet-result` | `https://platform.twitter.com` | **No** — needs background |
| master / subtitle `.m3u8` | `https://x.com` | Yes (inline) |
| `.vtt` | `*` | Yes (inline) |

Only the syndication fetch is CORS-blocked from the content script, so **only that
step** is delegated to a narrow background message (`FETCH_TWITTER_SYNDICATION`); the
`.m3u8` and `.vtt` are fetched inline exactly like `cloudflare-stream.ts` does today.
The background worker has `<all_urls>` host permission (no manifest change).

## Data flow

```
content/index.ts : fetchEmbeddedVideoTranscript(doc, url, langPrefs, summaryLang)
  ... existing branches (CF Stream, Vimeo, Dailymotion, JW, HTML5) ...
  NEW branch:
    tweetId = detectTwitterVideo(url, doc)      // null for GIFs / no real video / no id
    if (tweetId):
       result = await fetchTwitterVideoTranscript(tweetId, langPrefs, summaryLang)
       -> { transcript } | { status: 'no-captions' }
        │
fetchTwitterVideoTranscript (src/lib/twitter-video.ts):
  1. sendMessage FETCH_TWITTER_SYNDICATION { tweetId }   // background, CORS-blocked step
        background: token = deriveSyndicationToken(id)
                    GET syndication tweet-result
                    return pickVideoM3u8(json)  ->  { m3u8Url | null }
  2. if no m3u8Url  -> { status: 'no-captions' }
  3. GET master m3u8 (inline)  -> parseHlsSubtitleTracks -> pickBestTrack
        if no tracks -> { status: 'no-captions' }
  4. GET subtitle playlist (inline) -> first non-# line -> resolveTwimgUrl
  5. GET vtt (inline) -> parseVtt  -> { transcript }
        │
content/index.ts call site (single site, ~line 299), discriminated result:
  • { transcript }        -> set content.transcriptWordCount;
                             content.content += `\n\n## Transcript\n\n${transcript}`
  • { status:'no-captions'} -> content.content += `\n\n*(Video present; captions unavailable.)*`
  • null                  -> nothing (non-X or no video)
```

`fetchEmbeddedVideoTranscript`'s return type changes from `string | null` to a
discriminated `EmbeddedVideoResult = { transcript: string } | { status:
'no-captions' } | null`. Existing branches keep returning
transcript-or-null (mapped into the union); only the X branch ever returns
`{ status: 'no-captions' }`, so other providers' behavior is unchanged.

## Components / files

### New

- **`src/lib/twitter-video.ts`** (sibling to `cloudflare-stream.ts` et al.):
  - `detectTwitterVideo(url: string, doc: Document): string | null` — returns the
    tweet ID iff the focal tweet contains a real video player. Uses `findVideoRoot`
    (`content/index.ts:320`) to locate the visible tweet's article; requires
    `[data-testid="videoPlayer"]` (or `videoComponent`) and **excludes**
    `[data-testid="tweetGif"]`; resolves the tweet ID from the URL (`/status/<id>`)
    or the article permalink, returning null when no real ID resolves (e.g. `/home`).
  - `fetchTwitterVideoTranscript(tweetId, langPrefs?, summaryLang?): Promise<{ transcript: string } | { status: 'no-captions' }>` — orchestrates the chain above.
  - `deriveSyndicationToken(id: string): string`
  - `pickVideoM3u8(syndicationJson: unknown): string | null` — first `mediaDetails`
    video's `application/x-mpegURL` variant.
  - `resolveTwimgUrl(relative: string): string` — resolve `/amplify_video/...` paths
    against `https://video.twimg.com`.

- **`scripts/verify-x-captions.mjs`** — CLI that runs the full chain for a tweet ID
  and prints the resolved transcript. Manual verification aid (repo has no test
  runner).

### Changed

- **`src/lib/transcript-lang.ts`**:
  - Move `parseHlsSubtitleTracks` here from `cloudflare-stream.ts` (now shared by
    two consumers); update `cloudflare-stream.ts` to import it.
  - Add HTML-entity decoding to `parseVtt` (`&amp;`, `&#39;`, etc.) — benefits all
    consumers (YouTube/Vimeo/Dailymotion/CF/X), fixing a pre-existing gap.
- **`src/entrypoints/content/index.ts`**:
  - Add the X branch to `fetchEmbeddedVideoTranscript`.
  - Change its return type to `EmbeddedVideoResult` and update the single call site
    (~line 299) to handle `{ transcript }`, `{ status: 'no-captions' }`, and `null`.
- **`src/entrypoints/background/index.ts`** — add the `FETCH_TWITTER_SYNDICATION`
  handler: derive token, fetch syndication JSON, return `pickVideoM3u8` result.
  Fetch wrapped in an `AbortController` (~15 s), consistent with `images/fetcher.ts`.
- **`src/lib/messaging/types.ts`** — add `FETCH_TWITTER_SYNDICATION` /
  `FETCH_TWITTER_SYNDICATION_RESULT` to the `MessageType` union (line 6) **and** the
  corresponding interfaces to the `Message` union (line 309).

No manifest change — `host_permissions` is already `<all_urls>`. No `twitter.ts`
extractor change and no `App.tsx` change.

## Detection details

- **GIF exclusion:** X serves animated GIFs as muted looping `<video>` elements, and
  `extractArticleMedia` (`twitter.ts:486`) already treats them as media. Detection
  therefore must target the real video-player container
  (`[data-testid="videoPlayer"]` / `videoComponent`) and exclude
  `[data-testid="tweetGif"]`, or every GIF tweet would fetch, find no captions, and
  print the note.
- **Tweet-ID reliability:** `extractArticlePermalink` (`twitter.ts:294`) falls back
  to the page URL when no `/status/` link exists (e.g. `/home`). `detectTwitterVideo`
  returns null unless a real numeric tweet ID resolves, so we never fetch with a
  bogus ID.

## VTT parsing & format

- Reuse the shared `parseVtt` → output is `[H:MM:SS] text`, **consistent with every
  other transcript in the app** (and timestamps are useful for chat refinement).
- The shared `parseVtt` strips all `<...>` tags (handles `<X-word-ms>`); we add HTML
  entity decoding to it.
- **Dedup / rolling captions:** the shared `parseVtt` does no dedup, and X's
  segmented VTT for a VOD is a **single** `.vtt` file with clean, non-overlapping
  sequential cues (validated). Rolling/overlapping cues are a live-caption
  phenomenon not observed here, so we reuse `parseVtt` as-is (no overlap-merge —
  YAGNI). **Known risk:** if a rolling X VTT is found in the wild, add overlap-aware
  joining in the shared helper.

## Track & language selection

Reuse `pickBestTrack`. X ships a single auto-generated caption track in the spoken
language (no translations), so selection almost always falls through to the first
track — `pickBestTrack` already handles this. No extra logic.

## Error handling & edge cases

- **No video / GIF / unresolved tweet ID** → `detectTwitterVideo` returns null;
  nothing changes.
- **No `video_info` / no SUBTITLES track / private or age-gated (syndication
  403/404) / any network failure** → `{ status: 'no-captions' }` → the note is
  appended; poster is retained (already emitted by the extractor).
- **Fetch timeouts** → `AbortController` (~15 s) on each request.
- **Multiple videos** → X allows one video per tweet; use the first.
- **Per-extraction cost** → one extra background round trip + up to three inline
  fetches when a video tweet is opened. Acceptable; caching can be added later if
  needed.

## Naming conventions

Standardize on `twitter` (matches the extractor file/type and the sibling video
modules): `src/lib/twitter-video.ts`, `detectTwitterVideo`,
`fetchTwitterVideoTranscript`, `FETCH_TWITTER_SYNDICATION`. No `X_`/`CC` mixing.

## Verification (matches repo's no-test-runner style)

- `node scripts/verify-x-captions.mjs <tweetId>` prints the resolved transcript
  (validated against `2075240393419936189`).
- In-extension: `pnpm wxt build` → reload → confirm:
  - captioned video tweet (direct `/status/` **and** in feed) → transcript folded in,
    `transcriptWordCount` reflected in the UI indicators;
  - caption-less video tweet → the graceful note, poster retained;
  - **GIF tweet → no note, no fetch** (regression guard);
  - text-only tweet → unaffected.

## Risks

- **Undocumented syndication endpoint / token algorithm** could change. Mitigation:
  every failure degrades to the no-captions note; a future fallback (MAIN-world
  bridge using the logged-in session) can be added behind the same detector without
  reworking anything.
- **No private/age-gated video support** — accepted for MVP; those hit the graceful
  fallback.
- **Rolling-VTT assumption** — see VTT section; revisit only if observed.
