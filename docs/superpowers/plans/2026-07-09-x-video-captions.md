# X (Twitter) Video Caption Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a tweet contains a video, fold its closed-caption (CC) transcript into the xTil summary; if the video has no captions, add a small note and keep today's poster-thumbnail behavior.

**Architecture:** Extend the existing embedded-video transcript framework (`fetchEmbeddedVideoTranscript` in `src/entrypoints/content/index.ts`, which already runs for tweets) by adding one detector/fetcher branch for X. Captions come from the public syndication CDN: derive a token from the tweet ID → syndication `tweet-result` JSON → HLS master `.m3u8` → subtitle playlist → `.vtt` → text. Only the syndication fetch is CORS-blocked from the content script, so it is delegated to a narrow background message; the `.m3u8`/`.vtt` are fetched inline like `cloudflare-stream.ts` does. Parsing reuses the shared `parseHlsSubtitleTracks`, `pickBestTrack`, and `parseVtt`.

**Tech Stack:** WXT 0.20.x, Preact, TypeScript (strict), pnpm. Chrome MV3 (service-worker background + content script). No unit-test runner in the repo — verification is `pnpm wxt build` (tsc typecheck gate), a standalone Node diagnostic script, and manual in-extension checks.

## Global Constraints

- **Chrome APIs via `globalThis` cast, raw callback style** — never WXT's `browser` polyfill. Background message handlers use `sendResponse` + `return true`; senders may use promise or callback form. (Project memory: MV3 async responses don't propagate reliably through the polyfill.)
- **No manifest change** — `host_permissions` is already `['<all_urls>']`, so background `fetch` to `cdn.syndication.twimg.com` and `video.twimg.com` bypasses CORS.
- **Path alias** `@/*` → `src/*` (used by entrypoints). Library modules under `src/lib/` import each other with **relative, extensionless** specifiers (e.g. `from './transcript-lang'`).
- **After any code change**: `pnpm wxt build` must succeed, then reload the unpacked extension from `.output/chrome-mv3/` before manual testing (project memory: stale builds cause confusing errors).
- **No new dependencies, no test framework** — matches the repo's established pattern.
- **Naming**: use `twitter` (not `X`/`CC`) to match the extractor file/type and sibling video modules.
- **Token algorithm (verbatim):** `((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '')`. For `id = "2075240393419936189"` this must equal `"513k5q5yoew"`.

---

### Task 1: Standalone live-chain diagnostic script

Proves the external data source + parsing approach end-to-end before touching the extension. Self-contained plain JS (intentional — it validates the risky external pipeline independently of the TS build; it does not import the extension modules).

**Files:**
- Create: `scripts/verify-x-captions.mjs`

**Interfaces:**
- Consumes: nothing (standalone).
- Produces: nothing importable; a CLI diagnostic (`node scripts/verify-x-captions.mjs [tweetId]`).

- [ ] **Step 1: Write the diagnostic script**

```js
// scripts/verify-x-captions.mjs
// Standalone diagnostic: exercises the X caption pipeline end-to-end against
// live syndication + video.twimg.com. Mirrors (does not import) the extension
// parsing logic so it can run with plain node and validate the data source.

const DEFAULT_ID = '2075240393419936189';
const EXPECTED_TOKEN = '513k5q5yoew';

function deriveSyndicationToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

function pickVideoM3u8(json) {
  const media = json?.mediaDetails;
  if (!Array.isArray(media)) return null;
  for (const m of media) {
    if (m?.type !== 'video') continue;
    const variants = m?.video_info?.variants;
    if (!Array.isArray(variants)) continue;
    const hls = variants.find(v => v?.content_type === 'application/x-mpegURL' && typeof v?.url === 'string');
    if (hls) return hls.url;
  }
  return null;
}

function resolveTwimgUrl(pathOrUrl) {
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  return `https://video.twimg.com${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}

