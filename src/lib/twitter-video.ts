import { parseHlsSubtitleTracks, pickBestTrack, parseVtt } from './transcript-lang';

const SYNDICATION_ORIGIN = 'https://cdn.syndication.twimg.com';
const FETCH_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 50;

/** Tweet body pulled from the syndication payload — used to summarize the tweet
 *  even when its <article> is absent from the DOM (X's fullscreen /video/ viewer). */
export interface TweetMeta {
  text: string;
  author?: string;
  handle?: string;
  createdAt?: string;
  posterUrl?: string;
}

export type TwitterCaptionResult =
  | { transcript: string; tweet: TweetMeta | null }
  | { status: 'no-captions'; tweet: TweetMeta | null }
  | { status: 'no-video'; tweet: TweetMeta | null };

/** react-tweet syndication token derivation. */
export function deriveSyndicationToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
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

/** Extract tweet text / author / poster from a syndication tweet-result payload. */
export function parseTweetMeta(json: unknown): TweetMeta | null {
  const j = json as {
    text?: unknown;
    user?: { name?: unknown; screen_name?: unknown };
    created_at?: unknown;
    mediaDetails?: unknown;
  } | null;
  if (!j || typeof j.text !== 'string') return null;

  let posterUrl: string | undefined;
  if (Array.isArray(j.mediaDetails)) {
    const vid = j.mediaDetails.find((m: { type?: string }) => m?.type === 'video');
    const url = (vid as { media_url_https?: unknown } | undefined)?.media_url_https;
    if (typeof url === 'string') posterUrl = url;
  }

  return {
    // Drop the trailing t.co link X appends for the video itself — it adds no signal.
    text: j.text.replace(/\s*https:\/\/t\.co\/\w+\s*$/, '').trim(),
    author: typeof j.user?.name === 'string' ? j.user.name : undefined,
    handle: typeof j.user?.screen_name === 'string' ? j.user.screen_name : undefined,
    createdAt: typeof j.created_at === 'string' ? j.created_at : undefined,
    posterUrl,
  };
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

// Short-lived per-tweet cache. X re-renders the tab many times while a video
// plays, which makes the side panel re-extract in a burst; without this, every
// re-extraction would re-walk the whole syndication -> m3u8 -> VTT chain.
const cache = new Map<string, { at: number; result: TwitterCaptionResult }>();

// Cache key includes the language signature because langPrefs/summaryLang drive
// pickBestTrack — a different language could select a different subtitle track.
function cacheKey(tweetId: string, langPrefs?: string[], summaryLang?: string): string {
  return `${tweetId}::${(langPrefs ?? []).join(',')}::${summaryLang ?? ''}`;
}

/**
 * Background-side orchestrator: tweet ID -> transcript + tweet body. Runs in the
 * service worker; host_permissions bypasses CORS for every hop.
 */
export async function fetchTwitterVideoTranscript(
  tweetId: string,
  langPrefs?: string[],
  summaryLang?: string,
): Promise<TwitterCaptionResult> {
  const key = cacheKey(tweetId, langPrefs, summaryLang);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result;

  const result = await resolveTwitterVideo(tweetId, langPrefs, summaryLang);
  // Cache only when syndication actually responded (so transient failures retry).
  if ('transcript' in result || result.tweet !== null) {
    // Bound the map: evict the oldest entry (insertion order) when at capacity.
    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, { at: Date.now(), result });
  }
  return result;
}

async function resolveTwitterVideo(
  tweetId: string,
  langPrefs?: string[],
  summaryLang?: string,
): Promise<TwitterCaptionResult> {
  const token = deriveSyndicationToken(tweetId);
  const json = await fetchJsonBounded(
    `${SYNDICATION_ORIGIN}/tweet-result?id=${tweetId}&lang=en&token=${token}`,
  );
  // Syndication failure (network / private / age-gated): treat as a video we can't read.
  if (json == null) return { status: 'no-captions', tweet: null };

  const tweet = parseTweetMeta(json);
  const m3u8Url = pickVideoM3u8(json);
  if (!m3u8Url) return { status: 'no-video', tweet }; // GIF / photo / no video -> no note

  const master = await fetchTextBounded(m3u8Url);
  if (master == null) return { status: 'no-captions', tweet };

  const tracks = parseHlsSubtitleTracks(master);
  if (tracks.length === 0) return { status: 'no-captions', tweet };

  const best = pickBestTrack(tracks, langPrefs, summaryLang);
  // Resolve the subtitle playlist + VTT relative to their parent URLs (standard HLS),
  // which handles both absolute-path and directory-relative URIs.
  const playlistUrl = new URL(best.baseUrl, m3u8Url).href;
  const playlist = await fetchTextBounded(playlistUrl);
  if (playlist == null) return { status: 'no-captions', tweet };

  const vttRel = playlist.split('\n').find((l) => l.trim() && !l.startsWith('#'));
  if (!vttRel) return { status: 'no-captions', tweet };

  const vtt = await fetchTextBounded(new URL(vttRel.trim(), playlistUrl).href);
  if (vtt == null) return { status: 'no-captions', tweet };

  const transcript = parseVtt(vtt);
  if (!transcript.trim()) return { status: 'no-captions', tweet };
  return { transcript, tweet };
}
