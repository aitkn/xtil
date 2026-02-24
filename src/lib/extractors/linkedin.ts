import type { ContentExtractor, ExtractedContent, ExtractedImage } from './types';

/** Match individual post URLs */
const LI_POST_URL_RE =
  /linkedin\.com\/(feed\/update\/urn:li:(activity|ugcPost):\d+|posts\/[^/]+)/;

/** Match any LinkedIn page (for feed-based extraction) */
const LI_HOSTNAME_RE = /(^|\.)linkedin\.com$/;

export const linkedinExtractor: ContentExtractor = {
  canExtract(url: string, doc: Document): boolean {
    try {
      const hostname = new URL(url).hostname;
      if (!LI_HOSTNAME_RE.test(hostname)) return false;
    } catch {
      return false;
    }

    // Direct post URL
    if (LI_POST_URL_RE.test(url)) return true;

    // Feed or profile page with visible posts
    return findPostContainers(doc).length > 0;
  },

  extract(url: string, doc: Document): ExtractedContent {
    // On a direct post URL, extract the main post; on feed, pick the most visible
    const isDirectPost = LI_POST_URL_RE.test(url);
    const containers = findPostContainers(doc);

    let postEl: Element | null = null;

    if (isDirectPost && containers.length > 0) {
      // On a direct post page, prefer the first (main) post
      postEl = containers[0];
    } else if (containers.length > 0) {
      // Feed/profile: pick the post with the most viewport coverage
      postEl = pickMostVisiblePost(containers);
    }

    if (!postEl) {
      return fallbackExtract(url, doc);
    }

    // Click "see more" to expand truncated text
    clickSeeMore(postEl);

    const author = extractAuthor(postEl);
    const headline = extractHeadline(postEl);
    const timestamp = extractTimestamp(postEl);
    const postText = extractPostText(postEl);
    const postUrl = extractPostUrl(postEl, url);
    const { reactionCount, commentCount, repostCount } = extractEngagement(postEl);
    const images = extractPostImages(postEl);
    const richImages = buildRichImages(postEl);

    // Build markdown content
    const lines: string[] = [];

    if (author) {
      const headlineSuffix = headline ? ` — ${headline}` : '';
      lines.push(`# ${author}${headlineSuffix}`);
      lines.push('');
    }

    if (timestamp) {
      lines.push(`*${timestamp}*`);
      lines.push('');
    }

    if (postText) {
      lines.push(postText);
      lines.push('');
    }

    // Engagement metrics
    const metrics: string[] = [];
    if (reactionCount) metrics.push(`${reactionCount} reactions`);
    if (commentCount) metrics.push(`${commentCount} comments`);
    if (repostCount) metrics.push(`${repostCount} reposts`);
    if (metrics.length > 0) {
      lines.push('---');
      lines.push(metrics.join(' | '));
      lines.push('');
    }

    // Comments
    const comments = extractVisibleComments(postEl);
    if (comments.length > 0) {
      lines.push(`## Comments (${comments.length})`);
      lines.push('');
      for (const c of comments) {
        const likesStr = c.likes ? ` (${c.likes} reactions)` : '';
        lines.push(`**${c.author || 'Unknown'}**${likesStr}`);
        lines.push(c.text);
        lines.push('');
      }
    }

    const content = lines.join('\n');
    const wordCount = content.split(/\s+/).filter(Boolean).length;

    return {
      type: 'linkedin',
      url: postUrl,
      title: '', // Let LLM infer from content
      author: author || undefined,
      language: doc.documentElement.lang || undefined,
      content,
      wordCount,
      estimatedReadingTime: Math.ceil(wordCount / 200),
      thumbnailUrl: images[0] || undefined,
      thumbnailUrls: images.length > 1 ? images.slice(0, 4) : undefined,
      richImages: richImages.length > 0 ? richImages : undefined,
      comments: comments.length > 0 ? comments : undefined,
    };
  },
};

// ---------------------------------------------------------------------------
// Post container detection
// ---------------------------------------------------------------------------

function findPostContainers(doc: Document): Element[] {
  // Primary: feed-shared-update-v2 containers (stable LinkedIn class)
  let posts = Array.from(doc.querySelectorAll('.feed-shared-update-v2'));

  // Also try data-urn attribute on containers (urn:li:activity:*)
  if (posts.length === 0) {
    posts = Array.from(doc.querySelectorAll('[data-urn^="urn:li:activity:"], [data-urn^="urn:li:ugcPost:"]'));
  }

  // Filter out nested posts (reshared post inside another post)
  return posts.filter(el => !el.closest('.feed-shared-update-v2__content') &&
                             !el.parentElement?.closest('.feed-shared-update-v2'));
}