function parseHlsSubtitleTracks(manifest) {
  const tracks = [];
  for (const line of manifest.split('\n')) {
    if (!line.includes('TYPE=SUBTITLES')) continue;
    const lang = line.match(/LANGUAGE="([^"]+)"/)?.[1];
    const uri = line.match(/URI="([^"]+)"/)?.[1];
    if (!lang || !uri || line.includes('FORCED=YES')) continue;
    tracks.push({ languageCode: lang, uri });
  }
  return tracks;
}

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function parseVtt(vtt) {
  const lines = [];
  const cueRe = /(\d{2}:\d{2}:\d{2}\.\d{3})\s+-->\s+\d{2}:\d{2}:\d{2}\.\d{3}/;
  const vttLines = vtt.split('\n');
  let i = 0;
  while (i < vttLines.length) {
    const match = vttLines[i].match(cueRe);
    if (match) {
      i++;
      const parts = [];
      while (i < vttLines.length && vttLines[i].trim()) { parts.push(vttLines[i].trim()); i++; }
      const text = decodeEntities(parts.join(' ').replace(/<[^>]+>/g, '')).trim();
      if (text) lines.push(`[${match[1].slice(0, 8)}] ${text}`);
    } else { i++; }
  }
  return lines.join('\n');
}

async function main() {
  const id = process.argv[2] || DEFAULT_ID;

  const token = deriveSyndicationToken(DEFAULT_ID);
  console.log(`token(${DEFAULT_ID}) = ${token}  [${token === EXPECTED_TOKEN ? 'PASS' : 'FAIL expected ' + EXPECTED_TOKEN}]`);

  const synUrl = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${deriveSyndicationToken(id)}`;
  const synRes = await fetch(synUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  console.log('syndication:', synRes.status);
  if (!synRes.ok) return;
  const m3u8Url = pickVideoM3u8(await synRes.json());
  console.log('m3u8:', m3u8Url || '(none — no video)');
  if (!m3u8Url) return;

  const master = await (await fetch(m3u8Url, { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
  const tracks = parseHlsSubtitleTracks(master);
  console.log('subtitle tracks:', tracks.map(t => t.languageCode).join(', ') || '(none)');
  if (!tracks.length) { console.log('NO CAPTIONS'); return; }

  const playlist = await (await fetch(resolveTwimgUrl(tracks[0].uri), { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
  const vttRel = playlist.split('\n').find(l => l.trim() && !l.startsWith('#'));
  const vtt = await (await fetch(resolveTwimgUrl(vttRel.trim()), { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
  const transcript = parseVtt(vtt);
  console.log('\n--- TRANSCRIPT ---\n' + transcript.slice(0, 1200));
}

main().catch(err => { console.error('ERROR:', err); process.exit(1); });
```

- [ ] **Step 2: Run it — expect the token PASS and a real transcript**

Run: `node scripts/verify-x-captions.mjs`
Expected: a line `token(2075240393419936189) = 513k5q5yoew  [PASS]`, `syndication: 200`, an m3u8 URL, `subtitle tracks: en-gb`, and a transcript beginning `[00:00:00] Hello, hello, hello. Yes sorry for being a bit late there's ...`

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-x-captions.mjs
git commit -m "feat: add X video caption pipeline diagnostic script"
```

---

### Task 2: Share `parseHlsSubtitleTracks` and add entity decoding to `parseVtt`

Move the generic HLS subtitle parser into the shared module (it is about to have a second consumer) and fix the pre-existing HTML-entity gap in `parseVtt` (benefits YouTube/Vimeo/Dailymotion/CF/X).

**Files:**
- Modify: `src/lib/transcript-lang.ts` (add `parseHlsSubtitleTracks`; add `decodeEntities`; apply it in `parseVtt` and `parseSrt`)
- Modify: `src/lib/cloudflare-stream.ts:10,71-88` (import `parseHlsSubtitleTracks` from `./transcript-lang`; delete the local copy)

**Interfaces:**
- Consumes: existing `CaptionTrack` type in `transcript-lang.ts`.
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

Add a `decodeEntities` helper above `parseVtt`:

```ts
/** Decode the HTML entities commonly seen in caption text. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}
```

In `parseVtt`, change the text line (currently `transcript-lang.ts:151`) from:

```ts
      const text = textParts.join(' ').replace(/<[^>]+>/g, '').trim();
```

to:

```ts
      const text = decodeEntities(textParts.join(' ').replace(/<[^>]+>/g, '')).trim();
```

Apply the same change in `parseSrt` (currently `transcript-lang.ts:181`).

- [ ] **Step 2: Point `cloudflare-stream.ts` at the shared parser**

In `src/lib/cloudflare-stream.ts`, change the import on line 10 from:

```ts
import { pickBestTrack, parseVtt, type CaptionTrack } from './transcript-lang';
```

to (drop `CaptionTrack` — after the move it is no longer referenced in this file — and add `parseHlsSubtitleTracks`):

```ts
import { pickBestTrack, parseVtt, parseHlsSubtitleTracks } from './transcript-lang';
```

Delete the local `parseHlsSubtitleTracks` function (currently `cloudflare-stream.ts:68-88`, including its doc comment). Leave the call site (`cloudflare-stream.ts:44`) unchanged — it now uses the imported version.

- [ ] **Step 3: Verify the build passes**

Run: `pnpm wxt build`
Expected: build completes with no TypeScript errors (a duplicate-identifier or unused-import error here means the local copy wasn't fully removed).

- [ ] **Step 4: Commit**

```bash
git add src/lib/transcript-lang.ts src/lib/cloudflare-stream.ts
git commit -m "refactor: share parseHlsSubtitleTracks and add entity decoding to parseVtt"
```

---

### Task 3: `twitter-video.ts` module (detection, token, fetchers)

The one new library module. Contains DOM detection (content-side), the syndication→m3u8 resolver (background-side), the m3u8→VTT resolver (content-side), and pure helpers. No top-level use of `window`/`document`/`fetch` — those appear only inside functions, so the background bundle can import the syndication resolver safely.

**Files:**
- Create: `src/lib/twitter-video.ts`

**Interfaces:**
- Consumes: `parseHlsSubtitleTracks`, `pickBestTrack`, `parseVtt` from `./transcript-lang` (Task 2).
- Produces:
  - `deriveSyndicationToken(id: string): string`
  - `pickVideoM3u8(json: unknown): string | null`
  - `resolveTwimgUrl(pathOrUrl: string): string`
  - `fetchTwitterVideoM3u8(tweetId: string): Promise<string | null>` — **background-side** (syndication fetch).
  - `fetchTwitterCaptionsFromM3u8(m3u8Url: string, langPrefs?: string[], summaryLang?: string): Promise<{ transcript: string } | { status: 'no-captions' }>` — **content-side**.
  - `detectTwitterVideo(url: string, doc: Document): string | null` — **content-side**; tweet ID iff a real (non-GIF) video player is present and an ID resolves.

- [ ] **Step 1: Write the module**

```ts
// src/lib/twitter-video.ts
import { parseHlsSubtitleTracks, pickBestTrack, parseVtt } from './transcript-lang';

const SYNDICATION_ORIGIN = 'https://cdn.syndication.twimg.com';
const VIDEO_ORIGIN = 'https://video.twimg.com';
const FETCH_TIMEOUT_MS = 15_000;
const TWITTER_HOSTNAME_RE = /(^|\.)(?:twitter\.com|x\.com)$/;
const STATUS_ID_RE = /\/status\/(\d+)/;

/** react-tweet syndication token derivation (see plan Global Constraints). */
export function deriveSyndicationToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

/** Resolve an absolute-path or full URL against video.twimg.com. */
export function resolveTwimgUrl(pathOrUrl: string): string {
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  return `${VIDEO_ORIGIN}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}

/** First real-video HLS (.m3u8) variant from a syndication tweet-result payload. */
export function pickVideoM3u8(json: unknown): string | null {
  const media = (json as { mediaDetails?: unknown })?.mediaDetails;
  if (!Array.isArray(media)) return null;
  for (const m of media) {
    if (m?.type !== 'video') continue;
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

function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

/**
 * Background-side: derive token, fetch syndication tweet-result, return the
 * video's HLS master .m3u8 URL (or null). CORS-blocked from content, so this
 * runs in the service worker (host_permissions bypasses CORS).
 */
export async function fetchTwitterVideoM3u8(tweetId: string): Promise<string | null> {
  const token = deriveSyndicationToken(tweetId);
  const url = `${SYNDICATION_ORIGIN}/tweet-result?id=${tweetId}&lang=en&token=${token}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) return null;
  return pickVideoM3u8(await res.json());
}

