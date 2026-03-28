/**
 * JW Player transcript extraction.
 *
 * JW Player manages captions via its own JavaScript API, not standard HTML5
 * <track> elements. Captions are SRT files hosted at cdn.jwplayer.com/tracks/.
 *
 * Since the content script runs in the isolated world, we can't call
 * `window.jwplayer()`. Instead we:
 * 1. Detect JW Player by its DOM structure (`.jw-media` container with <video>)
 * 2. Extract the media ID from page scripts or CDN URLs in the DOM
 * 3. Fetch track metadata from the public JW Platform API:
 *    https://cdn.jwplayer.com/v2/media/{mediaId}
 * 4. Pick the best caption track and fetch/parse the SRT
 */
import { pickBestTrack, parseSrt, parseVtt, type CaptionTrack } from './transcript-lang';

/**
 * Detect a JW Player video on the page and return its media ID.
 * Returns null if no JW Player video is found.
 */
export function detectJwPlayer(doc: Document): string | null {
  // Must have a JW Player video container
  if (!doc.querySelector('.jw-media video')) return null;

  return extractJwMediaId(doc);
}

/**
 * Extract the JW Player media ID from the page.
 *
 * Common patterns:
 * - Inline script: `jwplatform.com/players/{mediaId}-{playerId}.js`
 * - CDN URLs: `cdn.jwplayer.com/manifests/{mediaId}.m3u8`
 * - CDN URLs: `cdn.jwplayer.com/videos/{mediaId}-...`
 * - CDN URLs: `cdn.jwplayer.com/v2/media/{mediaId}`
 * - Player div ID: `botr_{mediaId}_{playerId}_div`
 */
function extractJwMediaId(doc: Document): string | null {
  const html = doc.documentElement.innerHTML;

  // Pattern 1: jwplatform.com/players/{mediaId}-{playerId}.js
  const platformRe = /jwplatform\.com\/players\/([a-zA-Z0-9]{8})-/;
  const platformMatch = html.match(platformRe);
  if (platformMatch) return platformMatch[1];

  // Pattern 2: cdn.jwplayer.com/manifests/{mediaId} or /v2/media/{mediaId} or /videos/{mediaId}
  const cdnRe = /cdn\.jwplayer\.com\/(?:manifests|v2\/media|videos)\/([a-zA-Z0-9]{8})/;
  const cdnMatch = html.match(cdnRe);
  if (cdnMatch) return cdnMatch[1];

  // Pattern 3: botr_{mediaId}_{playerId}_div
  const botrRe = /botr_([a-zA-Z0-9]{8})_[a-zA-Z0-9]{8}_div/;
  const botrMatch = html.match(botrRe);
  if (botrMatch) return botrMatch[1];

  return null;
}

/**
 * Map common language labels to ISO 639-1 codes.
 * JW Player uses full English names ("English", "French", etc.) as labels.
 */
function jwLabelToLangCode(label: string): string {
  const normalized = label.toLowerCase().trim();
  const map: Record<string, string> = {
    english: 'en',
    french: 'fr',
    german: 'de',
    spanish: 'es',
    portuguese: 'pt',
    italian: 'it',
    dutch: 'nl',
    russian: 'ru',
    japanese: 'ja',
    korean: 'ko',
    chinese: 'zh',
    arabic: 'ar',
    hindi: 'hi',
    turkish: 'tr',
    polish: 'pl',
    swedish: 'sv',
    norwegian: 'no',
    danish: 'da',
    finnish: 'fi',
    czech: 'cs',
    hungarian: 'hu',
    romanian: 'ro',
    thai: 'th',
    vietnamese: 'vi',
    indonesian: 'id',
    malay: 'ms',
    hebrew: 'he',
    ukrainian: 'uk',
    greek: 'el',
  };
  return map[normalized] || 'en';
}

/**
 * Fetch transcript from a JW Player video via the public JW Platform API.
 */
export async function fetchJwPlayerTranscript(
  mediaId: string,
  langPrefs?: string[],
  summaryLang?: string,
): Promise<string | null> {
  // Step 1: Fetch media metadata from JW Platform API
  const metaRes = await fetch(`https://cdn.jwplayer.com/v2/media/${mediaId}`);
  if (!metaRes.ok) return null;
  const meta = await metaRes.json();

  // Step 2: Extract caption tracks from playlist item
  const item = meta?.playlist?.[0];
  if (!item?.tracks) return null;

  const captionTracks: CaptionTrack[] = item.tracks
    .filter((t: any) => t.kind === 'captions' && t.file)
    .map((t: any) => ({
      baseUrl: t.file,
      languageCode: jwLabelToLangCode(t.label || ''),
      name: t.label ? { simpleText: t.label } : undefined,
    }));

  if (captionTracks.length === 0) return null;

  // Step 3: Pick best track using shared language selection
  const best = pickBestTrack(captionTracks, langPrefs, summaryLang);

  // Step 4: Fetch and parse the caption file (SRT or VTT)
  const res = await fetch(best.baseUrl);
  if (!res.ok) return null;
  const text = await res.text();

  if (text.trimStart().startsWith('WEBVTT')) return parseVtt(text);
  return parseSrt(text);
}
