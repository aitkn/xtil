import { detectExtractor } from '@/lib/extractors/detector';
import { extractComments } from '@/lib/extractors/comments';
import { isFacebookPostContext, extractVisibleComments } from '@/lib/extractors/facebook';
import type { ExtractedContent } from '@/lib/extractors/types';
import type { ExtractResultMessage, Message } from '@/lib/messaging/types';
import { pickBestTrack, type CaptionTrack } from '@/lib/transcript-lang';
import { detectCloudflareStreamVideo, fetchCloudflareStreamTranscript } from '@/lib/cloudflare-stream';
import { detectVimeoVideo, fetchVimeoTranscript } from '@/lib/vimeo';
import { detectDailymotionVideo, fetchDailymotionTranscript } from '@/lib/dailymotion';
import { detectHTML5VideoWithTracks, fetchHTML5VideoTranscript } from '@/lib/html5-video';

export default defineContentScript({
  matches: ['<all_urls>'],

  main() {
    const chromeRuntime = (globalThis as unknown as { chrome: { runtime: typeof chrome.runtime } }).chrome.runtime;

    // Guard: stop stale content scripts from looping after extension reload
    function isContextValid(): boolean {
      try { return !!chromeRuntime.id; } catch { return false; }
    }

    // Watch for Gmail email changes in reading pane → notify sidepanel
    if (window.location.hostname === 'mail.google.com') {
      let lastThreadId = '';
      let gmailDebounce: ReturnType<typeof setTimeout> | null = null;

      const checkGmailThread = () => {
        if (gmailDebounce || !isContextValid()) return;
        gmailDebounce = setTimeout(() => {
          gmailDebounce = null;
          if (!isContextValid()) return;
          const threadEl = document.querySelector('h2[data-legacy-thread-id]');
          const currentId = threadEl?.getAttribute('data-legacy-thread-id') || '';
          if (currentId && currentId !== lastThreadId) {
            lastThreadId = currentId;
            chromeRuntime.sendMessage({ type: 'CONTENT_CHANGED' }).catch(() => {});
          } else if (!currentId && lastThreadId) {
            lastThreadId = '';
          }
        }, 500);
      };

      // Gmail uses hash-based routing — detect navigation between emails
      window.addEventListener('hashchange', checkGmailThread);
      // Also watch DOM mutations for reading pane updates (split view)
      const gmailObserver = new MutationObserver(checkGmailThread);
      gmailObserver.observe(document.body, { childList: true, subtree: true });
    }

    // Watch for Facebook post modals appearing/changing → notify sidepanel
    if (/(^|\.)facebook\.com$/.test(window.location.hostname)) {
      let lastModalHeading = '';
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;

      const observer = new MutationObserver(() => {
        if (debounceTimer || !isContextValid()) return;
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          if (!isContextValid()) return;
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

    // Generic activity detection: scroll/click → metadata refresh after 2s of inactivity
    {
      let activityTimer: ReturnType<typeof setTimeout> | null = null;
      const onActivity = () => {
        if (!isContextValid()) return;
        if (activityTimer) clearTimeout(activityTimer);
        activityTimer = setTimeout(() => {
          activityTimer = null;
          if (!isContextValid()) return;
          chromeRuntime.sendMessage({ type: 'CONTENT_ACTIVITY' }).catch(() => {});
        }, 1000);
      };
      window.addEventListener('scroll', onActivity, { passive: true });
      document.addEventListener('click', onActivity);
    }

    chromeRuntime.onMessage.addListener(
      (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => {
        if (sender.id !== chromeRuntime.id) {
          sendResponse({ success: false, error: 'Unauthorized sender' });
          return;
        }
        const msg = message as { type: string; videoId?: string; hintLang?: string; langPrefs?: string[]; summaryLang?: string; readonly?: boolean; refresh?: boolean };
        if (msg.type === 'EXTRACT_CONTENT') {
          if (msg.refresh) {
            // User clicked Refresh — clear all caches for a fresh extraction
            transcriptCache.clear();
            transcriptFailCache.clear();
            bridgeAvailable = true;
          }
          extractAndResolve(msg.langPrefs, msg.summaryLang, msg.readonly)
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

async function extractAndResolve(langPrefs?: string[], summaryLang?: string, readonly?: boolean): Promise<ExtractedContent> {
  const extractor = detectExtractor(window.location.href, document);
  const content = extractor.extract(window.location.href, document, readonly ? { readonly: true } : undefined);

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

  // Resolve video transcript from embedded players (non-YouTube)
  if (content.type !== 'youtube') {
    const transcript = await fetchEmbeddedVideoTranscript(document, window.location.href, langPrefs, summaryLang);
    if (transcript) {
      content.transcriptWordCount = transcript.split(/\s+/).filter(Boolean).length;
      content.content += `\n\n## Transcript\n\n${transcript}`;
      content.wordCount = content.content.split(/\s+/).filter(Boolean).length;
    }
  }

  return content;
}

/**
 * Send a bridge request via postMessage and wait for a typed response.
 * Returns null if the bridge is unavailable (e.g., MAIN world not supported).
 */
/**
 * Filter out invisible/stale video elements from a root.
 * X/Twitter keeps old video elements in the DOM after SPA navigation.
 * Returns a wrapper element containing only visible videos, or the
 * original root if no filtering is needed.
 */
function findVideoRoot(doc: Document, _url: string): Document | Element {
  // Only filter on X/Twitter where stale SPA videos are a problem
  if (!/(twitter\.com|x\.com)/.test(doc.location?.hostname || '')) return doc;

  // Find the video that's actually visible in the viewport
  const videos = doc.querySelectorAll('video');
  for (const video of videos) {
    const rect = video.getBoundingClientRect();
    // Must have non-zero dimensions and be at least partially in viewport
    if (rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight) {
      // Scope to this video's closest article (tweet container)
      const article = video.closest('article');
      if (article) return article;
    }
  }

  // No visible video — return empty element
  return doc.createElement('div');
}

/**
 * Try to extract a transcript from an embedded video player on the page.
 * Checks: Cloudflare Stream, Vimeo, Dailymotion, then generic HTML5 <video>.
 * Returns null if no supported video or no captions found.
 */
async function fetchEmbeddedVideoTranscript(
  doc: Document,
  url: string,
  langPrefs?: string[],
  summaryLang?: string,
): Promise<string | null> {
  // Cloudflare Stream
  const cfVideoId = detectCloudflareStreamVideo(doc);
  if (cfVideoId) {
    try {
      const t = await fetchCloudflareStreamTranscript(cfVideoId, langPrefs, summaryLang);
      if (t) return t;
    } catch { /* fall through */ }
  }

  // Vimeo
  const vimeo = detectVimeoVideo(url, doc);
  if (vimeo) {
    try {
      const t = await fetchVimeoTranscript(vimeo.videoId, langPrefs, summaryLang, vimeo.hash);
      if (t) return t;
    } catch { /* fall through */ }
  }

  // Dailymotion
  const dmVideoId = detectDailymotionVideo(url, doc);
  if (dmVideoId) {
    try {
      const t = await fetchDailymotionTranscript(dmVideoId, langPrefs, summaryLang);
      if (t) return t;
    } catch { /* fall through */ }
  }

  // Generic HTML5 <video> with <track> elements (last — catches everything else)
  // On X/Twitter, scope to the focal tweet's article to avoid picking up other videos
  const videoRoot = findVideoRoot(doc, url);
  if (detectHTML5VideoWithTracks(videoRoot)) {
    try {
      const t = await fetchHTML5VideoTranscript(videoRoot, langPrefs, summaryLang);
      if (t) return t;
    } catch { /* fall through */ }
  }

  return null;
}

let bridgeAvailable = true; // false after first timeout — skip bridge on subsequent calls
function bridgeRequest<T>(
  requestType: string,
  responseType: string,
  payload: Record<string, unknown>,
): Promise<T | null> {
  if (!bridgeAvailable) return Promise.resolve(null);
  return new Promise<T | null>((resolve) => {
    const requestId = `xtil_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const timeout = setTimeout(() => {
      window.removeEventListener('message', handler);
      bridgeAvailable = false;
      console.warn('[xTil] Bridge unavailable (MAIN world not supported?) — using direct API');
      resolve(null);
    }, 5000);

    function handler(event: MessageEvent) {
      if (event.source !== window) return;
      if (event.data?.type !== responseType) return;
      if (event.data.requestId !== requestId) return;

      window.removeEventListener('message', handler);
      clearTimeout(timeout);

      if (event.data.error) resolve(null); // fall through to direct method
      else resolve(event.data as T);
    }

    window.addEventListener('message', handler);
    window.postMessage({ type: requestType, requestId, ...payload }, window.location.origin);
  });
}

// This is YouTube's public Innertube API key, embedded in YouTube's own frontend JS.
// It is not a private credential — it is shipped to every YouTube visitor.
// nosemgrep: generic-api-key
const YOUTUBE_INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'; // gitleaks:allow

/**
 * Extract ytInitialPlayerResponse from the page's <script> tags.
 * Works from the isolated world — no MAIN world access needed.
 */
function extractPlayerFromDOM(videoId: string): Record<string, unknown> | null {
  for (const script of document.querySelectorAll('script')) {
    const text = script.textContent || '';
    const match = text.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});\s*(?:var\s|let\s|const\s|<\/script>|$)/s);
    if (match) {
      try {
        const data = JSON.parse(match[1]);
        const vid = data?.videoDetails?.videoId;
        if (vid === videoId) return data;
      } catch { /* parse failed */ }
    }
  }
  return null;
}

/**
 * Fetch player data: try MAIN-world bridge first, then DOM extraction, then direct API.
 */
async function fetchPlayerData(videoId: string, hintLang?: string) {
  // Try bridge (MAIN world — has YouTube cookies/session)
  const resp = await bridgeRequest<{ data: Record<string, unknown> }>(
    'XTIL_PLAYER_REQUEST', 'XTIL_PLAYER_RESPONSE', { videoId, hintLang },
  );
  if (resp?.data) {
    const tracks = (resp.data as any)?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (tracks?.length > 0) return resp.data;
  }

  // Fallback 1: extract from page HTML (works without MAIN world)
  const domData = extractPlayerFromDOM(videoId);
  if (domData) {
    const tracks = (domData as any)?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (tracks?.length > 0) return domData;
  }

  // Fallback 2: direct innertube API from content script (with cookies)
  // Use page origin (works on both www.youtube.com and m.youtube.com)
  const ytOrigin = window.location.origin;
  const playerResponse = await fetch(
    `${ytOrigin}/youtubei/v1/player?key=${YOUTUBE_INNERTUBE_KEY}&prettyPrint=false`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion: '2.20240101.00.00', hl: hintLang || 'en' } },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      }),
    },
  );
  if (!playerResponse.ok) throw new Error(`Innertube API: ${playerResponse.status}`);
  return playerResponse.json();
}

/**
 * Fetch transcript: try bridge first, fall back to direct timedtext URL fetch.
 */
async function fetchTranscriptViaBridge(videoId: string, langCode?: string, captionBaseUrl?: string): Promise<string> {
  // Try bridge
  const resp = await bridgeRequest<{ text: string }>(
    'XTIL_TRANSCRIPT_REQUEST', 'XTIL_TRANSCRIPT_RESPONSE', { videoId, langCode },
  );
  if (resp?.text) return resp.text;

  // Fallback: fetch timedtext URL directly from content script
  if (captionBaseUrl) {
    let url = captionBaseUrl;
    if (!url.includes('fmt=')) url += (url.includes('?') ? '&' : '?') + 'fmt=srv3';
    const res = await fetch(url, { credentials: 'include' });
    if (res.ok) {
      const text = await res.text();
      if (text.length > 0) return text;
    }
  }

  throw new Error('No transcript available');
}

// Per-video transcript cache to avoid redundant fetches (successes AND failures)
const transcriptCache = new Map<string, string>();
const transcriptFailCache = new Map<string, { error: string; time: number }>();
const transcriptInFlight = new Map<string, Promise<string>>(); // dedup parallel calls
const FAIL_CACHE_TTL = 60_000; // don't retry failed transcripts for 60s

async function fetchYouTubeTranscript(
  videoId: string,
  hintLang?: string,
  langPrefs?: string[],
  summaryLang?: string,
): Promise<string> {
  // Return cached transcript if we already fetched for this video
  const cached = transcriptCache.get(videoId);
  if (cached) return cached;

  // Don't retry recently failed transcripts
  const failEntry = transcriptFailCache.get(videoId);
  if (failEntry && Date.now() - failEntry.time < FAIL_CACHE_TTL) {
    throw new Error(failEntry.error);
  }

  // Dedup: if a fetch is already in progress for this video, wait for it
  const inFlight = transcriptInFlight.get(videoId);
  if (inFlight) return inFlight;

  const promise = fetchYouTubeTranscriptImpl(videoId, hintLang, langPrefs, summaryLang);
  transcriptInFlight.set(videoId, promise);
  try {
    return await promise;
  } finally {
    transcriptInFlight.delete(videoId);
  }
}

async function fetchYouTubeTranscriptImpl(
  videoId: string,
  hintLang?: string,
  langPrefs?: string[],
  summaryLang?: string,
): Promise<string> {
  // Step 1: Try fast local extraction first (no network, no errors in console)
  const embedded = extractTranscriptFromPageData();
  if (embedded) {
    transcriptCache.set(videoId, embedded);
    return embedded;
  }
  const domTranscript = scrapeTranscriptFromDOM();
  if (domTranscript) {
    transcriptCache.set(videoId, domTranscript);
    return domTranscript;
  }

  // Step 2: Get player data to find available caption tracks & pick best language
  let data: Record<string, unknown> | undefined;
  let tracks: CaptionTrack[] | undefined;
  let originalLang: string | undefined;
  let lastError: unknown;

  for (const delay of [0, 500, 1500, 3000]) {
    if (delay > 0) await new Promise(r => setTimeout(r, delay));
    try {
      data = await fetchPlayerData(videoId, hintLang);
      tracks = (data as any)?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      originalLang = (data as any)?.videoDetails?.defaultAudioLanguage;
      if (tracks && tracks.length > 0) break;
    } catch (err) {
      lastError = err;
    }
  }

  // Step 3: Pick best language from available tracks
  let targetLang: string | undefined;
  let captionBaseUrl: string | undefined;
  if (tracks && tracks.length > 0) {
    const defaultTrackIndex = (data as any)?.captions?.playerCaptionsTracklistRenderer?.audioTracks?.[0]?.defaultCaptionTrackIndex;
    const best = pickBestTrack(tracks, langPrefs, summaryLang, originalLang, defaultTrackIndex);
    targetLang = best.languageCode;
    captionBaseUrl = best.baseUrl;
  }

  // Step 4: Fetch transcript via bridge, with direct URL fallback
  try {
    const raw = await fetchTranscriptViaBridge(videoId, targetLang, captionBaseUrl);
    if (raw) {
      // Parse XML/SRV3 format into timestamped text
      const parsed = parseTranscriptXml(raw);
      const transcript = parsed || raw; // fallback to raw if parsing fails
      transcriptCache.set(videoId, transcript);
      return transcript;
    }
  } catch {
    // Expected — bridge/timedtext unavailable for this video
  }

  // Step 5: Last resort — trigger YouTube's "Show transcript" UI and scrape DOM.
  // Works for is_servable=false videos where all API methods fail.
  try {
    const triggered = await triggerAndScrapeTranscript();
    if (triggered) {
      transcriptCache.set(videoId, triggered);
      return triggered;
    }
  } catch {
    // Expected fallback
  }

  const errorMsg = lastError instanceof Error ? lastError.message : 'No transcript available';
  transcriptFailCache.set(videoId, { error: errorMsg, time: Date.now() });
  throw lastError ?? new Error('No transcript available');
}

/**
 * Extract transcript from ytInitialData embedded in <script> tags.
 * YouTube embeds transcript segments in engagement panels even when
 * captions are is_servable=false (timedtext returns empty, get_transcript 400s).
 */
function extractTranscriptFromPageData(): string | null {
  for (const script of document.querySelectorAll('script')) {
    const text = script.textContent || '';
    const match = text.match(/ytInitialData\s*=\s*(\{.+?\});\s*(?:var\s|let\s|const\s|window\[|<\/script>|$)/s);
    if (!match) continue;

    let data: any;
    try { data = JSON.parse(match[1]); } catch { continue; }

    const panels = data?.engagementPanels;
    if (!panels) continue;

    for (const panel of panels) {
      const renderer = panel?.engagementPanelSectionListRenderer;
      if (renderer?.panelIdentifier !== 'engagement-panel-searchable-transcript') continue;

      const segmentList =
        renderer.content?.transcriptRenderer?.content?.transcriptSearchPanelRenderer
          ?.body?.transcriptSegmentListRenderer ??
        renderer.content?.transcriptRenderer?.body?.transcriptBodyRenderer;
      const segments = segmentList?.initialSegments ?? segmentList?.cueGroups;
      if (!segments?.length) continue;

      const lines: string[] = [];
      for (const seg of segments) {
        const sr = seg.transcriptSegmentRenderer;
        if (sr) {
          const segText = sr.snippet?.runs?.map((r: any) => r.text).join('')
            ?? sr.snippet?.simpleText ?? '';
          const clean = segText.replace(/\n/g, ' ').trim();
          if (!clean) continue;
          const startMs = parseInt(sr.startMs || '0', 10);
          lines.push(`[${formatTimestamp(startMs / 1000)}] ${clean}`);
          continue;
        }
        const cg = seg.transcriptCueGroupRenderer;
        if (cg?.cues) {
          for (const cue of cg.cues) {
            const cr = cue.transcriptCueRenderer;
            if (!cr) continue;
            const cueText = (cr.cue?.simpleText ?? '').trim();
            if (!cueText) continue;
            const startMs = parseInt(cr.startOffsetMs || '0', 10);
            lines.push(`[${formatTimestamp(startMs / 1000)}] ${cueText}`);
          }
        }
      }
      if (lines.length > 0) return lines.join('\n');
    }
  }
  return null;
}

/**
 * Scrape transcript from the visible YouTube transcript panel DOM.
 * Supports classic (ytd-transcript-segment-renderer) and modern
 * "In this video" panel (macro-markers-panel-item-view-model).
 */
/**
 * Last-resort: programmatically click "Show transcript" to trigger YouTube's own
 * transcript loading, then scrape the result.
 */
async function triggerAndScrapeTranscript(): Promise<string | null> {
  const existing = scrapeTranscriptFromDOM();
  if (existing) return existing;

  let btn = findTranscriptButton();
  if (!btn) {
    const expandBtn = document.querySelector('#expand') as HTMLElement | null;
    if (expandBtn) {
      expandBtn.click();
      await new Promise<void>(r => setTimeout(r, 800));
      btn = findTranscriptButton();
    }
  }
  if (!btn) return null;

  const prevExpanded = document.querySelector(
    'ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]',
  );

  btn.click();

  for (let i = 0; i < 16; i++) {
    await new Promise<void>(r => setTimeout(r, 500));
    const result = scrapeTranscriptFromDOM();
    if (result) {
      const closeBtn = document.querySelector(
        'ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"] #visibility-button button',
      ) as HTMLElement | null;
      if (closeBtn && !prevExpanded) closeBtn.click();
      return result;
    }
  }

  return null;
}

function findTranscriptButton(): HTMLElement | null {
  const buttons = document.querySelectorAll('button');
  for (const btn of buttons) {
    if (btn.getAttribute('aria-label') === 'Show transcript') return btn;
  }
  return null;
}

function scrapeTranscriptFromDOM(): string | null {
  // Classic transcript panel
  const classicSegments = document.querySelectorAll('ytd-transcript-segment-renderer');
  if (classicSegments.length > 0) {
    const lines: string[] = [];
    for (const seg of classicSegments) {
      const time = (seg.querySelector('.segment-timestamp') as HTMLElement)?.textContent?.trim();
      const text = (seg.querySelector('.segment-text') as HTMLElement)?.textContent?.trim();
      if (!text) continue;
      lines.push(time ? `[${time}] ${text}` : text);
    }
    if (lines.length > 0) return lines.join('\n');
  }

  // Modern "In this video" transcript panel
  const panels = document.querySelectorAll('ytd-engagement-panel-section-list-renderer');
  for (const panel of panels) {
    if (panel.getAttribute('visibility') !== 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED') continue;
    const items = panel.querySelectorAll('macro-markers-panel-item-view-model');
    if (items.length === 0) continue;

    const lines: string[] = [];
    for (const item of items) {
      // Use innerText (not textContent) — it preserves newlines between timestamp and text
      const raw = (item as HTMLElement).innerText?.trim();
      if (!raw || !/^\d/.test(raw)) continue; // skip chapter headers (no timestamp)
      const parts = raw.split('\n').map(p => p.trim()).filter(Boolean);
      const timestamp = parts[0];
      const textStart = (parts.length >= 3 && /^\d+\s*(second|minute|hour)/.test(parts[1])) ? 2 : 1;
      const text = parts.slice(textStart).join(' ');
      if (timestamp && text) lines.push(`[${timestamp}] ${text}`);
    }
    if (lines.length > 0) return lines.join('\n');
  }

  return null;
}

function parseTranscriptXml(xml: string): string {
  // 0. JSON3 format: {"wireMagic":"pb3","events":[{"tStartMs":...,"segs":[{"utf8":"..."}]}]}
  if (xml.trimStart().startsWith('{')) {
    try {
      const json = JSON.parse(xml);
      if (json.events) {
        const segments: string[] = [];
        for (const event of json.events) {
          if (!event.segs) continue;
          const text = event.segs.map((s: any) => (s.utf8 || '')).join('').replace(/\n/g, ' ').trim();
          if (!text) continue;
          segments.push(`[${formatTimestamp((event.tStartMs ?? 0) / 1000)}] ${text}`);
        }
        if (segments.length > 0) return segments.join('\n');
      }
    } catch { /* not valid JSON, fall through to XML parsing */ }
  }

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