/**
 * Content-side: master .m3u8 -> subtitle playlist -> .vtt -> transcript text.
 * The .m3u8 (ACAO x.com) and .vtt (ACAO *) are fetchable from the content script.
 */
export async function fetchTwitterCaptionsFromM3u8(
  m3u8Url: string,
  langPrefs?: string[],
  summaryLang?: string,
): Promise<{ transcript: string } | { status: 'no-captions' }> {
  const masterRes = await fetchWithTimeout(m3u8Url);
  if (!masterRes.ok) return { status: 'no-captions' };

  const tracks = parseHlsSubtitleTracks(await masterRes.text());
  if (tracks.length === 0) return { status: 'no-captions' };

  const best = pickBestTrack(tracks, langPrefs, summaryLang);
  const playlistRes = await fetchWithTimeout(resolveTwimgUrl(best.baseUrl));
  if (!playlistRes.ok) return { status: 'no-captions' };

  const vttRel = (await playlistRes.text())
    .split('\n')
    .find((line) => line.trim() && !line.startsWith('#'));
  if (!vttRel) return { status: 'no-captions' };

  const vttRes = await fetchWithTimeout(resolveTwimgUrl(vttRel.trim()));
  if (!vttRes.ok) return { status: 'no-captions' };

  const transcript = parseVtt(await vttRes.text());
  if (!transcript.trim()) return { status: 'no-captions' };
  return { transcript };
}

