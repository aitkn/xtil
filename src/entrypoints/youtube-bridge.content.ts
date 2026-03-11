/**
 * YouTube bridge — runs in MAIN world (page context) so it has access to
 * YouTube's player object, cookies, session, and `ytcfg`.
 *
 * The isolated-world content script communicates via window.postMessage.
 *
 * Strategy:
 * 1. Intercept YouTube's own fetch to /v1/player → cache player responses
 * 2. Intercept YouTube's own timedtext fetches → cache caption text
 * 3. Use ytcfg.get('INNERTUBE_CONTEXT') for the full context on API calls
 */
export default defineContentScript({
  matches: ['*://*.youtube.com/*'],
  world: 'MAIN',
  runAt: 'document_start',

  main() {
    // Caches
    const playerCache = new Map<string, Record<string, unknown>>();
    const timedtextCache = new Map<string, string>(); // videoId → caption XML/text

    // --- Intercept YouTube's own fetch calls ---
    const originalFetch = window.fetch;
    window.fetch = async function (...args: Parameters<typeof fetch>) {
      const res = await originalFetch.apply(this, args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;

        // Only process requests to YouTube domains (prevent cache poisoning)
        if (!isYouTubeUrl(url)) return res;

        // Capture player responses
        if (url.includes('/youtubei/v1/player')) {
          const clone = res.clone();
          clone.json().then((data: Record<string, unknown>) => {
            const vid = (data as any)?.videoDetails?.videoId;
            if (vid) playerCache.set(vid, data);
          }).catch((err) => { console.warn('[xTil bridge] Failed to process player response:', err); });
        }

        // Capture timedtext responses (YouTube's own caption fetches)
        if (url.includes('/api/timedtext')) {
          const vidMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
          if (vidMatch) {
            const clone = res.clone();
            clone.text().then((text) => {
              if (text.length > 0) timedtextCache.set(vidMatch[1], text);
            }).catch((err) => { console.warn('[xTil bridge] Failed to process timedtext response:', err); });
          }
        }
      } catch (err) { console.warn('[xTil bridge] fetch intercept failed:', err); }
      return res;
    };

    // --- Also intercept XHR (YouTube may use XHR for timedtext) ---
    const XHR = XMLHttpRequest.prototype;
    const originalOpen = XHR.open;
    const originalSend = XHR.send;
    const xhrUrls = new WeakMap<XMLHttpRequest, string>();

    XHR.open = function (method: string, url: string | URL, ...rest: any[]) {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (isYouTubeUrl(urlStr) && (urlStr.includes('/api/timedtext') || urlStr.includes('/youtubei/v1/player'))) {
        xhrUrls.set(this, urlStr);
      }
      return (originalOpen as any).apply(this, [method, url, ...rest]);
    };

    XHR.send = function (...args: any[]) {
      const trackedUrl = xhrUrls.get(this);
      if (trackedUrl) {
        this.addEventListener('load', function () {
          try {
            if (trackedUrl.includes('/api/timedtext')) {
              const vidMatch = trackedUrl.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
              if (vidMatch && this.responseText.length > 0) {
                timedtextCache.set(vidMatch[1], this.responseText);
              }
            } else if (trackedUrl.includes('/youtubei/v1/player')) {
              const data = JSON.parse(this.responseText);
              const vid = data?.videoDetails?.videoId;
              if (vid) playerCache.set(vid, data);
            }
          } catch (err) { console.warn('[xTil bridge] XHR intercept failed:', err); }
        });
      }
      return (originalSend as any).apply(this, args);
    };

    // --- Handle requests from the isolated-world content script ---
    window.addEventListener('message', async (event) => {
      if (event.source !== window) return;

      // Return cached player data
      if (event.data?.type === 'XTIL_PLAYER_REQUEST') {
        const { videoId, hintLang, requestId } = event.data;
        try {
          const data = await getPlayerData(videoId, hintLang, playerCache, originalFetch);
          window.postMessage({ type: 'XTIL_PLAYER_RESPONSE', requestId, data }, window.location.origin);
        } catch (err) {
          window.postMessage({
            type: 'XTIL_PLAYER_RESPONSE',
            requestId,
            error: err instanceof Error ? err.message : String(err),
          }, window.location.origin);
        }
      }

      // Fetch transcript text
      if (event.data?.type === 'XTIL_TRANSCRIPT_REQUEST') {
        const { videoId, langCode, requestId } = event.data;
        try {
          const text = await fetchTranscript(videoId, langCode, originalFetch, playerCache, timedtextCache);
          window.postMessage({ type: 'XTIL_TRANSCRIPT_RESPONSE', requestId, text }, window.location.origin);
        } catch (err) {
          window.postMessage({
            type: 'XTIL_TRANSCRIPT_RESPONSE',
            requestId,
            error: err instanceof Error ? err.message : String(err),
          }, window.location.origin);
        }
      }
    });
  },
});

