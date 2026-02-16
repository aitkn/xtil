import { detectExtractor } from '@/lib/extractors/detector';
import { extractComments } from '@/lib/extractors/comments';
import { isFacebookPostContext, extractVisibleComments } from '@/lib/extractors/facebook';
import type { ExtractedContent } from '@/lib/extractors/types';
import type { ExtractResultMessage, Message } from '@/lib/messaging/types';

export default defineContentScript({
  matches: ['<all_urls>'],

  main() {
    const chromeRuntime = (globalThis as unknown as { chrome: { runtime: typeof chrome.runtime } }).chrome.runtime;

    // Watch for Facebook post modals appearing/changing → notify sidepanel
    if (/(^|\.)facebook\.com$/.test(window.location.hostname)) {
      let lastModalHeading = '';
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;

      const observer = new MutationObserver(() => {
        if (debounceTimer) return; // debounce — skip if a check is already scheduled
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          const headings = document.querySelectorAll('h2');
          let currentHeading = '';
          for (const h of headings) {
            const text = h.textContent?.trim() || '';
            if (/'.?s Post$/.test(text)) {
              currentHeading = text;
              break;
            }
          }
          if (currentHeading && currentHeading !== lastModalHeading) {
            lastModalHeading = currentHeading;
            chromeRuntime.sendMessage({ type: 'CONTENT_CHANGED' }).catch(() => {});
          } else if (!currentHeading && lastModalHeading) {
            lastModalHeading = '';
          }
        }, 500);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    chromeRuntime.onMessage.addListener(
      (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => {
        if (sender.id !== chromeRuntime.id) {
          sendResponse({ success: false, error: 'Unauthorized sender' });
          return;
        }
        const msg = message as { type: string; videoId?: string; hintLang?: string; langPrefs?: string[]; summaryLang?: string };
        if (msg.type === 'EXTRACT_CONTENT') {
          extractAndResolve(msg.langPrefs, msg.summaryLang)
            .then((content) => {
              sendResponse({ type: 'EXTRACT_RESULT', success: true, data: content } as ExtractResultMessage);
            })
            .catch((err) => {
              sendResponse({
                type: 'EXTRACT_RESULT',
                success: false,
                error: err instanceof Error ? err.message : String(err),
              } as ExtractResultMessage);
            });
          return true;
        }

        if (msg.type === 'EXTRACT_COMMENTS') {
          const url = window.location.href;
          const comments = isFacebookPostContext(url, document)
            ? extractVisibleComments(document)
            : extractComments(document, url);
          sendResponse({ success: true, comments });
          return true;
        }

        if (msg.type === 'SEEK_VIDEO') {
          const video = document.querySelector('video');
          if (video) {
            video.currentTime = (msg as { seconds: number }).seconds;
            video.play().catch(() => {});
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'No video element found' });
          }
          return;
        }

        if (msg.type === 'FETCH_TRANSCRIPT') {
          fetchYouTubeTranscript(msg.videoId!, msg.hintLang)
            .then((transcript) => sendResponse({ success: true, transcript }))
            .catch((err) => sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) }));
          return true;
        }
      },
    );
  },
});

async function extractAndResolve(langPrefs?: string[], summaryLang?: string): Promise<ExtractedContent> {
  const extractor = detectExtractor(window.location.href, document);
  const content = extractor.extract(window.location.href, document);

  const comments = extractComments(document, window.location.href);
  if (comments.length > 0) {
    content.comments = comments;
  }

  // Extract visible Facebook comments (synchronous — no loading delay)
  if (isFacebookPostContext(window.location.href, document)) {
    const fbComments = extractVisibleComments(document);
    if (fbComments.length > 0) {
      content.comments = fbComments;
      content.content += `\n\n## Comments (${fbComments.length})\n\n`;
      for (const c of fbComments) {
        const reactionStr = c.likes ? ` (${c.likes} reactions)` : '';
        content.content += `**${c.author || 'Unknown'}**${reactionStr}\n${c.text}\n\n`;
      }
      content.wordCount = content.content.split(/\s+/).filter(Boolean).length;
    }
  }

  // Resolve YouTube transcript inline so the sidepanel knows immediately
  const marker = '[YOUTUBE_TRANSCRIPT:';
  const markerIndex = content.content.indexOf(marker);
  if (markerIndex !== -1) {
    const endIndex = content.content.indexOf(']', markerIndex + marker.length);
    if (endIndex !== -1) {
      const markerBody = content.content.slice(markerIndex + marker.length, endIndex);
      const parts = markerBody.split(':');
      const videoId = parts[0];
      const hintLang = parts[1];

      try {
        const transcript = await fetchYouTubeTranscript(videoId, hintLang, langPrefs, summaryLang);
        content.content = content.content.replace(
          /\[Transcript available - fetching\.\.\.\]\n\n\[YOUTUBE_TRANSCRIPT:[^\]]+\]/,
          transcript,
        );
        content.wordCount = content.content.split(/\s+/).filter(Boolean).length;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        content.content = content.content.replace(
          /\[Transcript available - fetching\.\.\.\]\n\n\[YOUTUBE_TRANSCRIPT:[^\]]+\]/,
          `*Transcript could not be loaded: ${errMsg}*`,
        );
      }
    }
  }

  return content;
}

