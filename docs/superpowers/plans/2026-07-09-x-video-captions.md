# X (Twitter) Video Caption Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a tweet contains a captioned video, fold its closed-caption transcript into the xTil summary; if the video has no captions, add a brief note and keep today's poster-thumbnail behavior; animated GIFs produce nothing.

**Architecture:** Extend the existing embedded-video transcript framework (`fetchEmbeddedVideoTranscript` in `src/entrypoints/content/index.ts`, which already runs for tweets). Detection reuses the proven helpers already in `src/lib/extractors/twitter.ts` (`<video>`+`pbs.twimg.com` poster, `isInsideQuotedTweet`, `pickMostVisibleArticle`, `findMainArticle`, `extractArticlePermalink`). Because syndication/`.m3u8` CORS blocks content-script fetches, the **entire fetch chain runs in the background service worker** (host permission `<all_urls>` bypasses CORS): tweet ID → syndication `tweet-result` → HLS master `.m3u8` → subtitle playlist → `.vtt` → text, reusing the shared `parseHlsSubtitleTracks`/`pickBestTrack`/`parseVtt`. Video-vs-GIF is decided authoritatively by the syndication `mediaDetails[].type` field, not the DOM.

**Tech Stack:** WXT 0.20.x, Preact, TypeScript (strict), pnpm. Chrome MV3 (service-worker background + content script). No unit-test runner in the repo — like every other video provider (YouTube, Netflix, Cloudflare, Vimeo, Dailymotion, JW), this feature is verified via `pnpm wxt build` (tsc typecheck gate) + in-extension manual testing. No diagnostic scripts.

## Global Constraints

- **Chrome APIs via `globalThis` cast, raw callback style** — never WXT's `browser` polyfill. Background handlers use `sendResponse` + `return true` (already wired). Content senders use the raw callback form of `chrome.runtime.sendMessage`.
- **No manifest change** — `host_permissions` is already `['<all_urls>']`; background `fetch` to `cdn.syndication.twimg.com` and `video.twimg.com` bypasses CORS. (Content-script fetches would be CORS-blocked — that is why the chain lives in the background.)
- **Path alias** `@/*` → `src/*` (entrypoints). Library modules under `src/lib/` import each other with **relative, extensionless** specifiers.
- **After any code change**: `pnpm wxt build` must succeed, then reload the unpacked extension from `.output/chrome-mv3/` before manual testing.
- **No new dependencies, no test framework, no diagnostic scripts** — match the existing video providers exactly.
- **Naming**: use `twitter` (not `X`/`CC`).
- **Token algorithm (verbatim):** `((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '')`. For `id = "2075240393419936189"` this equals `"513k5q5yoew"` (validated live during design).
- **Video/GIF classification is authoritative from syndication**: `mediaDetails[].type` is `video` / `animated_gif` / `photo`; only `video` has captions. Never rely on DOM test IDs for this.

---

### Task 1: Share `parseHlsSubtitleTracks` and add entity decoding to `parseVtt`

Move the generic HLS subtitle parser into the shared module (about to gain a second consumer) and fix the pre-existing HTML-entity gap in `parseVtt` (benefits YouTube/Vimeo/Dailymotion/CF/X).

**Files:**
- Modify: `src/lib/transcript-lang.ts`
- Modify: `src/lib/cloudflare-stream.ts:10,68-88`

**Interfaces:**
- Produces: `export function parseHlsSubtitleTracks(manifest: string): CaptionTrack[]` from `transcript-lang.ts`.

- [ ] **Step 1: Add `parseHlsSubtitleTracks` + entity decoding to `transcript-lang.ts`**

Append `parseHlsSubtitleTracks` (identical logic to the current `cloudflare-stream.ts` version) to `src/lib/transcript-lang.ts`:

```ts
/**
 * Parse #EXT-X-MEDIA:TYPE=SUBTITLES entries from an HLS master manifest.
 * Shared by Cloudflare Stream and X/Twitter video.
 */
export function parseHlsSubtitleTracks(manifest: string): CaptionTrack[] {
  const tracks: CaptionTrack[] = [];
  for (const line of manifest.split('\n')) {
    if (!line.includes('TYPE=SUBTITLES')) continue;
    const lang = line.match(/LANGUAGE="([^"]+)"/)?.[1];
    const name = line.match(/NAME="([^"]+)"/)?.[1];
    const uri = line.match(/URI="([^"]+)"/)?.[1];
    const isForced = line.includes('FORCED=YES');
    if (!lang || !uri || isForced) continue;
    tracks.push({
      baseUrl: uri,
      languageCode: lang,
      name: name ? { simpleText: name } : undefined,
    });
  }
  return tracks;
}
```

Add a `decodeEntities` helper above `parseVtt` (single pass — never re-scans its own output, so no double-decoding; unknown entities are left intact):

```ts
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

/** Decode the HTML entities commonly seen in caption text (single pass — no double-decode). */
function decodeEntities(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named !== undefined ? named : m;
  });
}
```

In `parseVtt`, change the text line (`transcript-lang.ts:151`) from:

```ts
      const text = textParts.join(' ').replace(/<[^>]+>/g, '').trim();
```

to:

```ts
      const text = decodeEntities(textParts.join(' ').replace(/<[^>]+>/g, '')).trim();
```

Apply the same change in `parseSrt` (`transcript-lang.ts:181`).

- [ ] **Step 2: Point `cloudflare-stream.ts` at the shared parser**

Change the import on `cloudflare-stream.ts:10` from:

```ts
import { pickBestTrack, parseVtt, type CaptionTrack } from './transcript-lang';
```

to (drop `CaptionTrack` — after the move it is no longer referenced in this file — and add `parseHlsSubtitleTracks`):

```ts
import { pickBestTrack, parseVtt, parseHlsSubtitleTracks } from './transcript-lang';
```

Delete the local `parseHlsSubtitleTracks` function and its doc comment (`cloudflare-stream.ts:68-88`). Leave the call site (`cloudflare-stream.ts:44`) unchanged.

- [ ] **Step 3: Verify the build passes**

Run: `pnpm wxt build`
Expected: build completes with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/transcript-lang.ts src/lib/cloudflare-stream.ts
git commit -m "refactor: share parseHlsSubtitleTracks and add entity decoding to parseVtt"
```

---

### Task 2: `twitter-video.ts` background orchestrator + pure helpers

DOM-free module (safe to import in the service worker). Resolves a tweet ID to a transcript, with bounded fetches and syndication-based video/GIF classification.

**Files:**
- Create: `src/lib/twitter-video.ts`

**Interfaces:**
- Consumes: `parseHlsSubtitleTracks`, `pickBestTrack`, `parseVtt` from `./transcript-lang` (Task 1).
- Produces:
  - `type TwitterCaptionResult = { transcript: string } | { status: 'no-captions' } | { status: 'no-video' }`
  - `deriveSyndicationToken(id: string): string`
  - `pickVideoM3u8(json: unknown): string | null`
  - `resolveTwimgUrl(pathOrUrl: string): string`
  - `fetchTwitterVideoTranscript(tweetId: string, langPrefs?: string[], summaryLang?: string): Promise<TwitterCaptionResult>`

- [ ] **Step 1: Write the module**

```ts
// src/lib/twitter-video.ts
import { parseHlsSubtitleTracks, pickBestTrack, parseVtt } from './transcript-lang';

const SYNDICATION_ORIGIN = 'https://cdn.syndication.twimg.com';
const VIDEO_ORIGIN = 'https://video.twimg.com';
const FETCH_TIMEOUT_MS = 15_000;

export type TwitterCaptionResult =
  | { transcript: string }
  | { status: 'no-captions' }
  | { status: 'no-video' };

/** react-tweet syndication token derivation (see plan Global Constraints). */
export function deriveSyndicationToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

