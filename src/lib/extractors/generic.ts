import type { ContentExtractor, ExtractedContent } from './types';
import { extractRichImages } from './image-utils';
import { extractTitle } from './title-utils';

export const genericExtractor: ContentExtractor = {
  canExtract(): boolean {
    return true; // always usable as fallback
  },

  extract(url: string, doc: Document): ExtractedContent {
    const title = extractTitle(doc, url);

    const author =
      doc.querySelector('meta[name="author"]')?.getAttribute('content') ||
      undefined;

    const description =
      doc.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
      doc.querySelector('meta[name="description"]')?.getAttribute('content') ||
      '';

    const language = doc.documentElement.lang || undefined;

    // Extract main content area
    const contentRoot = findContentRoot(doc);
    const content = contentRoot
      ? cleanText(contentRoot.textContent || '')
      : (description || 'No readable content found on this page.');
    const wordCount = content.split(/\s+/).filter(Boolean).length;
    const richImages = contentRoot ? extractRichImages(contentRoot) : [];

    return {
      type: 'generic',
      url,
      title,
      author,
      language,
      content,
      wordCount,
      estimatedReadingTime: Math.ceil(wordCount / 200),
      richImages,
    };
  },
};

function findContentRoot(doc: Document): HTMLElement | null {
  const mainSelectors = [
    'main',
    'article',
    '[role="main"]',
    '#content',
    '#main-content',
    '.main-content',
    '.post-content',
    '.entry-content',
    '.article-content',
  ];

  for (const selector of mainSelectors) {
    const el = doc.querySelector(selector) as HTMLElement | null;
    if (el) {
      const text = cleanText(el.textContent || '');
      if (text.length > 100) return el;
    }
  }

  // Fallback: grab body, removing nav/footer/header
  const body = doc.body?.cloneNode(true) as HTMLElement | null;
  if (!body) return null;
  const removable = body.querySelectorAll('nav, footer, header, script, style, [role="navigation"], [role="banner"], [role="contentinfo"], aside');
  removable.forEach((el) => el.remove());

  const text = cleanText(body.textContent || '');
  return text.length > 50 ? body : null;
}

function cleanText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .trim();
}