// --- Player data ---

async function getPlayerData(
  videoId: string,
  hintLang: string | undefined,
  cache: Map<string, Record<string, unknown>>,
  fetchFn: typeof fetch,
): Promise<Record<string, unknown>> {
  const cached = cache.get(videoId);
  if (cached) {
    const tracks = (cached as any)?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (tracks?.length > 0) return cached;
  }

  const moviePlayer = document.querySelector('#movie_player') as HTMLElement & {
    getPlayerResponse?: () => Record<string, unknown>;
  } | null;
  if (moviePlayer?.getPlayerResponse) {
    try {
      const pr = moviePlayer.getPlayerResponse();
      const tracks = (pr as any)?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (tracks?.length > 0) {
        const vid = (pr as any)?.videoDetails?.videoId;
        if (vid === videoId) {
          cache.set(videoId, pr);
          return pr;
        }
      }
    } catch { /* not ready */ }
  }

  const initial = (window as any).ytInitialPlayerResponse;
  if (initial) {
    const tracks = initial?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (tracks?.length > 0) {
      const vid = initial?.videoDetails?.videoId;
      if (vid === videoId) {
        cache.set(videoId, initial);
        return initial;
      }
    }
  }

  const fetched = await fetchInnertubePlayer(videoId, hintLang, fetchFn);
  cache.set(videoId, fetched);
  return fetched;
}

async function fetchInnertubePlayer(
  videoId: string,
  hintLang: string | undefined,
  fetchFn: typeof fetch,
): Promise<Record<string, unknown>> {
  const context = getInnertubeContext(hintLang);
  const ytcfg = (window as any).ytcfg;
  const apiKey = ytcfg?.get?.('INNERTUBE_API_KEY') || 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

  const res = await fetchFn.call(window,
    `${window.location.origin}/youtubei/v1/player?key=${apiKey}&prettyPrint=false`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ context, videoId, contentCheckOk: true, racyCheckOk: true }),
    },
  );
  if (!res.ok) throw new Error(`Innertube player: ${res.status}`);
  return await res.json();
}

// --- Transcript fetching ---

async function fetchTranscript(
  videoId: string,
  langCode: string | undefined,
  fetchFn: typeof fetch,
  playerCache: Map<string, Record<string, unknown>>,
  timedtextCache: Map<string, string>,
): Promise<string> {
  // 1. Check if we already intercepted YouTube's own timedtext fetch
  const cachedText = timedtextCache.get(videoId);
  if (cachedText) return cachedText;

  // 2. Try local/fast methods first (no network, no 400 errors)
  const embeddedResult = extractTranscriptFromInitialData(videoId);
  if (embeddedResult) return embeddedResult;
  const domResult = scrapeTranscriptFromDOM();
  if (domResult) return domResult;

  // 3. Try get_transcript innertube endpoint (uses full INNERTUBE_CONTEXT)
  try {
    const result = await callGetTranscript(videoId, langCode, fetchFn);
    if (result) return result;
  } catch {
    // Expected fallback — some videos don't support this endpoint
  }

  // 4. Try timedtext baseUrl from player response
  try {
    const result = await fetchTimedtext(videoId, langCode, fetchFn, playerCache);
    if (result) return result;
  } catch {
    // Expected fallback
  }

  // 5. Last resort: trigger YouTube's own "Show transcript" UI and scrape the result.
  // This works for is_servable=false videos where all API methods fail but
  // YouTube's frontend can still load the transcript internally.
  try {
    const result = await triggerAndScrapeTranscript();
    if (result) return result;
  } catch {
    // Expected fallback
  }

  throw new Error('No transcript available');
}

