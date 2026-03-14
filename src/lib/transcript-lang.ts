/**
 * Shared transcript utilities: language selection + subtitle format parsing.
 * Used by YouTube, Cloudflare Stream, Vimeo, Dailymotion, and generic HTML5 video.
 */

// Language family constants for closeness heuristic
const LATIN_LANGS = ['en', 'es', 'fr', 'de', 'pt'];
const SLAVIC_LANGS = ['ru'];
const CJK_LANGS = ['zh', 'ja', 'ko'];
// Popularity order for final tiebreaking
const POPULARITY_ORDER = ['en', 'es', 'fr', 'de', 'pt', 'ru', 'zh', 'ja', 'ko'];

export type CaptionTrack = {
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
  // Latin <-> Slavic = 1, either <-> CJK = 2
  if ((fa === 'latin' && fb === 'slavic') || (fa === 'slavic' && fb === 'latin')) return 1;
  return 2;
}

function popularityRank(code: string): number {
  const base = code.split('-')[0].toLowerCase();
  const idx = POPULARITY_ORDER.indexOf(base);
  return idx >= 0 ? idx : POPULARITY_ORDER.length;
}

/** Within a set of tracks, prefer manual (non-ASR) over auto-generated. */
export function preferManual(tracks: CaptionTrack[]): CaptionTrack {
  return tracks.find(t => t.kind !== 'asr') || tracks[0];
}

/**
 * Pick the best caption track based on user language preferences.
 *
 * Algorithm:
 * 1. Filter to tracks matching langPrefs (languages user understands)
 * 2. Tiebreak: prefer video's original language, then summaryLang, then closeness/popularity
 * 3. Within chosen language, prefer manual (non-ASR) over auto-generated
 * 4. Fallback: default track, then first manual, then first
 */
export function pickBestTrack(
  tracks: CaptionTrack[],
  langPrefs?: string[],
  summaryLang?: string,
  originalLang?: string,
  defaultTrackIndex?: number,
): CaptionTrack {
  if (tracks.length === 1) return tracks[0];

  // Normalize lang codes to base (e.g. "en-US" -> "en")
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
  // Default track index
  if (defaultTrackIndex != null && defaultTrackIndex >= 0 && defaultTrackIndex < tracks.length) {
    return tracks[defaultTrackIndex];
  }
  // First manual track, then first track
  return preferManual(tracks);
}

// --- Subtitle format parsers ---

/**
 * Convert HH:MM:SS.mmm or HH:MM:SS,mmm timestamp to display format (H:MM:SS or M:SS).
 */
function formatSubTimestamp(ts: string): string {
  const parts = ts.replace(',', '.').split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const s = parseInt(parts[2]?.split('.')[0] ?? '0', 10);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Parse WebVTT into timestamped text lines: [H:MM:SS] text
 */
export function parseVtt(vtt: string): string {
  const lines: string[] = [];
  const cueRe = /(\d{2}:\d{2}:\d{2}\.\d{3})\s+-->\s+\d{2}:\d{2}:\d{2}\.\d{3}/;

  const vttLines = vtt.split('\n');
  let i = 0;
  while (i < vttLines.length) {
    const match = vttLines[i].match(cueRe);
    if (match) {
      i++;
      const textParts: string[] = [];
      while (i < vttLines.length && vttLines[i].trim()) {
        textParts.push(vttLines[i].trim());
        i++;
      }
      const text = textParts.join(' ').replace(/<[^>]+>/g, '').trim();
      if (text) {
        lines.push(`[${formatSubTimestamp(match[1])}] ${text}`);
      }
    } else {
      i++;
    }
  }
  return lines.join('\n');
}

/**
 * Parse SRT (SubRip) into timestamped text lines: [H:MM:SS] text
 */
export function parseSrt(srt: string): string {
  const lines: string[] = [];
  const cueRe = /(\d{2}:\d{2}:\d{2},\d{3})\s+-->\s+\d{2}:\d{2}:\d{2},\d{3}/;

  // Normalize line endings
  const srtLines = srt.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < srtLines.length) {
    const match = srtLines[i].match(cueRe);
    if (match) {
      i++;
      const textParts: string[] = [];
      while (i < srtLines.length && srtLines[i].trim()) {
        textParts.push(srtLines[i].trim());
        i++;
      }
      const text = textParts.join(' ').replace(/<[^>]+>/g, '').trim();
      if (text) {
        lines.push(`[${formatSubTimestamp(match[1])}] ${text}`);
      }
    } else {
      i++;
    }
  }
  return lines.join('\n');
}
