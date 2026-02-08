/**
 * Smart page title extraction.
 * Falls back to DOM-based heuristics when meta/document.title looks generic
 * (common on SPA sites like claude.ai, ChatGPT, etc.).
 */
export function extractTitle(doc: Document, url: string): string {
  const ogTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim();
  const docTitle = doc.title?.trim();
  const metaTitle = ogTitle || docTitle || '';

  if (metaTitle && !looksGeneric(metaTitle, url)) {
    return metaTitle;
  }

  const domTitle = findDomTitle(doc);
  if (domTitle) return domTitle;

  return metaTitle || 'Untitled Page';
}

/**
 * If Readability (or another extractor) already produced a title,
 * check whether it's generic and try to improve it from the DOM.
 */
export function refineTitleIfGeneric(title: string, doc: Document, url: string): string {
  if (title && !looksGeneric(title, url)) return title;

  const domTitle = findDomTitle(doc);
  if (domTitle) return domTitle;

  return title || 'Untitled Page';
}

/**
 * Heuristic: does this title look like a generic site/brand name
 * rather than a page-specific title?
 */
function looksGeneric(title: string, url: string): boolean {
  const words = title.split(/\s+/).filter(Boolean);

  // Multi-word titles (4+) are almost certainly descriptive
  if (words.length > 3) return false;

  // Check if the title matches the site/brand name from hostname
  // e.g. "Claude" on claude.ai, "ChatGPT" on chatgpt.com
  try {
    const hostname = new URL(url).hostname;
    const domainParts = hostname.replace(/^www\./, '').split('.');
    // Collect all substrings from the domain as potential brand names
    const domainWords = domainParts.flatMap((p) => p.split(/[-_]/)).map((w) => w.toLowerCase());
    if (words.length <= 2 && words.every((w) => domainWords.includes(w.toLowerCase()))) {
      return true;
    }
  } catch {
    // ignore URL parsing errors
  }

  const GENERIC_TITLES = new Set([
    'home', 'dashboard', 'app', 'chat', 'new tab', 'untitled',
    'inbox', 'feed', 'timeline', 'settings', 'profile', 'new chat',
  ]);
  if (GENERIC_TITLES.has(title.toLowerCase())) return true;

  return false;
}

/** Try to find a meaningful page title from DOM elements. */
function findDomTitle(doc: Document): string | null {
  // Strategy 1: h1 elements (strongest semantic signal)
  const h1s = doc.querySelectorAll('h1');
  for (const h1 of h1s) {
    const text = h1.textContent?.trim();
    if (text && text.length > 2 && text.length < 300) {
      return text;
    }
  }

  // Strategy 2: ARIA heading level 1
  const ariaH1s = doc.querySelectorAll('[role="heading"][aria-level="1"]');
  for (const heading of ariaH1s) {
    const text = heading.textContent?.trim();
    if (text && text.length > 2 && text.length < 300) {
      return text;
    }
  }

  // Strategy 3: Title-like elements common in SPAs
  const titleSelectors = [
    'header [data-testid*="title"]',
    '[data-testid*="page-title"]',
    '[data-testid*="chat-title"]',
    '[class*="page-title"]',
    '[class*="pageTitle"]',
    '[class*="chat-title"]',
    '[class*="chatTitle"]',
    '[class*="document-title"]',
    '[class*="documentTitle"]',
    '[class*="conversation-title"]',
  ];

  for (const selector of titleSelectors) {
    try {
      const els = doc.querySelectorAll(selector);
      for (const el of els) {
        const text = el.textContent?.trim();
        if (text && text.length > 2 && text.length < 300) {
          return text;
        }
      }
    } catch {
      // ignore invalid selectors
    }
  }

  return null;
}