// --- Language family constants for closeness heuristic ---
const LATIN_LANGS = ['en', 'es', 'fr', 'de', 'pt'];
const SLAVIC_LANGS = ['ru'];
const CJK_LANGS = ['zh', 'ja', 'ko'];
// Popularity order for final tiebreaking
const POPULARITY_ORDER = ['en', 'es', 'fr', 'de', 'pt', 'ru', 'zh', 'ja', 'ko'];

type CaptionTrack = {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  name?: { simpleText?: string };
};

function langFamily(code: string): 'latin' | 'slavic' | 'cjk' | 'other' {
  const base = code.split('-')[0].toLowerCase();
  if (LATIN_LANGS.includes(base)) return 'latin';
  if (SLAVIC_LANGS.includes(base)) return 'slavic';
  if (CJK_LANGS.includes(base)) return 'cjk';
  return 'other';
}

function familyDistance(a: string, b: string): number {
  const fa = langFamily(a);
  const fb = langFamily(b);
  if (fa === fb) return 0;
  if (fa === 'other' || fb === 'other') return 2;
  // Latin ↔ Slavic = 1, either ↔ CJK = 2
  if ((fa === 'latin' && fb === 'slavic') || (fa === 'slavic' && fb === 'latin')) return 1;
  return 2;
}

function popularityRank(code: string): number {
  const base = code.split('-')[0].toLowerCase();
  const idx = POPULARITY_ORDER.indexOf(base);
  return idx >= 0 ? idx : POPULARITY_ORDER.length;
}

/**
 * Pick the best caption track based on user language preferences.
 *
 * Algorithm:
 * 1. Filter to tracks matching langPrefs (languages user understands)
 * 2. Tiebreak: prefer video's original language, then summaryLang, then closeness/popularity
 * 3. Within chosen language, prefer manual (non-ASR) over auto-generated
 * 4. Fallback: YouTube's default track, then first manual, then first
 */
function pickBestTrack(
  tracks: CaptionTrack[],
  langPrefs?: string[],
  summaryLang?: string,
  originalLang?: string,
  defaultTrackIndex?: number,
): CaptionTrack {
  if (tracks.length === 1) return tracks[0];

  // Normalize lang codes to base (e.g. "en-US" → "en")
  const baseCode = (c: string) => c.split('-')[0].toLowerCase();

  // Step 1: filter to tracks matching langPrefs
  if (langPrefs?.length) {
    const prefBases = new Set(langPrefs.map(baseCode));
    const matched = tracks.filter(t => prefBases.has(baseCode(t.languageCode)));

    if (matched.length === 1) {
      // Single match — prefer manual within it
      return preferManual(matched);
    }

    if (matched.length > 1) {
      // Step 2: tiebreak multiple matches
      // Group by base language code
      const byLang = new Map<string, CaptionTrack[]>();
      for (const t of matched) {
        const b = baseCode(t.languageCode);
        if (!byLang.has(b)) byLang.set(b, []);
        byLang.get(b)!.push(t);
      }
      const langCodes = [...byLang.keys()];

      // Prefer video's original language
      if (originalLang && langCodes.includes(baseCode(originalLang))) {
        return preferManual(byLang.get(baseCode(originalLang))!);
      }
      // Prefer summaryLang
      if (summaryLang && summaryLang !== 'auto' && langCodes.includes(baseCode(summaryLang))) {
        return preferManual(byLang.get(baseCode(summaryLang))!);
      }
      // Closeness to summaryLang, then popularity
      const refLang = (summaryLang && summaryLang !== 'auto') ? summaryLang : 'en';
      langCodes.sort((a, b) => {
        const distDiff = familyDistance(a, refLang) - familyDistance(b, refLang);
        if (distDiff !== 0) return distDiff;
        return popularityRank(a) - popularityRank(b);
      });
      return preferManual(byLang.get(langCodes[0])!);
    }
  }

  // Step 4: no langPrefs match — fallback
  // YouTube's default track index
  if (defaultTrackIndex != null && defaultTrackIndex >= 0 && defaultTrackIndex < tracks.length) {
    return tracks[defaultTrackIndex];
  }
  // First manual track, then first track
  return preferManual(tracks);
}