async function callGetTranscript(
  videoId: string,
  langCode: string | undefined,
  fetchFn: typeof fetch,
): Promise<string | null> {
  const ytcfg = (window as any).ytcfg;
  const apiKey = ytcfg?.get?.('INNERTUBE_API_KEY') || 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
  const url = `${window.location.origin}/youtubei/v1/get_transcript?key=${apiKey}&prettyPrint=false`;

  // protobuf params: field 1 = videoId (11 bytes)
  const basicParams = btoa(String.fromCharCode(0x0a, 0x0b) + videoId);

  const context = getInnertubeContext();
  const res = await fetchFn.call(window, url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ context, params: basicParams }),
  });

  if (!res.ok) throw new Error(`get_transcript: ${res.status}`);

  let data = await res.json();

  // If we need a different language, use continuation token from language menu
  if (langCode) {
    const langMenu = extractLanguageMenu(data);
    const selectedCode = langMenu?.find((item: any) => item.selected)?.languageCode;
    if (selectedCode && selectedCode.split('-')[0] !== langCode.split('-')[0]) {
      const target = langMenu?.find((item: any) =>
        item.languageCode?.split('-')[0] === langCode.split('-')[0],
      );
      if (target?.continuation) {
        const res2 = await fetchFn.call(window, url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ context, params: target.continuation }),
        });
        if (res2.ok) data = await res2.json();
      }
    }
  }

  const segments = extractTranscriptSegments(data);
  if (segments.length > 0) return segments.join('\n');
  return null;
}

async function fetchTimedtext(
  videoId: string,
  langCode: string | undefined,
  fetchFn: typeof fetch,
  playerCache: Map<string, Record<string, unknown>>,
): Promise<string | null> {
  const cached = playerCache.get(videoId);
  const tracks = (cached as any)?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks?.length) return null;

  let track = tracks[0];
  if (langCode) {
    const match = tracks.find((t: any) => t.languageCode?.split('-')[0] === langCode.split('-')[0]);
    if (match) track = match;
  }

  const baseUrl: string | undefined = track.baseUrl;
  if (!baseUrl) return null;

  // Try the original baseUrl with different formats
  for (const suffix of ['', '&fmt=srv3', '&fmt=json3', '&fmt=vtt']) {
    try {
      const res = await fetchFn.call(window, baseUrl + suffix, { credentials: 'include' });
      const text = await res.text();
      if (text.length > 0) return text;
    } catch { /* try next */ }
  }

  return null;
}

/**
 * Last-resort: programmatically click "Show transcript" to trigger YouTube's own
 * transcript loading, then scrape the result from the DOM.
 * This works because YouTube's frontend sends proper auth headers that our
 * fetch calls cannot replicate (SAPISIDHASH, PoToken, etc.).
 */
async function triggerAndScrapeTranscript(): Promise<string | null> {
  // Check if transcript panel already has content
  const existing = scrapeTranscriptFromDOM();
  if (existing) return existing;

  // Check if "Show transcript" button exists (may be inside collapsed description)
  let btn = findTranscriptButton();
  if (!btn) {
    // Try expanding description first
    const expandBtn = document.querySelector('#expand') as HTMLElement | null;
    if (expandBtn) {
      expandBtn.click();
      await sleep(800);
      btn = findTranscriptButton();
    }
  }
  if (!btn) return null;

  // Remember which panel was expanded before (to restore state)
  const prevExpanded = document.querySelector(
    'ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]',
  );

  btn.click();

  // Wait for transcript segments to appear (up to 8s)
  for (let i = 0; i < 16; i++) {
    await sleep(500);
    const result = scrapeTranscriptFromDOM();
    if (result) {
      // Close the transcript panel to avoid UI disruption (close button = X)
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

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Extract transcript from ytInitialData engagement panels.
 * YouTube embeds transcript data in the page even when captions are marked
 * as is_servable=false (which causes timedtext API to return empty and
 * get_transcript to fail with "Precondition check failed").
 */
function extractTranscriptFromInitialData(_videoId: string): string | null {
  const initialData = (window as any).ytInitialData;
  if (!initialData?.engagementPanels) return null;

  for (const panel of initialData.engagementPanels) {
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
      // Standard segment renderer (from initialSegments)
      const sr = seg.transcriptSegmentRenderer;
      if (sr) {
        const text = sr.snippet?.runs?.map((r: any) => r.text).join('')
          ?? sr.snippet?.simpleText ?? '';
        const clean = text.replace(/\n/g, ' ').trim();
        if (!clean) continue;
        const startMs = parseInt(sr.startMs || '0', 10);
        lines.push(`[${formatMs(startMs)}] ${clean}`);
        continue;
      }
      // CueGroup renderer (from cueGroups — same format as get_transcript response)
      const cg = seg.transcriptCueGroupRenderer;
      if (cg?.cues) {
        for (const cue of cg.cues) {
          const cr = cue.transcriptCueRenderer;
          if (!cr) continue;
          const text = (cr.cue?.simpleText ?? '').trim();
          if (!text) continue;
          const startMs = parseInt(cr.startOffsetMs || '0', 10);
          lines.push(`[${formatMs(startMs)}] ${text}`);
        }
      }
    }
    if (lines.length > 0) return lines.join('\n');
  }
  return null;
}

function formatMs(ms: number): string {
  const totalSec = ms / 1000;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Scrape transcript segments directly from the rendered DOM.
 * Works when YouTube's transcript panel is visible (user clicked "Show transcript"
 * or the panel was rendered by the SPA framework).
 *
 * Supports both the classic UI (ytd-transcript-segment-renderer) and the modern
 * "In this video" panel (macro-markers-panel-item-view-model).
 */
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

  // Modern "In this video" transcript panel (macro-markers-panel-item-view-model)
  // Find the expanded engagement panel containing transcript items
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
      // Skip the accessibility duration text (e.g. "8 seconds", "3 minutes, 25 seconds")
      const textStart = (parts.length >= 3 && /^\d+\s*(second|minute|hour)/.test(parts[1])) ? 2 : 1;
      const text = parts.slice(textStart).join(' ');
      if (timestamp && text) lines.push(`[${timestamp}] ${text}`);
    }
    if (lines.length > 0) return lines.join('\n');
  }

  return null;
}

