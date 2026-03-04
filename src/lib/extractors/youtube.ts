import type { ContentExtractor, ExtractedContent } from './types';

const YOUTUBE_URL_RE = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

export const youtubeExtractor: ContentExtractor = {
  canExtract(url: string): boolean {
    return YOUTUBE_URL_RE.test(url);
  },

  extract(url: string, doc: Document): ExtractedContent {
    const videoId = url.match(YOUTUBE_URL_RE)?.[1];
    if (!videoId) throw new Error('Could not extract YouTube video ID');

    // Use live DOM elements that YouTube updates during SPA navigation.
    // Meta tags and ytInitialPlayerResponse are stale after SPA nav.

    // document.title is always current: "Video Title - YouTube"
    const docTitle = doc.querySelector('title')?.textContent?.replace(/\s*-\s*YouTube\s*$/, '').trim();
    const h1Title = doc.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim()
      || doc.querySelector('#title h1 yt-formatted-string')?.textContent?.trim()
      || doc.querySelector('h1.title')?.textContent?.trim();

    const title =
      h1Title ||
      docTitle ||
      doc.querySelector('meta[name="title"]')?.getAttribute('content') ||
      'Untitled Video';

    const channelName =
      doc.querySelector('ytd-channel-name yt-formatted-string a')?.textContent?.trim() ||
      doc.querySelector('#channel-name a')?.textContent?.trim() ||
      doc.querySelector('#owner-name a')?.textContent?.trim() ||
      doc.querySelector('link[itemprop="name"]')?.getAttribute('content') ||
      undefined;

    // YouTube's description is collapsed by default (#snippet shows truncated text,
    // #content has the full text but is hidden). Click "...more" to expand it first.
    const expander = doc.querySelector('ytd-text-inline-expander');
    const expandBtn = expander?.querySelector('tp-yt-paper-button#expand') as HTMLElement | null;
    if (expandBtn) expandBtn.click();

    // Read full description from the expanded #content container;
    // fall back to #snippet, then meta tags (~155 chars truncated by YouTube).
    const fullDescEl =
      expander?.querySelector('#content yt-attributed-string') ||
      expander?.querySelector('#content yt-formatted-string') ||
      expander?.querySelector('#snippet yt-attributed-string') ||
      expander?.querySelector('#snippet yt-formatted-string');
    const description =
      fullDescEl?.textContent?.trim() ||
      doc.querySelector('meta[name="description"]')?.getAttribute('content') ||
      doc.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
      undefined;

    // Collapse it back to avoid visual side-effects
    const collapseBtn = expander?.querySelector('tp-yt-paper-button#collapse') as HTMLElement | null;
    if (collapseBtn) collapseBtn.click();

    const liveDateText = doc.querySelector('#info-strings yt-formatted-string')?.textContent?.trim();
    const publishDate =
      doc.querySelector('meta[itemprop="datePublished"]')?.getAttribute('content') ||
      doc.querySelector('meta[itemprop="uploadDate"]')?.getAttribute('content') ||
      liveDateText ||
      undefined;

    const liveDuration = doc.querySelector('.ytp-time-duration')?.textContent?.trim();
    const duration = liveDuration ||
      formatDuration(doc.querySelector('meta[itemprop="duration"]')?.getAttribute('content') || undefined);

    const liveViewCount = doc.querySelector('ytd-video-view-count-renderer span')?.textContent?.trim();
    const viewCount = liveViewCount || extractViewCount(doc);

    const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    // Always emit transcript marker — content script will fetch via innertube API.
    // Video ID comes from the URL (always current, even during SPA navigation).
    const transcript = `[YOUTUBE_TRANSCRIPT:${videoId}]`;

    const content = buildContent(title, description, transcript);
    const wordCount = content.split(/\s+/).filter(Boolean).length;

    return {
      type: 'youtube',
      url,
      title,
      channelName,
      author: channelName,
      publishDate,
      duration,
      viewCount,
      thumbnailUrl,
      description,
      language: doc.documentElement.lang || undefined,
      content,
      wordCount,
      estimatedReadingTime: Math.ceil(wordCount / 200),
    };
  },
};

function extractViewCount(doc: Document): string | undefined {
  const meta = doc.querySelector('meta[itemprop="interactionCount"]');
  if (meta) {
    const count = parseInt(meta.getAttribute('content') || '', 10);
    if (!isNaN(count)) return count.toLocaleString();
  }
  return undefined;
}

function buildContent(title: string, description: string | undefined, transcript: string): string {
  let content = `# ${title}\n\n`;

  if (description) {
    content += `## Description\n\n${description}\n\n`;
  }

  content += `## Transcript\n\n[Transcript available - fetching...]\n\n`;
  content += transcript;

  return content;
}

function formatDuration(isoDuration: string | undefined): string | undefined {
  if (!isoDuration) return undefined;

  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return isoDuration;

  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
