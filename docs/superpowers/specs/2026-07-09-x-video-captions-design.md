# X (Twitter) Video Caption Support — Design

**Date:** 2026-07-09
**Status:** Approved (pending implementation plan)
**Feature:** Include the spoken content of a tweet's video in xTil summaries, sourced
from X's closed-caption (CC) track.

## Goal

When a tweet contains a video, feed the video's **closed captions** (the subtitle
track X ships with captioned videos) into the summarization pipeline as a transcript,
so the summary reflects what is *said* in the video — not just the tweet text and a
static poster thumbnail.

Explicitly **not** in scope:
- Audio transcription / speech-to-text (we use X's existing CC track only).
- Visual/frame analysis of the video.
- Quoted-tweet videos.

## Decisions (from brainstorming)

| Question | Decision |
| --- | --- |
| What to extract from a video | Spoken content, via X's **closed captions** (not audio transcription). |
| Behavior when a video has **no** CC track | Keep current behavior — include the poster thumbnail — and add a note: `*(Video present; no captions available.)*` |
| Surfaces covered | Direct tweet pages (`/status/<id>`) **and** feed (home/profile/search). |
| Sourcing approach | Public **syndication CDN** endpoint, resolved in the background worker, wrapped in the existing YouTube/Netflix-style transcript-marker pattern. |

## Feasibility (validated end-to-end against tweet `2075240393419936189`)

The full chain works with **no auth and no MAIN-world bridge**:

1. `GET https://cdn.syndication.twimg.com/tweet-result?id=<id>&lang=en&token=<derived>`
   → tweet JSON with `mediaDetails[].video_info.variants[]`, including the HLS master
   `.m3u8` URL (`content_type: application/x-mpegURL`).
2. `GET` the master `.m3u8` → contains `#EXT-X-MEDIA:TYPE=SUBTITLES,...,URI="..."`
   when captions exist (validated: auto-generated `en-gb` track).
3. `GET` the subtitle playlist `.m3u8` → `.vtt` segment path(s).
4. `GET` the `.vtt` → WebVTT with real spoken text wrapped in `<X-word-ms ...>` tags.

The token is derived from the tweet ID (react-tweet algorithm):
`((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '')`.
For `2075240393419936189` this yields `513k5q5yoew`, which returns HTTP 200.

### CORS reality (decides where fetches run)

Observed `Access-Control-Allow-Origin` values:

| Resource | ACAO | Fetchable from x.com content script? |
| --- | --- | --- |
| syndication `tweet-result` | `https://platform.twitter.com` | **No** |
| master / subtitle `.m3u8` | `https://x.com` | Yes |
| `.vtt` | `*` | Yes |

Because the syndication endpoint excludes `x.com`, the whole chain runs in the
**background service worker**, which has `<all_urls>` host permission and bypasses
CORS. This is the only deviation from the YouTube path (which resolves inline); the
overall marker → resolve → transcript-section pattern is unchanged.

## Data flow

```
twitter.ts (content script, synchronous DOM parse)
  Detects a video in the main tweet (direct) / target article (feed).
  Appends a section:
      ## Video Transcript

      [Transcript available - fetching...]

      [TWITTER_TRANSCRIPT:<tweetId>]
        │
content/index.ts (marker-resolution step, beside YOUTUBE_/NETFLIX_ blocks)
  Sees [TWITTER_TRANSCRIPT:<id>] → chrome.runtime.sendMessage(FETCH_X_VIDEO_CC)
        │
background/index.ts → FETCH_X_VIDEO_CC handler
  1. token = deriveSyndicationToken(id)
  2. GET syndication tweet-result → pickVideoM3u8() → master m3u8 URL
  3. GET master m3u8 → parseMasterPlaylist() → selectSubtitleTrack(langPrefs, summaryLang)
  4. GET subtitle playlist → parseSubtitlePlaylist() → vtt path(s)
  5. GET vtt(s) → parseVtt() → clean transcript text
  returns { transcript: string } | { transcript: null, reason: string }
        │
content/index.ts replaces the placeholder + marker with:
  • transcript text                                   (CC found)
  • *(Video present; no captions available.)*         (no CC / private / fetch error)
  Poster thumbnail remains in richImages / thumbnailUrl in all cases.
```

## Components / files

### New

- **`src/lib/twitter/captions.ts`** — pure, network-free functions (independently
  verifiable):
  - `deriveSyndicationToken(id: string): string`
  - `pickVideoM3u8(syndicationJson: unknown): string | null` — first
    `mediaDetails` video's `application/x-mpegURL` variant.
  - `parseMasterPlaylist(text: string): SubtitleTrack[]` — parse
    `#EXT-X-MEDIA:TYPE=SUBTITLES` lines (`LANGUAGE`, `NAME`, `URI`, `DEFAULT`).
  - `selectSubtitleTrack(tracks, langPrefs, summaryLang): SubtitleTrack | null` —
    prefer language match, then `DEFAULT=YES`, then first.
  - `parseSubtitlePlaylist(text: string): string[]` — `.vtt` segment paths.
  - `parseVtt(text: string): string` — clean transcript (see VTT parsing below).
  - `resolveTwimgUrl(base: string, relative: string): string` — resolve relative
    playlist/segment URIs against `https://video.twimg.com`.

- **`scripts/verify-x-captions.mjs`** — CLI that runs the full chain for a tweet ID
  and prints the resolved transcript. Manual verification aid (no test framework
  added — repo has none).

### Changed

- **`src/lib/extractors/twitter.ts`** — in both `extractDirectTweet` and
  `extractFeedTweet`, detect a video in the main/target article (a non-quoted
  `<video>` element), determine the tweet ID (direct: from URL; feed: from the
  article permalink), and append the `## Video Transcript` marker section. Existing
  poster/thumbnail handling is unchanged.
- **`src/entrypoints/background/index.ts`** — add the `FETCH_X_VIDEO_CC` message
  handler orchestrating the fetch chain via `captions.ts`. Each fetch uses an
  `AbortController` (~15 s timeout), consistent with `images/fetcher.ts`.
- **`src/entrypoints/content/index.ts`** — add a `[TWITTER_TRANSCRIPT:` resolution
  block next to the existing YouTube/Netflix blocks; call the background handler and
  substitute the result (or the no-CC note).
- **`src/lib/messaging/types.ts`** — add the `FETCH_X_VIDEO_CC` request/response
  message shapes.

No manifest change — `host_permissions` is already `<all_urls>`.

## VTT parsing

Sample cue from the validated tweet:

```
00:00:00.000 --> 00:00:03.799
<X-word-ms ms=200,300,... index=1 character_ranges=0-5,...>Hello, hello, hello. Yes sorry for being a bit late there's</X-word-ms>
```

`parseVtt`:
1. Drop the `WEBVTT` header, `NOTE` blocks, blank lines, numeric cue-index lines,
   and cue-timing lines (`... --> ...`).
2. Strip **all** `<...>` tags (removes `X-word-ms` wrappers and any `<c>`/`<i>`
   styling), leaving the text content.
3. Decode HTML entities (`&amp;`, `&#39;`, etc.).
4. Trim each line; **dedupe consecutive identical lines** (X rolling captions can
   repeat a line across cues).
5. Join into flowing paragraph text.

Expected output prefix for the sample: *"Hello, hello, hello. Yes sorry for being a
bit late there's a lot of traffic but um hello welcome to AI engineers world
fair…"*

## Track & language selection

`parseMasterPlaylist` yields all subtitle tracks. `selectSubtitleTrack` prefers a
`LANGUAGE` matching `summaryLang`/`langPrefs`, then `DEFAULT=YES`, then the first
track. Auto-generated tracks are accepted (the common case).

## Error handling & edge cases

- **No video in tweet** → no marker emitted; nothing changes.
- **No `video_info` / no SUBTITLES track / private or age-gated (syndication
  403/404)** → handler returns `{ transcript: null, reason }`; content script writes
  the no-CC note; poster kept.
- **Token/endpoint drift or any network failure** → same graceful note; never a hard
  error in the summary.
- **Fetch timeouts** → per-request `AbortController` (~15 s).
- **Quoted-tweet video** → out of scope (main tweet's `mediaDetails` only).
- **Multiple videos** → X allows one video per tweet; use the first.

## Verification (matches repo's no-test-runner style)

- `node scripts/verify-x-captions.mjs <tweetId>` prints the resolved transcript
  (works live against real IDs; the design was validated against
  `2075240393419936189`).
- In-extension: `pnpm wxt build` → reload the extension → open the example tweet
  (has CC) and a caption-less video tweet → confirm the transcript appears in the
  first and the graceful note in the second → confirm a text-only tweet is
  unaffected. Test both a direct `/status/` page and a feed.

## Naming conventions

- Marker: `[TWITTER_TRANSCRIPT:<tweetId>]` — consistent with `[YOUTUBE_TRANSCRIPT:…]`
  and `[NETFLIX_TRANSCRIPT:…]`.
- Section heading: `## Video Transcript` — distinguishes it from the tweet's own body
  text (a tweet, unlike a YouTube page, already has prose content).

## Risks

- **Undocumented syndication endpoint / token algorithm** could change. Mitigation:
  all failures degrade to the no-CC note; a future fallback (MAIN-world bridge using
  the logged-in session, "Approach B/C") can be added without reworking the pattern.
- **No private/age-gated/login-only video support** — accepted for MVP; those hit the
  graceful fallback.
