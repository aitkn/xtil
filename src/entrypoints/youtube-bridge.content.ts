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
            const tracks = (data as any)?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
            if (vid) {
              playerCache.set(vid, data);
              console.log(`[xTil] Intercepted player for ${vid}: ${tracks?.length ?? 0} caption tracks`);
            }
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
                console.log(`[xTil] Intercepted XHR timedtext for ${vidMatch[1]}: ${this.responseText.length} chars`);
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
        if (vid === videoId) return pr;
      }
    } catch { /* not ready */ }
  }

  const initial = (window as any).ytInitialPlayerResponse;
  if (initial) {
    const tracks = initial?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (tracks?.length > 0) {
      const vid = initial?.videoDetails?.videoId;
      if (vid === videoId) return initial;
    }
  }

  return await fetchInnertubePlayer(videoId, hintLang, fetchFn);
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
    `https://www.youtube.com/youtubei/v1/player?key=${apiKey}&prettyPrint=false`,
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

  // 2. Try get_transcript innertube endpoint (uses full INNERTUBE_CONTEXT)
  try {
    const result = await callGetTranscript(videoId, langCode, fetchFn);
    if (result) return result;
  } catch (err) {
    console.warn(`[xTil] get_transcript failed: ${err instanceof Error ? err.message : err}`);
  }

  // 3. Try timedtext baseUrl from player response
  try {
    const result = await fetchTimedtext(videoId, langCode, fetchFn, playerCache);
    if (result) return result;
  } catch (err) {
    console.warn(`[xTil] timedtext fallback failed: ${err instanceof Error ? err.message : err}`);
  }

  throw new Error('No transcript available');
}

async function callGetTranscript(
  videoId: string,
  langCode: string | undefined,
  fetchFn: typeof fetch,
): Promise<string | null> {
  const context = getInnertubeContext();
  const ytcfg = (window as any).ytcfg;
  const apiKey = ytcfg?.get?.('INNERTUBE_API_KEY') || 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

  // protobuf params: field 1 = videoId (11 bytes)
  const basicParams = btoa(String.fromCharCode(0x0a, 0x0b) + videoId);

  const res = await fetchFn.call(window,
    `https://www.youtube.com/youtubei/v1/get_transcript?key=${apiKey}&prettyPrint=false`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ context, params: basicParams }),
    },
  );

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
        console.log(`[xTil] Switching transcript to ${target.languageCode}`);
        const res2 = await fetchFn.call(window,
          `https://www.youtube.com/youtubei/v1/get_transcript?key=${apiKey}&prettyPrint=false`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ context, params: target.continuation }),
          },
        );
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

  // Try with no additional params first, then different formats
  for (const suffix of ['', '&fmt=srv3', '&fmt=json3', '&fmt=vtt']) {
    try {
      const res = await fetchFn.call(window, baseUrl + suffix, { credentials: 'include' });
      const text = await res.text();
      if (text.length > 0) return text;
    } catch { /* try next */ }
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