function safeHostname(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}

/** Extract a numeric tweet ID from an article's status links. */
function articleStatusId(article: Element): string | null {
  for (const link of article.querySelectorAll('a[href]')) {
    const m = (link.getAttribute('href') || '').match(STATUS_ID_RE);
    if (m) return m[1];
  }
  return null;
}

/** Pick the element with the largest visible area in the viewport. */
function pickMostVisible(els: Element[]): Element | null {
  const vh = window.innerHeight;
  let best: Element | null = null;
  let bestScore = -Infinity;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.height === 0) continue;
    const visible = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    if (visible > bestScore) { bestScore = visible; best = el; }
  }
  return best;
}

/**
 * Content-side: return the tweet ID iff the focal tweet contains a REAL video
 * player (not an animated GIF, which X also renders as <video>), and an ID
 * resolves. Returns null otherwise (e.g. /home with no /status/ link).
 */
export function detectTwitterVideo(url: string, doc: Document): string | null {
  if (!TWITTER_HOSTNAME_RE.test(safeHostname(url))) return null;

  const players = Array.from(
    doc.querySelectorAll('[data-testid="videoPlayer"], [data-testid="videoComponent"]'),
  ).filter((el) => !el.closest('[data-testid="tweetGif"]'));

  const player = pickMostVisible(players);
  if (!player) return null;

  const fromUrl = url.match(STATUS_ID_RE)?.[1];
  if (fromUrl) return fromUrl;

  const article = player.closest('article');
  return article ? articleStatusId(article) : null;
}
```

- [ ] **Step 2: Verify the build passes**

Run: `pnpm wxt build`
Expected: build completes with no TypeScript errors.

- [ ] **Step 3: Cross-check the token against the diagnostic**

Run: `node scripts/verify-x-captions.mjs`
Expected: still prints `token(...) = 513k5q5yoew  [PASS]` (the module uses the same one-line algorithm — this confirms they agree).

- [ ] **Step 4: Commit**

```bash
git add src/lib/twitter-video.ts
git commit -m "feat: add twitter-video module (detection + syndication caption fetch)"
```

---

### Task 4: Add the syndication message types

**Files:**
- Modify: `src/lib/messaging/types.ts` (`MessageType` union at line 6; add two interfaces; `Message` union at line 309)

**Interfaces:**
- Produces: `FetchTwitterSyndicationMessage`, `FetchTwitterSyndicationResultMessage`.

- [ ] **Step 1: Add the union members and interfaces**

In the `MessageType` union (around `types.ts:44`, before the closing of the union), add:

```ts
  | 'FETCH_TWITTER_SYNDICATION'
  | 'FETCH_TWITTER_SYNDICATION_RESULT'