/** Resolve an absolute-path or full URL against video.twimg.com. */
export function resolveTwimgUrl(pathOrUrl: string): string {
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  return `${VIDEO_ORIGIN}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}

/** First real-video (type === 'video') HLS variant from a syndication payload. */
export function pickVideoM3u8(json: unknown): string | null {
  const media = (json as { mediaDetails?: unknown })?.mediaDetails;
  if (!Array.isArray(media)) return null;
  for (const m of media) {
    if (m?.type !== 'video') continue; // 'animated_gif' / 'photo' are not captioned videos
    const variants = m?.video_info?.variants;
    if (!Array.isArray(variants)) continue;
    const hls = variants.find(
      (v: { content_type?: string; url?: string }) =>
        v?.content_type === 'application/x-mpegURL' && typeof v?.url === 'string',
    );
    if (hls) return hls.url as string;
  }
  return null;
}

/** fetch + read body, both bounded by a single AbortController timeout. */
async function fetchTextBounded(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.text(); // still inside the timeout window
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonBounded(url: string): Promise<unknown | null> {
  const text = await fetchTextBounded(url);
  if (text == null) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * Background-side orchestrator: tweet ID -> transcript. Runs in the service worker;
 * host_permissions bypasses CORS for every hop.
 */
export async function fetchTwitterVideoTranscript(
  tweetId: string,
  langPrefs?: string[],
  summaryLang?: string,
): Promise<TwitterCaptionResult> {
  const token = deriveSyndicationToken(tweetId);
  const json = await fetchJsonBounded(
    `${SYNDICATION_ORIGIN}/tweet-result?id=${tweetId}&lang=en&token=${token}`,
  );
  // Syndication failure (network / private / age-gated): treat as a video we can't read.
  if (json == null) return { status: 'no-captions' };

  const m3u8Url = pickVideoM3u8(json);
  if (!m3u8Url) return { status: 'no-video' }; // GIF / photo / no video -> no note

  const master = await fetchTextBounded(m3u8Url);
  if (master == null) return { status: 'no-captions' };

  const tracks = parseHlsSubtitleTracks(master);
  if (tracks.length === 0) return { status: 'no-captions' };

  const best = pickBestTrack(tracks, langPrefs, summaryLang);
  const playlist = await fetchTextBounded(resolveTwimgUrl(best.baseUrl));
  if (playlist == null) return { status: 'no-captions' };

  const vttRel = playlist.split('\n').find((l) => l.trim() && !l.startsWith('#'));
  if (!vttRel) return { status: 'no-captions' };

  const vtt = await fetchTextBounded(resolveTwimgUrl(vttRel.trim()));
  if (vtt == null) return { status: 'no-captions' };

  const transcript = parseVtt(vtt);
  if (!transcript.trim()) return { status: 'no-captions' };
  return { transcript };
}
```

- [ ] **Step 2: Verify the build passes**

Run: `pnpm wxt build`
Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/twitter-video.ts
git commit -m "feat: add twitter-video background orchestrator (syndication -> captions)"
```

---

### Task 3: `detectTweetVideo` in `twitter.ts` (reuse proven helpers) + DevTools validation

Adds detection to the extractor, reusing its existing media/visibility/permalink/quoted-tweet helpers. Validated live in DevTools **before** it is wired in, so a wrong assumption surfaces here, not at the end.

**Files:**
- Modify: `src/lib/extractors/twitter.ts` (add exported `detectTweetVideo` + helper `articleHasOwnVideo`)

**Interfaces:**
- Consumes (all already in `twitter.ts`): `TWITTER_STATUS_RE`, `findMainArticle`, `pickMostVisibleArticle`, `extractArticlePermalink`, `isInsideQuotedTweet`.
- Produces: `export function detectTweetVideo(doc: Document, url: string): string | null`.

- [ ] **Step 1: Add the detector**

Add after the `twitterExtractor` export block (function declarations are hoisted, so the helpers it calls may be defined later in the file):

```ts
/**
 * Detect whether the focal tweet has its OWN (non-quoted) native video, and if so
 * return the tweet ID. Reuses the extractor's proven media/visibility/permalink
 * helpers. Returns null for text tweets, quoted-only videos, or when no numeric
 * tweet ID resolves (e.g. /home).
 *
 * NOTE: X renders animated GIFs as <video> too, so this may return an ID for a GIF.
 * The background classifies GIFs as no-video via the syndication `type` field, so a
 * GIF never produces a note.
 */
export function detectTweetVideo(doc: Document, url: string): string | null {
  const articles = doc.querySelectorAll('article');
  if (articles.length === 0) return null;

  const urlMatch = url.match(TWITTER_STATUS_RE);
  if (urlMatch) {
    // Direct tweet: the main tweet is the one authored by the URL's handle.
    const mainArticle = findMainArticle(articles, urlMatch[1]);
    return mainArticle && articleHasOwnVideo(mainArticle) ? urlMatch[2] : null;
  }

  // Feed: the most-visible article.
  const article = pickMostVisibleArticle(Array.from(articles));
  if (!articleHasOwnVideo(article)) return null;
  return extractArticlePermalink(article, url).match(/\/status\/(\d+)/)?.[1] ?? null;
}

/** True iff the article has its own (non-quoted) <video> with a real media poster. */
function articleHasOwnVideo(article: Element): boolean {
  for (const video of article.querySelectorAll('video')) {
    if (isInsideQuotedTweet(video, article)) continue;
    if (((video as HTMLVideoElement).poster || '').includes('pbs.twimg.com')) return true;
  }
  return false;
}
```

- [ ] **Step 2: Verify the build passes**

Run: `pnpm wxt build`
Expected: no TypeScript errors. (`findMainArticle` takes `NodeListOf<Element>` — pass `articles` directly; `pickMostVisibleArticle` takes `Element[]` — pass `Array.from(articles)`.)

- [ ] **Step 3: Validate detection on live DOM (DevTools)**

Open Chrome DevTools console and paste this console-equivalent of the detector on several tweet types:

```js
(() => {
  const inQuoted = (el, art) => { let p = el.parentElement; while (p && p !== art) { if (p.getAttribute('role') === 'link' && p.querySelector('[data-testid="tweetText"]')) return true; p = p.parentElement; } return false; };
  const ownVideo = art => [...art.querySelectorAll('video')].some(v => !inQuoted(v, art) && (v.poster || '').includes('pbs.twimg.com'));
  return [...document.querySelectorAll('article')].map((a, i) => ({ i, ownVideo: ownVideo(a), status: a.querySelector('a[href*="/status/"]')?.getAttribute('href') }));
})()
```

Confirm:
- On `https://x.com/h100envy/status/2075240393419936189` → the main article shows `ownVideo: true`.
- On a text-only tweet → all articles `ownVideo: false`.
- On a tweet that only **quotes** a video tweet → the outer (main) article shows `ownVideo: false`.
- (A GIF tweet may show `ownVideo: true` — expected; the background classifies it as no-video.)

If `ownVideo` is wrong for the real-video / text / quoted cases, the poster/quoted heuristic needs adjusting in `articleHasOwnVideo` before proceeding.

- [ ] **Step 4: Commit**

```bash
git add src/lib/extractors/twitter.ts
git commit -m "feat: detect a tweet's own (non-quoted) native video"
```

---

### Task 4: Add the caption message types

**Files:**
- Modify: `src/lib/messaging/types.ts` (`MessageType` union ~line 44; two interfaces near `FetchImagesMessage` ~line 217; `Message` union ~line 347)

**Interfaces:**
- Produces: `FetchTwitterCaptionsMessage`, `FetchTwitterCaptionsResultMessage`.

- [ ] **Step 1: Add union members and interfaces**

Add to the `MessageType` union:

```ts
  | 'FETCH_TWITTER_CAPTIONS'
  | 'FETCH_TWITTER_CAPTIONS_RESULT'
```

Add the interfaces:

```ts
export interface FetchTwitterCaptionsMessage {
  type: 'FETCH_TWITTER_CAPTIONS';
  tweetId: string;
  langPrefs?: string[];
  summaryLang?: string;
}

export interface FetchTwitterCaptionsResultMessage {
  type: 'FETCH_TWITTER_CAPTIONS_RESULT';
  success: boolean;
  transcript?: string;
  /** Present when there is no transcript: 'no-captions' -> note; 'no-video' -> nothing. */
  captionStatus?: 'no-captions' | 'no-video';
  error?: string;
}
```

Add both to the `Message` union:

```ts
  | FetchTwitterCaptionsMessage
  | FetchTwitterCaptionsResultMessage
```

- [ ] **Step 2: Verify the build passes**

Run: `pnpm wxt build`
Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/messaging/types.ts
git commit -m "feat: add FETCH_TWITTER_CAPTIONS message types"
```

---

### Task 5: Background handler

**Files:**
- Modify: `src/entrypoints/background/index.ts` (import; `case` in `handleMessage` switch before `default:` at ~line 234; handler near `handleFetchModels` ~line 1398)

**Interfaces:**
- Consumes: `fetchTwitterVideoTranscript` (Task 2); `FetchTwitterCaptionsResultMessage` (Task 4).

- [ ] **Step 1: Import the orchestrator + result type**

Add near the other `@/lib` imports at the top of `src/entrypoints/background/index.ts`:

```ts
import { fetchTwitterVideoTranscript } from '@/lib/twitter-video';
import type { FetchTwitterCaptionsResultMessage } from '@/lib/messaging/types';
```

(If the file already imports message types in bulk, add `FetchTwitterCaptionsResultMessage` there to match its style.)

- [ ] **Step 2: Add the switch case**

Before `default:` in the `handleMessage` switch (`background/index.ts:234`):

```ts
    case 'FETCH_TWITTER_CAPTIONS':
      return handleFetchTwitterCaptions(message.tweetId, message.langPrefs, message.summaryLang);
```

- [ ] **Step 3: Add the handler**

Add near `handleFetchModels` (~`background/index.ts:1398`):

```ts
async function handleFetchTwitterCaptions(
  tweetId: string,
  langPrefs?: string[],
  summaryLang?: string,
): Promise<FetchTwitterCaptionsResultMessage> {
  try {
    const r = await fetchTwitterVideoTranscript(tweetId, langPrefs, summaryLang);
    if ('transcript' in r) {
      return { type: 'FETCH_TWITTER_CAPTIONS_RESULT', success: true, transcript: r.transcript };
    }
    return { type: 'FETCH_TWITTER_CAPTIONS_RESULT', success: true, captionStatus: r.status };
  } catch (err) {
    return {
      type: 'FETCH_TWITTER_CAPTIONS_RESULT',
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
```

- [ ] **Step 4: Verify the build passes**

Run: `pnpm wxt build`
Expected: no TypeScript errors (`message.tweetId`/`langPrefs`/`summaryLang` type-check because the `Message` union now includes `FetchTwitterCaptionsMessage`).

- [ ] **Step 5: Commit**

```bash
git add src/entrypoints/background/index.ts
git commit -m "feat: add background handler for X video captions"
```

---

### Task 6: Refactor `fetchEmbeddedVideoTranscript` to a discriminated return (no behavior change)

Lets the single call site distinguish "found a transcript" from "found a video but no captions". No X code yet; existing providers behave identically.

**Files:**
- Modify: `src/entrypoints/content/index.ts` (`fetchEmbeddedVideoTranscript`, `content/index.ts:345-398`; call site `content/index.ts:297-305`)

**Interfaces:**
- Produces: `type EmbeddedVideoResult = { transcript: string } | { status: 'no-captions' } | null;` and `fetchEmbeddedVideoTranscript(...): Promise<EmbeddedVideoResult>`.

- [ ] **Step 1: Change the return type and wrap existing returns**

Add above `fetchEmbeddedVideoTranscript` (~`content/index.ts:340`):

```ts
type EmbeddedVideoResult = { transcript: string } | { status: 'no-captions' } | null;
```

Change the signature return type to `Promise<EmbeddedVideoResult>`. In each of the five existing branches (Cloudflare, Vimeo, Dailymotion, JW Player, generic HTML5), change `if (t) return t;` to `if (t) return { transcript: t };`. For example the Cloudflare branch:

```ts
  // Cloudflare Stream
  const cfVideoId = detectCloudflareStreamVideo(doc);
  if (cfVideoId) {
    try {
      const t = await fetchCloudflareStreamTranscript(cfVideoId, langPrefs, summaryLang);
      if (t) return { transcript: t };
    } catch { /* fall through */ }
  }
```

Apply the identical change to the Vimeo, Dailymotion, JW Player, and generic HTML5 branches. Leave the final `return null;` unchanged.

- [ ] **Step 2: Update the call site**

Replace the call-site block (`content/index.ts:297-305`):

```ts
  // Resolve video transcript from embedded players (non-YouTube, non-Netflix)
  if (content.type !== 'youtube' && content.type !== 'netflix') {
    const transcript = await fetchEmbeddedVideoTranscript(document, window.location.href, langPrefs, summaryLang);
    if (transcript) {
      content.transcriptWordCount = transcript.split(/\s+/).filter(Boolean).length;
      content.content += `\n\n## Transcript\n\n${transcript}`;
      content.wordCount = content.content.split(/\s+/).filter(Boolean).length;
    }
  }
```

with:

```ts
  // Resolve video transcript from embedded players (non-YouTube, non-Netflix)
  if (content.type !== 'youtube' && content.type !== 'netflix') {
    const result = await fetchEmbeddedVideoTranscript(document, window.location.href, langPrefs, summaryLang);
    if (result && 'transcript' in result) {
      content.transcriptWordCount = result.transcript.split(/\s+/).filter(Boolean).length;
      content.content += `\n\n## Transcript\n\n${result.transcript}`;
      content.wordCount = content.content.split(/\s+/).filter(Boolean).length;
    } else if (result && result.status === 'no-captions') {
      content.content += `\n\n*(Video present; captions unavailable.)*`;
      content.wordCount = content.content.split(/\s+/).filter(Boolean).length;
    }
  }
```

- [ ] **Step 3: Verify the build passes**

Run: `pnpm wxt build`
Expected: no TypeScript errors.

- [ ] **Step 4: Verify no regression on an existing provider**

Build, reload, open a Cloudflare Stream / Vimeo / Dailymotion page whose video has captions, and summarize. Expected: the `## Transcript` section still appears exactly as before.

- [ ] **Step 5: Commit**

```bash
git add src/entrypoints/content/index.ts
git commit -m "refactor: discriminated result for embedded video transcript"
```

---

### Task 7: Wire the X branch (the feature)

**Files:**
- Modify: `src/entrypoints/content/index.ts` (import; module-level `sendMessage` helper; new branch in `fetchEmbeddedVideoTranscript` before the generic HTML5 branch, ~line 387)

**Interfaces:**
- Consumes: `detectTweetVideo` (Task 3); `FETCH_TWITTER_CAPTIONS` handler (Task 5); `EmbeddedVideoResult` (Task 6).

- [ ] **Step 1: Import the detector**

Add near the other extractor imports at the top of `src/entrypoints/content/index.ts`:

```ts
import { detectTweetVideo } from '@/lib/extractors/twitter';
```

- [ ] **Step 2: Add a module-level helper to reach the background**

Add near the other module-level helpers (e.g. after `bridgeRequest`, ~`content/index.ts:431`). Raw Chrome callback API per Global Constraints:

```ts
/** Ask the background worker to resolve a tweet's video captions (all fetches are CORS-blocked from content). */
function fetchTwitterCaptionsViaBackground(
  tweetId: string,
  langPrefs?: string[],
  summaryLang?: string,
): Promise<{ transcript?: string; captionStatus?: 'no-captions' | 'no-video' } | null> {
  const rt = (globalThis as unknown as { chrome: { runtime: typeof chrome.runtime } }).chrome.runtime;
  return new Promise((resolve) => {
    try {
      rt.sendMessage(
        { type: 'FETCH_TWITTER_CAPTIONS', tweetId, langPrefs, summaryLang },
        (resp: unknown) => {
          if (rt.lastError) { resolve(null); return; }
          const r = resp as { success?: boolean; transcript?: string; captionStatus?: 'no-captions' | 'no-video' } | undefined;
          resolve(r?.success ? { transcript: r.transcript, captionStatus: r.captionStatus } : null);
        },
      );
    } catch { resolve(null); }
  });
}
```

- [ ] **Step 3: Add the X branch to `fetchEmbeddedVideoTranscript`**

Insert **before** the generic HTML5 branch (before the "Generic HTML5" comment at `content/index.ts:387`):

```ts
  // X / Twitter native video (HLS captions via the syndication CDN, resolved in the background)
  const twitterId = detectTweetVideo(doc, url);
  if (twitterId) {
    const r = await fetchTwitterCaptionsViaBackground(twitterId, langPrefs, summaryLang);
    if (r?.transcript) return { transcript: r.transcript };
    if (r?.captionStatus === 'no-captions') return { status: 'no-captions' };
    // no-video / null -> fall through (no note)
  }
```

- [ ] **Step 4: Verify the build passes**

Run: `pnpm wxt build`
Expected: no TypeScript errors.

- [ ] **Step 5: Manual end-to-end on the validated tweet**

Build, reload, open `https://x.com/h100envy/status/2075240393419936189`, open the xTil side panel, and summarize.
Expected: a `## Transcript` section containing the talk transcript (`Hello, hello, hello...`), with the UI word-count indicators separating article words from transcript words.

- [ ] **Step 6: Commit**

```bash
git add src/entrypoints/content/index.ts
git commit -m "feat: summarize X video closed captions"
```

---

### Task 8: Verification matrix + changelog

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Run the full manual matrix**

Build (`pnpm wxt build`), reload, and confirm each case:

| Case | How | Expected |
| --- | --- | --- |
| Captioned video, direct | the example tweet | `## Transcript` folded in; transcript word count shown |
| Captioned video, feed | scroll the tweet into view on `/home` or a profile, summarize | transcript folded in for the focal tweet |
| Uncaptioned video | a video tweet with no CC | `*(Video present; captions unavailable.)*`; poster retained |
| Animated GIF | a GIF tweet | **no note, no transcript** |
| Quoted video only | a tweet quoting a video tweet, own body no video | **no note** |
| Text-only tweet | any text tweet | unchanged |

If a case misbehaves, re-run the Task 3 DevTools snippet on that tweet to see whether detection or the background classification is at fault.

- [ ] **Step 2: Add a changelog entry**

Add under an Unreleased/next-version heading in `CHANGELOG.md`:

```markdown
- **X video captions**: tweets with a captioned video now include the video's
  transcript in the summary; uncaptioned videos show a brief note. GIFs are ignored.
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog entry for X video captions"
```

---

## Notes for the implementer

- **Live-data dependency:** Tasks 3, 7, and 8 hit the live syndication CDN + `video.twimg.com` (via the extension/DevTools). Without network, the manual steps can't run; the build gate still applies.
- **All fetches are in the background** (service worker), which bypasses CORS via `<all_urls>`. Do **not** move any of the syndication/`.m3u8`/`.vtt` fetches into the content script — syndication (`ACAO: platform.twitter.com`) and the `.m3u8` on a `twitter.com`-origin page would be CORS-blocked.
- **Video vs GIF is decided by syndication** (`mediaDetails[].type`), not the DOM. Detection (`detectTweetVideo`) may return an ID for a GIF; the background returns `no-video` and the content branch shows nothing.
- **Format:** transcripts use the shared `parseVtt` `[H:MM:SS] text` format. No dedup/overlap-merge (X VOD VTTs are single, non-rolling segments — see spec Risks).
- **One video per tweet** (X constraint) — `pickVideoM3u8` returns the first `type === 'video'` variant.
- **Verification matches the other video providers:** `pnpm wxt build` + in-extension manual testing. No unit tests, no diagnostic scripts.
```
