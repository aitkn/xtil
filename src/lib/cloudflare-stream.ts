/**
 * Cloudflare Stream transcript extraction via HLS manifest.
 *
 * Flow: detect CF Stream iframe -> fetch HLS manifest -> parse subtitle tracks
 *     -> pick best language -> fetch subtitle playlist -> fetch VTT -> parse
 *
 * All URLs are publicly accessible (no auth needed). The manifest exposes
 * signed VTT URLs in the subtitle playlist.
 */
import { pickBestTrack, parseVtt, type CaptionTrack } from './transcript-lang';

const CF_STREAM_IFRAME_RE = /(?:iframe\.cloudflarestream\.com|iframe\.videodelivery\.net|customer-[a-z0-9]+\.cloudflarestream\.com)\/([a-f0-9]{32})/;

/**
 * Detect a Cloudflare Stream video embedded on the page.
 * Returns the video ID if found, null otherwise.
 */
export function detectCloudflareStreamVideo(doc: Document): string | null {
  const iframes = doc.querySelectorAll('iframe[src*="cloudflarestream.com"], iframe[src*="videodelivery.net"]');
  for (const iframe of iframes) {
    const src = iframe.getAttribute('src') || '';
    const match = src.match(CF_STREAM_IFRAME_RE);
    if (match) return match[1];
  }
  return null;
}

/**
 * Fetch transcript from a Cloudflare Stream video via its HLS manifest.
 */
export async function fetchCloudflareStreamTranscript(
  videoId: string,
  langPrefs?: string[],
  summaryLang?: string,
): Promise<string | null> {
  const baseUrl = `https://cloudflarestream.com/${videoId}`;

  // Step 1: Fetch HLS manifest
  const manifestRes = await fetch(`${baseUrl}/manifest/video.m3u8`);
  if (!manifestRes.ok) return null;
  const manifest = await manifestRes.text();

  // Step 2: Parse subtitle tracks from manifest
  const subtitleTracks = parseHlsSubtitleTracks(manifest);
  if (subtitleTracks.length === 0) return null;

  // Step 3: Pick best track using the same language resolution as YouTube
  const best = pickBestTrack(subtitleTracks, langPrefs, summaryLang);

  // Step 4: Fetch the subtitle playlist to get the signed VTT URL
  const playlistRes = await fetch(`${baseUrl}/manifest/${best.baseUrl}`);
  if (!playlistRes.ok) return null;
  const playlist = await playlistRes.text();

  // Step 5: Extract VTT URL from playlist (relative path starts with ../../)
  const vttRelPath = playlist.split('\n').find(line => line.trim() && !line.startsWith('#'));
  if (!vttRelPath) return null;
  const vttUrl = `https://cloudflarestream.com/${vttRelPath.trim().replace(/^(\.\.\/)+/, '')}`;

  // Step 6: Fetch and parse VTT
  const vttRes = await fetch(vttUrl);
  if (!vttRes.ok) return null;
  const vtt = await vttRes.text();

  return parseVtt(vtt);
}

/**
 * Parse #EXT-X-MEDIA:TYPE=SUBTITLES entries from HLS manifest into CaptionTrack format.
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
