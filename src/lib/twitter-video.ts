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
