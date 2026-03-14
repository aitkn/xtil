/**
 * Generic HTML5 video transcript extraction.
 *
 * Two strategies:
 * 1. <track> elements with src URLs → fetch VTT/SRT and parse
 * 2. Programmatically-added textTracks with loaded cues (e.g. X/Twitter)
 *    → read cues directly from the video.textTracks API
 *
 * Accepts an optional root element to scope the search (e.g. focal tweet on X).
 *
 * This catches any site using standard HTML5 video with subtitle tracks,
 * excluding known platforms (YouTube, Vimeo, etc.) which have dedicated extractors.
 */
import { pickBestTrack, parseVtt, parseSrt, type CaptionTrack } from './transcript-lang';

/**
 * Detect HTML5 <video> elements with caption/subtitle tracks.
 * Checks both <track> elements and dynamically-added textTracks (e.g. X/Twitter).
 * @param root - Element to search within (defaults to document)
 */
export function detectHTML5VideoWithTracks(root: Document | Element): boolean {
  const videos = root.querySelectorAll('video');
  for (const video of videos) {
    const tracks = video.querySelectorAll('track[src]');
    for (const track of tracks) {
      const kind = track.getAttribute('kind') || '';
      if (kind === 'captions' || kind === 'subtitles' || kind === '') {
        return true;
      }
    }
    for (let i = 0; i < video.textTracks.length; i++) {
      const t = video.textTracks[i];
      if ((t.kind === 'captions' || t.kind === 'subtitles') && t.cues && t.cues.length > 0) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Fetch transcript from the first HTML5 <video> with subtitle tracks.
 * Tries <track> elements first, then falls back to reading loaded cues.
 * @param root - Element to search within (defaults to document)
 */
export async function fetchHTML5VideoTranscript(
  root: Document | Element,
  langPrefs?: string[],
  summaryLang?: string,
): Promise<string | null> {
  const trackResult = await fetchFromTrackElements(root, langPrefs, summaryLang);
  if (trackResult) return trackResult;

  return readFromTextTrackCues(root, langPrefs, summaryLang);
}

/**
 * Strategy 1: Extract transcript from <track> elements with src URLs.
 */
async function fetchFromTrackElements(
  root: Document | Element,
  langPrefs?: string[],
  summaryLang?: string,
): Promise<string | null> {
  const videos = root.querySelectorAll('video');
  const captionTracks: CaptionTrack[] = [];
  const baseURI = root.ownerDocument?.baseURI ?? (root as Document).baseURI;

  for (const video of videos) {
    const tracks = video.querySelectorAll('track[src]');
    for (const track of tracks) {
      const kind = track.getAttribute('kind') || '';
      if (kind !== 'captions' && kind !== 'subtitles' && kind !== '') continue;

      const src = track.getAttribute('src');
      if (!src) continue;

      const absoluteUrl = new URL(src, baseURI).href;
      const lang = track.getAttribute('srclang') || 'en';
      const label = track.getAttribute('label') || '';

      captionTracks.push({
        baseUrl: absoluteUrl,
        languageCode: lang,
        name: label ? { simpleText: label } : undefined,
      });
    }
  }

  if (captionTracks.length === 0) return null;

  const best = pickBestTrack(captionTracks, langPrefs, summaryLang);

  const res = await fetch(best.baseUrl);
  if (!res.ok) return null;
  const text = await res.text();

  if (text.trimStart().startsWith('WEBVTT')) return parseVtt(text);
  if (/^\d+\r?\n\d{2}:\d{2}:\d{2},\d{3}/.test(text.trimStart())) return parseSrt(text);
  return parseVtt(text);
}

/**
 * Strategy 2: Read cues directly from video.textTracks (for dynamically-added tracks).
 * X/Twitter uses this: captions are added via JS with custom <X-word-ms> markup.
 *
 * X lazily loads cues as the video buffers. We enable the track and wait
 * for cues to cover the full video duration (up to 5s).
 */
async function readFromTextTrackCues(
  root: Document | Element,
  langPrefs?: string[],
  summaryLang?: string,
): Promise<string | null> {
  const videos = root.querySelectorAll('video');

  // Find the first video with subtitle/caption textTracks
  let targetVideo: HTMLVideoElement | null = null;
  let targetTrack: TextTrack | null = null;

  for (const video of videos) {
    for (let i = 0; i < video.textTracks.length; i++) {
      const t = video.textTracks[i];
      if (t.kind !== 'captions' && t.kind !== 'subtitles') continue;
      // Prefer the 'subtitles' track (X puts full cues there, 'clone' is partial)
      if (!targetTrack || (t.kind === 'subtitles' && targetTrack.kind !== 'subtitles')) {
        targetVideo = video;
        targetTrack = t;
      }
    }
  }

  if (!targetVideo || !targetTrack) return null;

  // Enable the track to trigger cue loading
  const prevMode = targetTrack.mode;
  if (targetTrack.mode === 'disabled') {
    targetTrack.mode = 'hidden';
  }

  // Wait for cues to load (X loads them progressively as video buffers)
  const duration = targetVideo.duration || 0;
  for (let attempt = 0; attempt < 10; attempt++) {
    if (targetTrack.cues && targetTrack.cues.length > 0) {
      const lastCue = targetTrack.cues[targetTrack.cues.length - 1];
      // Cues cover at least 90% of video duration — fully loaded
      if (duration <= 0 || lastCue.endTime >= duration * 0.9) break;
    }
    await new Promise(r => setTimeout(r, 500));
  }

  if (!targetTrack.cues || targetTrack.cues.length === 0) {
    targetTrack.mode = prevMode;
    return null;
  }

  // Collect all tracks, grouped by language. For each language, keep only the
  // track with the most cues (X has a 'clone' track with partial cues — skip it).
  const byLang = new Map<string, { track: CaptionTrack & { _cues: VTTCue[] }; cueCount: number }>();
  for (const video of videos) {
    for (let i = 0; i < video.textTracks.length; i++) {
      const t = video.textTracks[i];
      if (t.kind !== 'captions' && t.kind !== 'subtitles') continue;
      if (!t.cues || t.cues.length === 0) continue;

      const cues: VTTCue[] = [];
      for (let j = 0; j < t.cues.length; j++) {
        cues.push(t.cues[j] as VTTCue);
      }

      const lang = t.language || 'en';
      const existing = byLang.get(lang);
      if (!existing || cues.length > existing.cueCount) {
        byLang.set(lang, {
          track: {
            baseUrl: `texttrack:${i}`,
            languageCode: lang,
            name: t.label ? { simpleText: t.label } : undefined,
            _cues: cues,
          },
          cueCount: cues.length,
        });
      }
    }
  }

  // Restore track mode
  targetTrack.mode = prevMode;

  const captionTracks = [...byLang.values()].map(v => v.track);
  if (captionTracks.length === 0) return null;

  const best = pickBestTrack(captionTracks, langPrefs, summaryLang);
  const bestWithCues = captionTracks.find(t => t.baseUrl === best.baseUrl);
  if (!bestWithCues) return null;

  const lines: string[] = [];
  for (const cue of bestWithCues._cues) {
    // Strip XML/HTML tags (e.g. X's <X-word-ms> wrapper) and clean up
    const text = cue.text.replace(/<[^>]+>/g, '').trim();
    if (!text) continue;

    const h = Math.floor(cue.startTime / 3600);
    const m = Math.floor((cue.startTime % 3600) / 60);
    const s = Math.floor(cue.startTime % 60);
    const ts = h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;

    lines.push(`[${ts}] ${text}`);
  }

  return lines.length > 0 ? lines.join('\n') : null;
}
