/**
 * Netflix bridge — runs in MAIN world (page context) so it has access to
 * Netflix's Cadmium player API and can intercept subtitle XHR responses.
 *
 * The isolated-world content script communicates via CustomEvent on document
 * (more reliable than window.postMessage on Netflix).
 *
 * Strategy:
 * 1. Intercept XHR to *.nflxvideo.net → cache TTML subtitle responses
 * 2. Use netflix.appContext.state.playerApp.getAPI() for track list & metadata
 * 3. On request, return cached TTML or switch tracks to trigger a fetch
 */
export default defineContentScript({
  matches: ['*://*.netflix.com/*'],
  world: 'MAIN',
  runAt: 'document_start',

  main() {
    // Cache: language code → TTML content
    const ttmlCache = new Map<string, string>();

    // --- Intercept XHR to capture Netflix subtitle responses ---
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    const xhrUrls = new WeakMap<XMLHttpRequest, string>();

    XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...rest: any[]) {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('nflxvideo.net')) {
        xhrUrls.set(this, urlStr);
      }
      return (origOpen as any).apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function (...args: any[]) {
      const trackedUrl = xhrUrls.get(this);
      if (trackedUrl) {
        this.addEventListener('load', function () {
          try {
            const text = this.responseText;
            if (text && text.includes('<tt')) {
              const langMatch = text.match(/xml:lang="([^"]+)"/);
              const lang = langMatch?.[1] || 'unknown';
              ttmlCache.set(lang, text);
            }
          } catch { /* ignore */ }
        });
      }
      return (origSend as any).apply(this, args);
    };

    // --- Also intercept fetch (in case Netflix switches to fetch API) ---
    const originalFetch = window.fetch;
    window.fetch = async function (...args: Parameters<typeof fetch>) {
      const res = await originalFetch.apply(this, args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
        if (url.includes('nflxvideo.net')) {
          const clone = res.clone();
          const text = await clone.text();
          if (text.includes('<tt')) {
            const langMatch = text.match(/xml:lang="([^"]+)"/);
            const lang = langMatch?.[1] || 'unknown';
            ttmlCache.set(lang, text);
          }
        }
      } catch { /* ignore */ }
      return res;
    };

    // --- Handle requests from the isolated-world content script via CustomEvent ---
    document.addEventListener('xtil-netflix-request', async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.requestId) return;

      if (detail.type === 'tracks') {
        try {
          const info = getNetflixInfo();
          document.dispatchEvent(new CustomEvent('xtil-netflix-response', {
            detail: { requestId: detail.requestId, ...info },
          }));
        } catch (err) {
          document.dispatchEvent(new CustomEvent('xtil-netflix-response', {
            detail: { requestId: detail.requestId, error: err instanceof Error ? err.message : String(err) },
          }));
        }
      }

      if (detail.type === 'ttml') {
        try {
          const ttml = await getTTML(detail.langCode);
          document.dispatchEvent(new CustomEvent('xtil-netflix-response', {
            detail: { requestId: detail.requestId, ttml },
          }));
        } catch (err) {
          document.dispatchEvent(new CustomEvent('xtil-netflix-response', {
            detail: { requestId: detail.requestId, error: err instanceof Error ? err.message : String(err) },
          }));
        }
      }
    });

    function getNetflixInfo(): Record<string, unknown> {
      const nf = (window as any).netflix;
      if (!nf?.appContext?.state?.playerApp) {
        return { error: 'Netflix player not available' };
      }

      const api = nf.appContext.state.playerApp.getAPI();
      const vp = api.videoPlayer;
      const sessions = vp.getAllPlayerSessionIds();
      if (sessions.length === 0) {
        return { error: 'No active player session' };
      }

      const player = vp.getVideoPlayerBySessionId(sessions[0]);
      const tracks = player.getTimedTextTrackList();
      const currentTrack = player.getTimedTextTrack();

      // Get audio track language — indicates the original language of the content
      let audioLang: string | undefined;
      try {
        const audioTrack = player.getAudioTrack();
        audioLang = audioTrack?.bcp47;
      } catch { /* not available */ }

      // Get video metadata
      const state = nf.appContext.state.playerApp.getState();
      const vmeta = state.videoPlayer?.videoMetadata;
      const movieId = player.getMovieId();
      const meta = vmeta?.[movieId];
      const video = meta?._metadataObject?.video;

      return {
        movieId,
        title: video?.title,
        synopsis: video?.synopsis,
        type: video?.type,
        currentEpisode: video?.currentEpisode,
        duration: player.getDuration(),
        audioLang,
        tracks: tracks
          .filter((t: any) => !t.isNoneTrack && !t.isForcedNarrative)
          .map((t: any) => ({
            trackId: t.trackId,
            bcp47: t.bcp47,
            displayName: t.displayName,
            rawTrackType: t.rawTrackType,
          })),
        currentTrack: currentTrack ? {
          trackId: currentTrack.trackId,
          bcp47: currentTrack.bcp47,
          displayName: currentTrack.displayName,
        } : null,
        cachedLanguages: [...ttmlCache.keys()],
      };
    }

    async function getTTML(langCode?: string): Promise<string> {
      // Check cache first
      if (langCode) {
        const cached = ttmlCache.get(langCode);
        if (cached) return cached;
        for (const [key, val] of ttmlCache) {
          if (key.split('-')[0] === langCode.split('-')[0]) return val;
        }
      }
      if (!langCode && ttmlCache.size > 0) {
        return ttmlCache.values().next().value!;
      }

      // No cache hit — switch tracks to trigger a fetch
      const nf = (window as any).netflix;
      if (!nf?.appContext?.state?.playerApp) {
        throw new Error('Netflix player not available');
      }

      const api = nf.appContext.state.playerApp.getAPI();
      const vp = api.videoPlayer;
      const sessions = vp.getAllPlayerSessionIds();
      if (sessions.length === 0) throw new Error('No active player session');

      const player = vp.getVideoPlayerBySessionId(sessions[0]);
      const tracks = player.getTimedTextTrackList();
      const currentTrack = player.getTimedTextTrack();

      const targetLang = langCode || 'en';
      let target = tracks.find((t: any) =>
        t.bcp47.split('-')[0] === targetLang.split('-')[0] &&
        t.rawTrackType === 'SUBTITLES' &&
        !t.isForcedNarrative && !t.isNoneTrack,
      );
      if (!target) {
        target = tracks.find((t: any) =>
          t.bcp47.split('-')[0] === targetLang.split('-')[0] &&
          !t.isForcedNarrative && !t.isNoneTrack,
        );
      }
      if (!target) {
        target = tracks.find((t: any) => !t.isForcedNarrative && !t.isNoneTrack);
      }
      if (!target) throw new Error('No subtitle tracks available');

      player.setTimedTextTrack(target);

      // Wait for TTML to be intercepted (up to 8s)
      for (let i = 0; i < 16; i++) {
        await new Promise(r => setTimeout(r, 500));
        const lang = target.bcp47.split('-')[0];
        for (const [key, val] of ttmlCache) {
          if (key.split('-')[0] === lang) {
            if (currentTrack && currentTrack.trackId !== target.trackId) {
              player.setTimedTextTrack(currentTrack);
            }
            return val;
          }
        }
      }

      if (currentTrack && currentTrack.trackId !== target.trackId) {
        player.setTimedTextTrack(currentTrack);
      }

      throw new Error('Subtitle fetch timed out');
    }
  },
});