// ---------------------------------------------------------------------------
// Most-visible-post selection
// ---------------------------------------------------------------------------

function pickMostVisiblePost(containers: Element[]): Element {
  const viewportHeight = window.innerHeight;
  let best = containers[0];
  let bestArea = 0;

  for (const el of containers) {
    const rect = el.getBoundingClientRect();
    const visibleTop = Math.max(rect.top, 0);
    const visibleBottom = Math.min(rect.bottom, viewportHeight);
    const visibleHeight = Math.max(0, visibleBottom - visibleTop);
    const area = visibleHeight * rect.width;

    if (area > bestArea) {
      bestArea = area;
      best = el;
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// "See more" expansion
// ---------------------------------------------------------------------------

function clickSeeMore(postEl: Element): void {
  // LinkedIn's "…see more" button for truncated text
  const seeMoreBtns = postEl.querySelectorAll(
    '.feed-shared-inline-show-more-text button, ' +
    'button.feed-shared-inline-show-more-text__see-more-less-toggle'
  );
  for (const btn of seeMoreBtns) {
    const text = btn.textContent?.trim().toLowerCase() || '';
    if (text.includes('see more') || text === '…more') {
      (btn as HTMLElement).click();
    }
  }

  // Also try generic "see more" buttons within the post text area
  const allBtns = postEl.querySelectorAll('button');
  for (const btn of allBtns) {
    const text = btn.textContent?.trim().toLowerCase() || '';
    if ((text === '…see more' || text === 'see more' || text === '…more') &&
        !btn.closest('.comments-comments-list')) {
      (btn as HTMLElement).click();
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Field extractors
// ---------------------------------------------------------------------------

function extractAuthor(postEl: Element): string | null {
  // update-components-actor (newer layout)
  const actorName = postEl.querySelector(
    '.update-components-actor__name span[aria-hidden="true"], ' +
    '.update-components-actor__title span[aria-hidden="true"], ' +
    '.feed-shared-actor__name span[aria-hidden="true"]'
  );
  if (actorName?.textContent?.trim()) return actorName.textContent.trim();

  // Fallback: first strong/link in the actor container
  const actorContainer = postEl.querySelector(
    '.update-components-actor, .feed-shared-actor'
  );
  if (actorContainer) {
    const nameEl = actorContainer.querySelector('a span, a strong');
    if (nameEl?.textContent?.trim()) return nameEl.textContent.trim();
  }

  return null;
}

function extractHeadline(postEl: Element): string | null {
  const descEl = postEl.querySelector(
    '.update-components-actor__description span[aria-hidden="true"], ' +
    '.feed-shared-actor__description span[aria-hidden="true"]'
  );
  if (descEl?.textContent?.trim()) return descEl.textContent.trim();
  return null;
}

function extractTimestamp(postEl: Element): string | null {
  // sub-description often contains "3d • Edited" or "2h •"
  const subDesc = postEl.querySelector(
    '.update-components-actor__sub-description span[aria-hidden="true"], ' +
    '.feed-shared-actor__sub-description span[aria-hidden="true"]'
  );
  if (subDesc?.textContent?.trim()) {
    return subDesc.textContent.trim().replace(/\s*•\s*$/, '');
  }

  // Fallback: <time> element
  const timeEl = postEl.querySelector('time');
  if (timeEl) {
    return timeEl.getAttribute('datetime') || timeEl.textContent?.trim() || null;
  }

  return null;
}

function extractPostText(postEl: Element): string {
  // Main text container
  const textContainer = postEl.querySelector(
    '.feed-shared-update-v2__description, ' +
    '.update-components-text, ' +
    '.feed-shared-text, ' +
    '.feed-shared-inline-show-more-text'
  );

  if (textContainer) {
    return getCleanText(textContainer);
  }

  // Fallback: look for spans with dir="ltr" inside the post (common LinkedIn pattern)
  const ltrSpans = postEl.querySelectorAll('.break-words span[dir="ltr"]');
  if (ltrSpans.length > 0) {
    const parts: string[] = [];
    for (const span of ltrSpans) {
      const text = span.textContent?.trim();
      if (text) parts.push(text);
    }
    if (parts.length > 0) return parts.join('\n');
  }

  return '';
}

function getCleanText(el: Element): string {
  // Clone to avoid modifying the live DOM
  const clone = el.cloneNode(true) as HTMLElement;

  // Remove "see more"/"see less" buttons to avoid including their text
  clone.querySelectorAll('button').forEach(btn => {
    const text = btn.textContent?.trim().toLowerCase() || '';
    if (text.includes('see more') || text.includes('see less')) {
      btn.remove();
    }
  });

  // innerText preserves paragraph breaks from block-level elements
  const text = clone.innerText || '';
  return text.replace(/(\n\s*){3,}/g, '\n\n').trim();
}

function extractPostUrl(postEl: Element, pageUrl: string): string {
  // If the page URL is already a direct post link, use it
  if (LI_POST_URL_RE.test(pageUrl)) {
    return cleanLinkedInUrl(pageUrl);
  }

  // Try to find the post permalink from the timestamp link or share button
  // LinkedIn timestamps are usually links to the post
  const links = postEl.querySelectorAll('a[href]');
  for (const link of links) {
    const href = link.getAttribute('href') || '';
    if (LI_POST_URL_RE.test(href)) {
      try {
        return cleanLinkedInUrl(new URL(href, pageUrl).href);
      } catch { /* skip */ }
    }
  }

  // Try data-urn attribute to construct URL
  const urn = postEl.getAttribute('data-urn') ||
    postEl.closest('[data-urn]')?.getAttribute('data-urn');
  if (urn) {
    const activityMatch = urn.match(/urn:li:(?:activity|ugcPost):(\d+)/);
    if (activityMatch) {
      return `https://www.linkedin.com/feed/update/urn:li:activity:${activityMatch[1]}/`;
    }
  }

  return pageUrl;
}

function cleanLinkedInUrl(raw: string): string {
  try {
    const u = new URL(raw);
    // Remove tracking params
    const trackingParams = new Set([
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_content',
      'trackingId', 'refId', 'trk', 'midToken', 'midSig',
      'lipi', 'lici',
    ]);
    for (const key of [...u.searchParams.keys()]) {
      if (trackingParams.has(key)) {
        u.searchParams.delete(key);
      }
    }
    u.hash = '';
    return u.href;
  } catch {
    return raw;
  }
}

// ---------------------------------------------------------------------------
// Engagement metrics
// ---------------------------------------------------------------------------

function extractEngagement(postEl: Element): {
  reactionCount: string | null;
  commentCount: string | null;
  repostCount: string | null;
} {
  let reactionCount: string | null = null;
  let commentCount: string | null = null;
  let repostCount: string | null = null;

  // Reaction count: ".social-details-social-counts__reactions-count" or button with reactions
  const reactionsEl = postEl.querySelector(
    '.social-details-social-counts__reactions-count, ' +
    '[data-test-id="social-actions__reaction-count"], ' +
    'button.social-details-social-counts__count-value'
  );
  if (reactionsEl?.textContent?.trim()) {
    reactionCount = reactionsEl.textContent.trim();
  }

  // Comments + reposts: ".social-details-social-counts__social-proof-text"
  // Format: "N comments · N reposts" or "N comments" or "N reposts"
  const proofText = postEl.querySelector(
    '.social-details-social-counts__social-proof-text, ' +
    '.social-details-social-counts__item--right'
  );
  if (proofText) {
    // May have multiple spans/buttons inside
    const text = proofText.textContent?.trim() || '';
    const commentsMatch = text.match(/([\d,]+)\s*comments?/i);
    if (commentsMatch) commentCount = commentsMatch[1];
    const repostMatch = text.match(/([\d,]+)\s*reposts?/i);
    if (repostMatch) repostCount = repostMatch[1];
  }

  // Fallback: individual buttons
  if (!commentCount || !repostCount) {
    const buttons = postEl.querySelectorAll(
      '.social-details-social-counts button, ' +
      '.social-details-social-counts a'
    );
    for (const btn of buttons) {
      const text = btn.textContent?.trim() || '';
      if (!commentCount) {
        const m = text.match(/([\d,]+)\s*comments?/i);
        if (m) commentCount = m[1];
      }
      if (!repostCount) {
        const m = text.match(/([\d,]+)\s*reposts?/i);
        if (m) repostCount = m[1];
      }
    }
  }

  return { reactionCount, commentCount, repostCount };
}

// ---------------------------------------------------------------------------
// Image extraction
// ---------------------------------------------------------------------------

function extractPostImages(postEl: Element): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  const imgs = postEl.querySelectorAll(
    '.update-components-image img, ' +
    '.feed-shared-image img, ' +
    '.update-components-linkedin-video img'
  );
  for (const img of imgs) {
    const src = (img as HTMLImageElement).src || '';
    if (!src || seen.has(src)) continue;
    // Skip tiny icons and UI elements
    const width = (img as HTMLImageElement).naturalWidth || (img as HTMLImageElement).width || 0;
    if (width > 0 && width < 50) continue;
    // Skip LinkedIn UI assets
    if (src.includes('/li/track/') || src.includes('static.licdn.com/aero/')) continue;
    seen.add(src);
    urls.push(src);
  }

  // Also check for video poster images
  const videos = postEl.querySelectorAll('video');
  for (const video of videos) {
    const poster = video.poster || '';
    if (poster && !seen.has(poster)) {
      seen.add(poster);
      urls.push(poster);
    }
  }

  return urls;
}

function buildRichImages(postEl: Element): ExtractedImage[] {
  const results: ExtractedImage[] = [];
  const seen = new Set<string>();

  // Content images (not avatars, not UI)
  const imgs = postEl.querySelectorAll('img');
  for (const img of imgs) {
    const src = img.src || '';
    if (!src || seen.has(src)) continue;

    // Skip avatars, icons, UI
    if (src.includes('/li/track/') || src.includes('static.licdn.com/aero/')) continue;
    if (img.closest('.update-components-actor, .feed-shared-actor, .comments-comment-item')) continue;

    const width = img.naturalWidth || img.width || 0;
    const height = img.naturalHeight || img.height || 0;
    if (width > 0 && width < 50) continue;

    seen.add(src);
    const alt = img.alt || '';
    results.push({
      url: src,
      alt,
      tier: alt.length > 10 ? 'inline' : 'contextual',
      width: width || undefined,
      height: height || undefined,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Comment extraction
// ---------------------------------------------------------------------------

function extractVisibleComments(postEl: Element): Array<{
  author?: string;
  text: string;
  likes?: number;
}> {
  const comments: Array<{ author?: string; text: string; likes?: number }> = [];

  // LinkedIn comment containers
  const commentItems = postEl.querySelectorAll(
    '.comments-comment-item, ' +
    '.comments-comment-entity, ' +
    '[data-test-id="comments-comment-item"]'
  );

  for (const item of commentItems) {
    // Author
    const authorEl = item.querySelector(
      '.comments-post-meta__name-text span[aria-hidden="true"], ' +
      '.comments-comment-item__post-meta span[aria-hidden="true"], ' +
      '.comments-post-meta__name-text a'
    );
    const author = authorEl?.textContent?.trim() || undefined;

    // Comment text
    const textEl = item.querySelector(
      '.comments-comment-item__main-content, ' +
      '.comments-comment-texteditor + div, ' +
      '.update-components-text'
    );
    const text = textEl?.textContent?.trim() || '';
    if (!text) continue;

    // Reaction count
    let likes: number | undefined;
    const reactBtn = item.querySelector(
      '.comments-comment-social-bar__reactions-count, ' +
      'button[aria-label*="reaction"]'
    );
    if (reactBtn) {
      const reactText = reactBtn.textContent?.trim() || '';
      const m = reactText.match(/(\d[\d,]*)/);
      if (m) likes = parseInt(m[1].replace(/,/g, ''), 10);
    }

    comments.push({ author, text, likes });
  }

  return comments;
}

// ---------------------------------------------------------------------------
// Fallback for pages with no detected posts
// ---------------------------------------------------------------------------

function fallbackExtract(url: string, doc: Document): ExtractedContent {
  const title = doc.querySelector('title')?.textContent?.trim()
    ?.replace(/\s*\|\s*LinkedIn\s*$/, '')
    ?.replace(/^\(\d+\)\s*/, '') || '';

  const mainContent = doc.querySelector('main') || doc.body;
  const text = mainContent?.textContent?.replace(/\s+/g, ' ').trim() || '';
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  return {
    type: 'linkedin',
    url,
    title,
    content: text.slice(0, 5000),
    wordCount: Math.min(wordCount, 5000),
    estimatedReadingTime: Math.ceil(wordCount / 200),
    language: doc.documentElement.lang || undefined,
  };
}
