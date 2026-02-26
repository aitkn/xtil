import type { ContentExtractor, ExtractedContent } from './types';

export const pdfExtractor: ContentExtractor = {
  canExtract(_url: string, doc: Document): boolean {
    // Chrome's built-in PDF viewer sets contentType to 'application/pdf'
    if (doc.contentType === 'application/pdf') return true;

    // Fallback: Chrome PDF viewer renders a single <embed type="application/pdf">
    const embed = doc.querySelector('embed[type="application/pdf"]');
    if (embed) return true;

    return false;
  },

  extract(url: string, doc: Document): ExtractedContent {
    // Chrome may set <title> to the filename
    const rawTitle = doc.querySelector('title')?.textContent?.trim() || '';
    const title =
      rawTitle
        .replace(/\.pdf$/i, '')
        .replace(/\s*-\s*$/, '')
        .trim() || 'PDF Document';

    return {
      type: 'pdf',
      url,
      title,
      content: `[Extracting PDF text...]\n\n[PDF_EXTRACT:${url}]`,
      wordCount: 0,
      estimatedReadingTime: 0,
    };
  },
};