```

Add the interfaces (near `FetchImagesMessage`, ~line 217):

```ts
export interface FetchTwitterSyndicationMessage {
  type: 'FETCH_TWITTER_SYNDICATION';
  tweetId: string;
}

export interface FetchTwitterSyndicationResultMessage {
  type: 'FETCH_TWITTER_SYNDICATION_RESULT';
  success: boolean;
  /** HLS master .m3u8 URL, or null when the tweet has no video. */
  m3u8Url?: string | null;
  error?: string;
}
```

Add both to the `Message` union (around `types.ts:347`):

```ts
  | FetchTwitterSyndicationMessage
  | FetchTwitterSyndicationResultMessage
```

- [ ] **Step 2: Verify the build passes**

Run: `pnpm wxt build`
Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/messaging/types.ts
git commit -m "feat: add FETCH_TWITTER_SYNDICATION message types"
```

---

### Task 5: Background handler for the syndication fetch

**Files:**
- Modify: `src/entrypoints/background/index.ts` (add import; add `case` in `handleMessage` switch ~line 233; add handler function)

**Interfaces:**
- Consumes: `fetchTwitterVideoM3u8` (Task 3), `FetchTwitterSyndicationResultMessage` (Task 4).
- Produces: handles `FETCH_TWITTER_SYNDICATION`, returns `FetchTwitterSyndicationResultMessage`.

- [ ] **Step 1: Import the resolver**

Add near the other `@/lib` imports at the top of `src/entrypoints/background/index.ts`:

```ts
import { fetchTwitterVideoM3u8 } from '@/lib/twitter-video';
import type { FetchTwitterSyndicationResultMessage } from '@/lib/messaging/types';
```

