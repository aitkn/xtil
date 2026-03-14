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

      if (detail.type === 'seek') {
        try {
          const nf = (window as any).netflix;
          if (!nf?.appContext?.state?.playerApp) throw new Error('Netflix player not available');
          const api = nf.appContext.state.playerApp.getAPI();
          const vp = api.videoPlayer;
          const sessions = vp.getAllPlayerSessionIds();
          if (sessions.length === 0) throw new Error('No active player session');
          const player = vp.getVideoPlayerBySessionId(sessions[0]);
          // Netflix player seek expects milliseconds
          player.seek(detail.seconds * 1000);
          document.dispatchEvent(new CustomEvent('xtil-netflix-response', {
            detail: { requestId: detail.requestId, success: true },
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

      // Extract thumbnail from Netflix metadata — try multiple paths
      let thumbnailUrl: string | undefined;
      try {
        // Netflix artwork arrays contain objects with url and size info
        // Try all artwork types, pick the largest image (>100px to skip icons)
        const artworkSources = [video?.artwork, video?.boxart, video?.storyart, video?.BGImages].filter(Array.isArray);
        const allArt = artworkSources.flat();

        // Log artwork structure for debugging
        if (allArt.length > 0) {
          console.log('[xTil Netflix] artwork sample:', JSON.stringify(allArt.map((a: any) => ({
            url: a?.url?.substring(0, 60), w: a?.w, h: a?.h, width: a?.width, height: a?.height, size: a?.size,
            keys: a ? Object.keys(a).join(',') : 'null',
          }))));
        }

        if (allArt.length > 0) {
          // Sort by width descending — try w, width, or infer from URL
          const withSize = allArt.map((a: any) => {
            const w = a?.w || a?.width || 0;
            return { url: a?.url, w };
          }).filter((a: any) => a.url);

          // Pick largest that's > 100px (skip tiny icons), or just the largest
          const sorted = withSize.sort((a: any, b: any) => b.w - a.w);
          const large = sorted.find((a: any) => a.w > 100) || sorted[0];
          if (large?.url) thumbnailUrl = large.url;
        }
        // Fallback: try image object with url property
        if (!thumbnailUrl && video?.image?.url) {
          thumbnailUrl = video.image.url;
        }
      } catch { /* ignore thumbnail extraction errors */ }

      // Extract rich metadata — dump structure safely for discovery
      let year: number | undefined;
      let rating: string | undefined;
      let seasonCount: number | undefined;
      let episodeTitle: string | undefined;
      let seasonNumber: number | undefined;
      let episodeNumber: number | undefined;
      let creators: string[] | undefined;
      let cast: string[] | undefined;
      let _debugDump: string | undefined;
      try {
        // Log directly to Netflix page console (no serialization issues here)
        if (video) {
          const dump: Record<string, string> = {};
          for (const key of Object.keys(video)) {
            try {
              const val = video[key];
              if (val === null || val === undefined) continue;
              if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
                dump[key] = String(val);
              } else if (Array.isArray(val)) {
                dump[key] = `Array(${val.length})`;
              } else if (typeof val === 'object') {
                dump[key] = `{${Object.keys(val).slice(0, 10).join(', ')}}`;
              }
            } catch { dump[key] = '(error)'; }
          }
          console.log('[xTil Netflix] video fields:', JSON.stringify(dump, null, 2));
          if (video.currentEpisode) {
            const epDump: Record<string, string> = {};
            for (const key of Object.keys(video.currentEpisode)) {
              try {
                const val = video.currentEpisode[key];
                if (val === null || val === undefined) continue;
                epDump[key] = typeof val === 'object' ? `{${Object.keys(val).slice(0, 8).join(', ')}}` : String(val);
              } catch { epDump[key] = '(error)'; }
            }
            console.log('[xTil Netflix] episode fields:', JSON.stringify(epDump, null, 2));
          }
        }
        // Pass as string for CustomEvent (avoids structured clone issues)
        _debugDump = video ? Object.keys(video).join(', ') : 'no video object';

        // Now try to extract fields from discovered structure
        year = video?.year || video?.releaseYear;
        rating = video?.maturity?.rating?.value || video?.maturityRating || video?.rating || video?.certification;
        if (video?.currentEpisode) {
          const ep = video.currentEpisode;
          episodeTitle = ep.title || ep.episodeTitle;
          seasonNumber = ep.seq ?? ep.season ?? ep.seasonNumber ?? ep.seasonNum;
          episodeNumber = ep.episode ?? ep.ep ?? ep.episodeNumber ?? ep.episodeNum;
        }
        seasonCount = video?.seasonCount ?? (Array.isArray(video?.seasons) ? video.seasons.length : undefined);
        // Creators — try many possible field names
        const creatorFields = ['creators', 'directors', 'director', 'creator'];
        for (const f of creatorFields) {
          const v = video?.[f];
          if (Array.isArray(v) && v.length) {
            creators = v.map((c: any) => typeof c === 'string' ? c : c?.name || c?.personName || String(c)).filter(Boolean);
            break;
          } else if (typeof v === 'string' && v) {
            creators = [v];
            break;
          }
        }
        // Cast
        const castFields = ['cast', 'actors'];
        for (const f of castFields) {
          const v = video?.[f];
          if (Array.isArray(v) && v.length) {
            cast = v.map((c: any) => typeof c === 'string' ? c : c?.name || c?.personName || String(c)).filter(Boolean);
            break;
          }
        }
      } catch (err) {
        console.warn('[xTil Netflix bridge] metadata extraction error:', err);
      }

      return {
        movieId,
        title: video?.title,
        synopsis: video?.synopsis,
        type: video?.type,
        duration: player.getDuration(),
        audioLang,
        thumbnailUrl,
        year,
        rating,
        seasonCount,
        episodeTitle,
        seasonNumber,
        episodeNumber,
        creators,
        cast,
        _debugDump,
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
