import type { ContentExtractor, ExtractedContent, ExtractOptions } from './types';

const NETFLIX_WATCH_RE = /netflix\.com\/watch\/(\d+)/;

export const netflixExtractor: ContentExtractor = {
  canExtract(url: string): boolean {
    return NETFLIX_WATCH_RE.test(url);
  },

  extract(url: string, doc: Document, _options?: ExtractOptions): ExtractedContent {
    const videoId = url.match(NETFLIX_WATCH_RE)?.[1];
    if (!videoId) throw new Error('Could not extract Netflix video ID');

    // Netflix's page title is just "Netflix" — not useful.
    // Real title comes from the bridge (resolved in content script).
    // For now, use a placeholder that gets replaced.
    const title = 'Netflix Video';

    const content = `# ${title}\n\n## Transcript\n\n[Transcript available - fetching...]\n\n[NETFLIX_TRANSCRIPT:${videoId}]`;
    const wordCount = content.split(/\s+/).filter(Boolean).length;

    return {
      type: 'netflix',
      url,
      title,
      language: doc.documentElement.lang || undefined,
      content,
      wordCount,
      estimatedReadingTime: 0,
    };
  },
};