// --- Helpers ---

function isYouTubeUrl(url: string): boolean {
  try { return new URL(url).hostname.endsWith('.youtube.com'); } catch { return false; }
}

/**
 * Get the full INNERTUBE_CONTEXT from ytcfg, with fallback to minimal context.
 * Using the full context (with visitorData, user agent, etc.) is required for
 * endpoints like get_transcript that check preconditions.
 */
function getInnertubeContext(hl?: string): Record<string, unknown> {
  const ytcfg = (window as any).ytcfg;

  // Try to get YouTube's own full context
  const fullContext = ytcfg?.get?.('INNERTUBE_CONTEXT');
  if (fullContext) {
    if (hl && fullContext.client) {
      fullContext.client.hl = hl;
    }
    return fullContext;
  }

  // Fallback: build minimal context
  const clientVersion = ytcfg?.get?.('INNERTUBE_CLIENT_VERSION') || '2.20240101.00.00';
  const visitorData = ytcfg?.get?.('VISITOR_DATA') || undefined;
  const client: Record<string, unknown> = {
    clientName: 'WEB',
    clientVersion,
    hl: hl || 'en',
  };
  if (visitorData) client.visitorData = visitorData;
  return { client };
}

function extractLanguageMenu(data: any): any[] | undefined {
  const actions = data?.actions;
  if (!actions) return undefined;

  for (const action of actions) {
    const footer = action?.updateEngagementPanelAction?.content
      ?.transcriptRenderer?.footer?.transcriptFooterRenderer;
    const items = footer?.languageMenu?.sortFilterSubMenuRenderer?.subMenuItems;
    if (items) {
      return items.map((item: any) => ({
        title: item.title,
        languageCode: item.continuation?.reloadContinuationData?.command
          ?.changeEngagementPanelVisibilityAction?.targetId?.match(/lang=([^&]+)/)?.[1]
          || item.title,
        selected: !!item.selected,
        continuation: item.continuation?.reloadContinuationData?.continuation,
      }));
    }
  }
  return undefined;
}

function extractTranscriptSegments(data: any): string[] {
  const segments: string[] = [];
  const actions = data?.actions;
  if (!actions) return segments;

  for (const action of actions) {
    const panel =
      action?.updateEngagementPanelAction?.content?.transcriptRenderer?.body?.transcriptBodyRenderer ||
      action?.updateEngagementPanelAction?.content?.transcriptRenderer?.content
        ?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer;

    const cueGroups = panel?.cueGroups;
    if (!cueGroups) continue;

    for (const group of cueGroups) {
      const cues = group?.transcriptCueGroupRenderer?.cues;
      if (!cues) continue;

      for (const cue of cues) {
        const renderer = cue?.transcriptCueRenderer;
        if (!renderer) continue;

        const text = renderer.cue?.simpleText?.trim();
        if (!text) continue;

        const startMs = parseInt(renderer.startOffsetMs || '0', 10);
        const totalSec = startMs / 1000;
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = Math.floor(totalSec % 60);
        const ts = h > 0
          ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
          : `${m}:${String(s).padStart(2, '0')}`;

        segments.push(`[${ts}] ${text}`);
      }
    }
  }
  return segments;
}
