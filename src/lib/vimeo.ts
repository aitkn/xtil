/**
 * Vimeo transcript extraction via player config API.
 *
 * Flow: detect Vimeo embed/page -> fetch player config -> pick best text track
 *     -> fetch signed VTT -> parse
 *
 * Config endpoint: https://player.vimeo.com/video/{id}/config
 * For unlisted videos: append ?h={hash} (from iframe src or share URL)
 * VTT URLs are signed with expiry (~1hr) and served with ACAO: *.
 */
import { pickBestTrack, parseVtt, type CaptionTrack } from './transcript-lang';

const VIMEO_PAGE_RE = /vimeo\.com\/(?:channels\/\w+\/|groups\/\w+\/videos\/)?(\d+)/;
const VIMEO_IFRAME_RE = /player\.vimeo\.com\/video\/(\d+)(?:\?.*?h=([a-f0-9]+))?/;

/**
 * Detect a Vimeo video on the page.
 * Returns { videoId, hash? } if found, null otherwise.
 */
export function detectVimeoVideo(url: string, doc: Document): { videoId: string; hash?: string } | null {
  // On vimeo.com itself
  const pageMatch = url.match(VIMEO_PAGE_RE);
  if (pageMatch) {
    // Try to get hash from the player iframe
    const iframe = doc.querySelector('iframe[src*="player.vimeo.com"]');
    const iframeSrc = iframe?.getAttribute('src') || '';
    const hash = iframeSrc.match(/[?&]h=([a-f0-9]+)/)?.[1];
    return { videoId: pageMatch[1], hash };
  }

  // Embedded on another site
  const iframes = doc.querySelectorAll('iframe[src*="player.vimeo.com"]');
  for (const iframe of iframes) {
    const src = iframe.getAttribute('src') || '';
    const match = src.match(VIMEO_IFRAME_RE);
    if (match) return { videoId: match[1], hash: match[2] };
  }

  return null;
}

/**
 * Fetch transcript from a Vimeo video via its player config.
 */
export async function fetchVimeoTranscript(
  videoId: string,
  langPrefs?: string[],
  summaryLang?: string,
  hash?: string,
): Promise<string | null> {
  // Step 1: Fetch player config
  let configUrl = `https://player.vimeo.com/video/${videoId}/config`;
  if (hash) configUrl += `?h=${hash}`;

  const configRes = await fetch(configUrl);
  if (!configRes.ok) return null;
  const config = await configRes.json();

  // Step 2: Extract text tracks
  const textTracks: Array<{ lang: string; label: string; kind: string; url: string; provenance?: string; default?: boolean }> =
    config?.request?.text_tracks || [];
  if (textTracks.length === 0) return null;

  // Step 3: Map to CaptionTrack format for shared language selection
  const captionTracks: CaptionTrack[] = textTracks.map((t, i) => ({
    baseUrl: t.url,
    languageCode: t.lang,
    kind: t.provenance === 'auto' ? 'asr' : undefined,
    name: { simpleText: t.label },
    _defaultIndex: t.default ? i : undefined,
  } as CaptionTrack & { _defaultIndex?: number }));

  const defaultIdx = textTracks.findIndex(t => t.default);
  const best = pickBestTrack(captionTracks, langPrefs, summaryLang, undefined, defaultIdx >= 0 ? defaultIdx : undefined);

  // Step 4: Fetch VTT (signed URL, ACAO: *)
  const vttRes = await fetch(best.baseUrl);
  if (!vttRes.ok) return null;
  const vtt = await vttRes.text();

  return parseVtt(vtt);
}
