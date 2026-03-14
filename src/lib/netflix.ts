/**
 * Netflix transcript extraction via TTML (Timed Text Markup Language).
 *
 * Netflix delivers subtitles as TTML XML fetched via XHR from *.nflxvideo.net CDN.
 * Timestamps use tick-based format (ttp:tickRate, default 10M ticks/sec).
 *
 * The MAIN-world bridge (netflix-bridge.content.ts) intercepts these XHR responses
 * and caches the TTML. The content script requests it via postMessage.
 */

/**
 * Parse Netflix TTML XML into timestamped text lines: [H:MM:SS] text
 */
export function parseTTML(ttml: string): string {
  // Extract tickRate (default 10M = 10_000_000)
  const tickRateMatch = ttml.match(/ttp:tickRate="(\d+)"/);
  const tickRate = tickRateMatch ? parseInt(tickRateMatch[1], 10) : 10_000_000;

  const lines: string[] = [];

  // Match <p> elements with tick-based timestamps: begin="661077084t" end="689438750t"
  const pRegex = /<p[^>]*begin="(\d+)t"[^>]*>([\s\S]*?)<\/p>/g;
  let match;
  while ((match = pRegex.exec(ttml)) !== null) {
    const beginTicks = parseInt(match[1], 10);
    const beginSec = beginTicks / tickRate;
    const text = match[2]
      .replace(/<br\s*\/?>/g, ' ')   // <br/> → space
      .replace(/<[^>]+>/g, '')        // strip all tags (<span>, etc.)
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();

    if (!text) continue;
    lines.push(`[${formatTimestamp(beginSec)}] ${text}`);
  }

  // Fallback: try HH:MM:SS.mmm timestamp format (some Netflix content)
  if (lines.length === 0) {
    const timeRegex = /<p[^>]*begin="(\d{2}:\d{2}:\d{2}[.,]\d{3})"[^>]*>([\s\S]*?)<\/p>/g;
    while ((match = timeRegex.exec(ttml)) !== null) {
      const ts = match[1];
      const parts = ts.replace(',', '.').split(':');
      const sec = parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseFloat(parts[2]);
      const text = match[2]
        .replace(/<br\s*\/?>/g, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
      if (!text) continue;
      lines.push(`[${formatTimestamp(sec)}] ${text}`);
    }
  }

  return lines.join('\n');
}

function formatTimestamp(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
