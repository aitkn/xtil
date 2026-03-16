import type { ContentExtractor, ExtractedContent, ExtractOptions } from './types';

const YOUTUBE_URL_RE = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

export const youtubeExtractor: ContentExtractor = {
  canExtract(url: string): boolean {
    return YOUTUBE_URL_RE.test(url);
  },

  extract(url: string, doc: Document, options?: ExtractOptions): ExtractedContent {
    const videoId = url.match(YOUTUBE_URL_RE)?.[1];
    if (!videoId) throw new Error('Could not extract YouTube video ID');

    // Use live DOM elements that YouTube updates during SPA navigation.
    // Meta tags and ytInitialPlayerResponse are stale after SPA nav.

    // document.title is always current: "Video Title - YouTube"
    const docTitle = doc.querySelector('title')?.textContent?.replace(/\s*-\s*YouTube\s*$/, '').trim();
    const h1Title = doc.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim()
      || doc.querySelector('#title h1 yt-formatted-string')?.textContent?.trim()
      || doc.querySelector('h1.title')?.textContent?.trim();

    // Only use live DOM elements — <meta> tags are stale after SPA navigation
    const title = h1Title || docTitle || 'Untitled Video';

    const channelName =
      // Desktop YouTube — scope to watch area to avoid picking up sidebar recommendations
      doc.querySelector('#above-the-fold ytd-channel-name yt-formatted-string a')?.textContent?.trim() ||
      doc.querySelector('ytd-watch-metadata ytd-channel-name yt-formatted-string a')?.textContent?.trim() ||
      doc.querySelector('#top-row ytd-channel-name yt-formatted-string a')?.textContent?.trim() ||
      doc.querySelector('#channel-name a')?.textContent?.trim() ||
      doc.querySelector('#owner-name a')?.textContent?.trim() ||
      // Mobile YouTube (ytm-* custom elements)
      doc.querySelector('ytm-slim-owner-renderer a')?.textContent?.trim() ||
      doc.querySelector('.slim-owner-icon-and-title a')?.textContent?.trim() ||
      // Note: <link itemprop="name"> and <meta name="author"> are stale after SPA nav — don't use
      undefined;

    // Read description without manipulating the DOM. Try #content first (visible
    // when already expanded), then #snippet (always present, may be truncated),
    // then meta tags (~155 chars). Never click expand/collapse — it interferes
    // with the user's UI state and causes the description to close unexpectedly.
    const expander = doc.querySelector('ytd-text-inline-expander');
    const fullDescEl =
      expander?.querySelector('#content yt-attributed-string') ||
      expander?.querySelector('#content yt-formatted-string') ||
      expander?.querySelector('#snippet yt-attributed-string') ||
      expander?.querySelector('#snippet yt-formatted-string');
    // Only use live DOM elements for description — <meta> tags are stale after SPA navigation
    const description = fullDescEl?.textContent?.trim() || undefined;

    // Prefer live DOM elements — <meta> itemprop tags are stale after SPA navigation
    const liveDateText = doc.querySelector('#info-strings yt-formatted-string')?.textContent?.trim();
    const publishDate = liveDateText || undefined;

    // Only use live DOM — <meta> itemprop tags are stale after SPA navigation
    const duration = doc.querySelector('.ytp-time-duration')?.textContent?.trim() || undefined;

    // Only use live DOM — <meta> itemprop tags are stale after SPA navigation
    const viewCount = doc.querySelector('ytd-video-view-count-renderer span')?.textContent?.trim() || undefined;

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

function buildContent(title: string, description: string | undefined, transcript: string): string {
  let content = `# ${title}\n\n`;

  if (description) {
    content += `## Description\n\n${description}\n\n`;
  }

  content += `## Transcript\n\n[Transcript available - fetching...]\n\n`;
  content += transcript;

  return content;
}

