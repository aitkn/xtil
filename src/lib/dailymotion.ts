/**
 * Dailymotion transcript extraction via player metadata API.
 *
 * Flow: detect Dailymotion embed/page -> fetch player metadata -> pick best subtitle
 *     -> fetch signed SRT -> parse
 *
 * Metadata endpoint: https://www.dailymotion.com/player/metadata/video/{id}
 * SRT URLs are signed (sec2 token) and served with ACAO: *.
 */
import { pickBestTrack, parseSrt, type CaptionTrack } from './transcript-lang';

const DM_PAGE_RE = /dailymotion\.com\/video\/([a-zA-Z0-9]+)/;
const DM_EMBED_RE = /dailymotion\.com\/embed\/video\/([a-zA-Z0-9]+)/;
const DM_GEO_RE = /geo\.dailymotion\.com\/player[^"]*[?&]video=([a-zA-Z0-9]+)/;

/**
 * Detect a Dailymotion video on the page.
 * Returns the video ID if found, null otherwise.
 */
export function detectDailymotionVideo(url: string, doc: Document): string | null {
  // On dailymotion.com itself
  const pageMatch = url.match(DM_PAGE_RE);
  if (pageMatch) return pageMatch[1];

  // Embedded on another site
  const iframes = doc.querySelectorAll('iframe[src*="dailymotion.com"], iframe[src*="geo.dailymotion.com"]');
  for (const iframe of iframes) {
    const src = iframe.getAttribute('src') || '';
    const match = src.match(DM_EMBED_RE) || src.match(DM_GEO_RE);
    if (match) return match[1];
  }

  return null;
}

/**
 * Fetch transcript from a Dailymotion video via its player metadata.
 */
export async function fetchDailymotionTranscript(
  videoId: string,
  langPrefs?: string[],
  summaryLang?: string,
): Promise<string | null> {
  // Step 1: Fetch player metadata
  const metaRes = await fetch(`https://www.dailymotion.com/player/metadata/video/${videoId}`);
  if (!metaRes.ok) return null;
  const meta = await metaRes.json();

  // Step 2: Extract subtitle tracks
  const subsData = meta?.subtitles?.data;
  if (!subsData || Array.isArray(subsData) || Object.keys(subsData).length === 0) return null;

  // Step 3: Map to CaptionTrack format for shared language selection
  const captionTracks: CaptionTrack[] = Object.entries(subsData).map(([lang, info]: [string, any]) => ({
    baseUrl: info.urls?.[0] || '',
    languageCode: lang,
    kind: lang.endsWith('-auto') ? 'asr' : undefined,
    name: { simpleText: info.label },
  })).filter(t => t.baseUrl);

  if (captionTracks.length === 0) return null;

  const best = pickBestTrack(captionTracks, langPrefs, summaryLang);

  // Step 4: Fetch SRT (signed URL, ACAO: *)
  const srtRes = await fetch(best.baseUrl);
  if (!srtRes.ok) return null;
  const srt = await srtRes.text();

  return parseSrt(srt);
}