/** Within a set of tracks, prefer manual (non-ASR) over auto-generated. */
function preferManual(tracks: CaptionTrack[]): CaptionTrack {
  return tracks.find(t => t.kind !== 'asr') || tracks[0];
}

async function fetchYouTubeTranscript(
  videoId: string,
  hintLang?: string,
  langPrefs?: string[],
  summaryLang?: string,
): Promise<string> {
  // Use ANDROID innertube client from page context.
  // - ANDROID client bypasses age-restriction checks
  // - Page context provides YouTube cookies (avoids 403 from service worker)
  // - Returns fresh caption URLs (unlike ytInitialPlayerResponse which has expired tokens)
  //
  // This is YouTube's public Innertube API key, embedded in YouTube's own frontend JS.
  // It is not a private credential — it is shipped to every YouTube visitor.
  // nosemgrep: generic-api-key
  const YOUTUBE_INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'; // gitleaks:allow
  const playerResponse = await fetch(
    `https://www.youtube.com/youtubei/v1/player?key=${YOUTUBE_INNERTUBE_KEY}&prettyPrint=false`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '19.02.39',
            androidSdkVersion: 34,
            hl: hintLang || 'en',
          },
        },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      }),
    },
  );

  if (!playerResponse.ok) throw new Error(`Innertube API: ${playerResponse.status}`);

  const data = await playerResponse.json();
  const captionsRenderer = data?.captions?.playerCaptionsTracklistRenderer;
  const tracks: CaptionTrack[] = captionsRenderer?.captionTracks;
  if (!tracks || tracks.length === 0) throw new Error('No caption tracks available');

  // Extract original language and YouTube's default track index
  const originalLang: string | undefined = data?.videoDetails?.defaultAudioLanguage;
  const defaultTrackIndex: number | undefined = captionsRenderer?.audioTracks?.[0]?.defaultCaptionTrackIndex;

  const track = pickBestTrack(tracks, langPrefs, summaryLang, originalLang, defaultTrackIndex);

  let captionUrl: string = track.baseUrl;
  if (!captionUrl.includes('fmt=')) {
    captionUrl += (captionUrl.includes('?') ? '&' : '?') + 'fmt=srv3';
  }

  const captionResponse = await fetch(captionUrl);
  if (!captionResponse.ok) throw new Error(`Caption fetch: ${captionResponse.status}`);

  const xml = await captionResponse.text();
  const transcript = parseTranscriptXml(xml);
  if (!transcript) throw new Error('Empty transcript');
  return transcript;
}

function parseTranscriptXml(xml: string): string {
  const segments: string[] = [];

  // 1. Standard format: <text start="..." dur="...">words</text>
  const textMatches = xml.matchAll(/<text([^>]*)>([\s\S]*?)<\/text>/g);
  for (const match of textMatches) {
    const attrs = match[1];
    const text = decodeXmlEntities(match[2]).trim();
    if (!text) continue;
    const startSec = parseFloat(attrs.match(/start="([^"]+)"/)?.[1] ?? '');
    segments.push(isNaN(startSec) ? text : `[${formatTimestamp(startSec)}] ${text}`);
  }
  if (segments.length > 0) return segments.join('\n');

  // 2. SRV3 format: <p t="..." d="..."><s>word</s>...</p>  (t is in ms)
  const pMatches = xml.matchAll(/<p([^>]*)>([\s\S]*?)<\/p>/g);
  for (const match of pMatches) {
    const attrs = match[1];
    const inner = match[2];
    const sMatches = inner.matchAll(/<s[^>]*>([^<]*)<\/s>/g);
    const words: string[] = [];
    for (const s of sMatches) {
      const w = decodeXmlEntities(s[1]);
      if (w) words.push(w);
    }
    let text: string;
    if (words.length > 0) {
      text = words.join('').trim();
    } else {
      text = decodeXmlEntities(inner.replace(/<[^>]+>/g, '')).trim();
    }
    if (!text) continue;
    const tMs = parseInt(attrs.match(/t="([^"]+)"/)?.[1] ?? '', 10);
    segments.push(isNaN(tMs) ? text : `[${formatTimestamp(tMs / 1000)}] ${text}`);
  }
  if (segments.length > 0) return segments.join('\n');

  // 3. Flat <s> elements (rare fallback — no timestamps available)
  const segMatches = xml.matchAll(/<s[^>]*>([\s\S]*?)<\/s>/g);
  for (const match of segMatches) {
    const text = decodeXmlEntities(match[1]).trim();
    if (text) segments.push(text);
  }

  return segments.join(' ');
}

function formatTimestamp(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n/g, ' ');
}