(If `FetchTwitterSyndicationResultMessage` is more convenient via the existing bulk type import in that file, add it there instead — match the file's existing import style.)

- [ ] **Step 2: Add the switch case**

In the `handleMessage` switch (before `default:` at `background/index.ts:234`):

```ts
    case 'FETCH_TWITTER_SYNDICATION':
      return handleFetchTwitterSyndication(message.tweetId);
```

- [ ] **Step 3: Add the handler function**

Add near `handleFetchModels` (~`background/index.ts:1398`):

```ts
async function handleFetchTwitterSyndication(
  tweetId: string,
): Promise<FetchTwitterSyndicationResultMessage> {
  try {
    const m3u8Url = await fetchTwitterVideoM3u8(tweetId);
    return { type: 'FETCH_TWITTER_SYNDICATION_RESULT', success: true, m3u8Url };
  } catch (err) {
    return {
      type: 'FETCH_TWITTER_SYNDICATION_RESULT',
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
```

- [ ] **Step 4: Verify the build passes**

Run: `pnpm wxt build`
Expected: no TypeScript errors (the `message.tweetId` access type-checks because the `Message` union now includes `FetchTwitterSyndicationMessage`).

- [ ] **Step 5: Commit**

```bash
git add src/entrypoints/background/index.ts
git commit -m "feat: add background handler for X video syndication lookup"
```

---

### Task 6: Refactor `fetchEmbeddedVideoTranscript` to a discriminated return (no behavior change)

Prepares the single call site to distinguish "found a transcript" from "found a video but no captions", without changing any existing provider's behavior. No X code yet.

**Files:**
- Modify: `src/entrypoints/content/index.ts` (`fetchEmbeddedVideoTranscript` signature + each branch's return, `content/index.ts:345-398`; the call site, `content/index.ts:297-305`)

**Interfaces:**
- Produces: `type EmbeddedVideoResult = { transcript: string } | { status: 'no-captions' } | null;` and `fetchEmbeddedVideoTranscript(...): Promise<EmbeddedVideoResult>`.

- [ ] **Step 1: Change the return type and wrap existing returns**

Add the type above `fetchEmbeddedVideoTranscript` (~`content/index.ts:340`):

```ts
type EmbeddedVideoResult = { transcript: string } | { status: 'no-captions' } | null;
```

Change the signature return type from `Promise<string | null>` to `Promise<EmbeddedVideoResult>`.

Change each existing branch's `if (t) return t;` to `if (t) return { transcript: t };`. There are five such branches (Cloudflare, Vimeo, Dailymotion, JW Player, generic HTML5), e.g. the Cloudflare branch becomes:

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

Apply the identical `if (t) return { transcript: t };` change to the Vimeo, Dailymotion, JW Player, and generic HTML5 branches. Leave the final `return null;` unchanged.

- [ ] **Step 2: Update the call site to handle the discriminated result**

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

- [ ] **Step 4: Verify no regression on an existing embedded-video provider**

Build, reload the extension, open a page with a Cloudflare Stream / Vimeo / Dailymotion video that has captions, and summarize. Expected: the `## Transcript` section still appears exactly as before (this exercises the `{ transcript }` path end-to-end).

- [ ] **Step 5: Commit**

```bash
git add src/entrypoints/content/index.ts
git commit -m "refactor: discriminated result for embedded video transcript"
```

---

### Task 7: Wire the X branch + no-captions note (the feature)

**Files:**
- Modify: `src/entrypoints/content/index.ts` (imports; new branch in `fetchEmbeddedVideoTranscript`; module-level background helper)

**Interfaces:**
- Consumes: `detectTwitterVideo`, `fetchTwitterCaptionsFromM3u8` (Task 3); `FETCH_TWITTER_SYNDICATION` handler (Task 5); `EmbeddedVideoResult` (Task 6).

- [ ] **Step 1: Import the twitter-video functions**

Add to the imports at the top of `src/entrypoints/content/index.ts` (near line 7):

```ts
import { detectTwitterVideo, fetchTwitterCaptionsFromM3u8 } from '@/lib/twitter-video';
```

- [ ] **Step 2: Add a module-level helper to reach the background syndication fetch**

Add near the other module-level helpers (e.g. after `bridgeRequest`, ~`content/index.ts:431`). Uses the raw Chrome callback API per Global Constraints:

```ts
/** Ask the background worker to resolve a tweet's HLS master .m3u8 (CORS-blocked from content). */
function fetchTwitterM3u8ViaBackground(tweetId: string): Promise<string | null> {
  const rt = (globalThis as unknown as { chrome: { runtime: typeof chrome.runtime } }).chrome.runtime;
  return new Promise((resolve) => {
    try {
      rt.sendMessage({ type: 'FETCH_TWITTER_SYNDICATION', tweetId }, (resp: unknown) => {
        if (rt.lastError) { resolve(null); return; }
        const r = resp as { success?: boolean; m3u8Url?: string | null } | undefined;
        resolve(r?.success ? (r.m3u8Url ?? null) : null);
      });
    } catch { resolve(null); }
  });
}
```

- [ ] **Step 3: Add the X branch to `fetchEmbeddedVideoTranscript`**

Insert **before** the generic HTML5 branch (before `content/index.ts:387` "Generic HTML5" comment):

```ts
  // X / Twitter native video (HLS captions via the syndication CDN)
  const twitterId = detectTwitterVideo(url, doc);
  if (twitterId) {
    try {
      const m3u8Url = await fetchTwitterM3u8ViaBackground(twitterId);
      if (m3u8Url) {
        return await fetchTwitterCaptionsFromM3u8(m3u8Url, langPrefs, summaryLang);
      }
    } catch { /* fall through to no-captions */ }
    return { status: 'no-captions' };
  }
```

- [ ] **Step 4: Verify the build passes**

Run: `pnpm wxt build`
Expected: no TypeScript errors.

- [ ] **Step 5: Manual end-to-end on the validated tweet**

Build, reload, open `https://x.com/h100envy/status/2075240393419936189` in Chrome, open the xTil side panel, and summarize.
Expected: a `## Transcript` section containing the talk transcript (`Hello, hello, hello...`), and the UI word-count indicators separate article words from transcript words (`transcriptWordCount` populated).

- [ ] **Step 6: Commit**

```bash
git add src/entrypoints/content/index.ts
git commit -m "feat: summarize X video closed captions"
```

---

### Task 8: Verification matrix + changelog note

**Files:**
- Modify: `CHANGELOG.md` (add an Unreleased entry)

- [ ] **Step 1: Run the full manual matrix**

Build (`pnpm wxt build`), reload, and confirm each case:

| Case | URL type | Expected |
| --- | --- | --- |
| Captioned video, direct | `/status/<id>` (the example tweet) | `## Transcript` folded in; transcript word count shown |
| Captioned video, feed | scroll the tweet into view on `/home` or a profile, summarize | transcript folded in for the focal tweet |
| Uncaptioned video | a video tweet with no CC | `*(Video present; captions unavailable.)*`; poster thumbnail retained |
| Animated GIF | a tweet whose media is a GIF | **no note, no transcript** (regression guard) |
| Text-only tweet | any text tweet | unchanged (no note, no transcript) |

If the GIF case shows the note, the `[data-testid="tweetGif"]` exclusion (or the `videoPlayer`/`videoComponent` testid) needs adjusting in `detectTwitterVideo` — confirm the live testids via DevTools and update Task 3's selectors.

- [ ] **Step 2: Add a changelog entry**

Add under an Unreleased/next-version heading in `CHANGELOG.md`:

```markdown
- **X video captions**: tweets with a captioned video now include the video's
  transcript in the summary; uncaptioned videos show a brief note.
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog entry for X video captions"
```

---

## Notes for the implementer

- **Live-data dependency:** Tasks 1, 3-cross-check, and 7/8 hit the live syndication CDN + `video.twimg.com`. If the network is unavailable, the diagnostic and manual steps can't be run; the build gate still applies.
- **`videoPlayer` vs `videoComponent` testids:** both are queried and GIFs excluded via `tweetGif`. X changes DOM test IDs occasionally — if detection misfires, confirm the current testid in DevTools and update `detectTwitterVideo` (Task 3). Everything degrades gracefully (a missed detection = today's behavior; a false positive on a real no-caption video = the note).
- **Format:** the transcript uses the shared `parseVtt` `[H:MM:SS] text` format, consistent with every other provider. No dedup/overlap-merge is added (X VOD VTTs are single, non-rolling segments — see spec Risks).
- **One video per tweet** (X constraint) — `pickVideoM3u8` returns the first video variant; `detectTwitterVideo` picks the most-visible player.
```
