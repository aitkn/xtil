import type { ContentExtractor, ExtractedContent, ExtractedImage, ExtractOptions } from './types';

const TWITTER_STATUS_RE = /(?:twitter\.com|x\.com)\/(\w+)\/status\/(\d+)/;

/** Match any X/Twitter hostname */
const TWITTER_HOSTNAME_RE = /(^|\.)(?:twitter\.com|x\.com)$/;

export const twitterExtractor: ContentExtractor = {
  canExtract(url: string, doc: Document): boolean {
    try {
      const hostname = new URL(url).hostname;
      if (!TWITTER_HOSTNAME_RE.test(hostname)) return false;
    } catch {
      return false;
    }

    // Direct tweet URL
    if (TWITTER_STATUS_RE.test(url)) return true;

    // Feed/profile/search page with visible articles
    return doc.querySelectorAll('article').length > 0;
  },

  extract(url: string, doc: Document, options?: ExtractOptions): ExtractedContent {
    const isDirectTweet = TWITTER_STATUS_RE.test(url);

    if (isDirectTweet) {
      return extractDirectTweet(url, doc);
    }

    // Feed mode: pick the most visible article
    return extractFeedTweet(url, doc, options);
  },
};

// ---------------------------------------------------------------------------
// Direct tweet extraction (existing /status/ URL logic)
// ---------------------------------------------------------------------------

function extractDirectTweet(url: string, doc: Document): ExtractedContent {
  const urlMatch = url.match(TWITTER_STATUS_RE);
  const mainAuthor = urlMatch?.[1] || '';

  // Find all article elements (tweets)
  const articles = doc.querySelectorAll('article');
  const tweets: ParsedTweet[] = [];

  for (const article of articles) {
    const tweet = parseArticle(article);
    if (tweet) tweets.push(tweet);
  }

  // First tweet in the conversation region is the main tweet
  // It's the one whose author matches the URL, or simply the first one
  let mainTweet: ParsedTweet | undefined;
  let replies: ParsedTweet[] = [];

  const mainIdx = tweets.findIndex(
    (t) => t.handle.toLowerCase() === mainAuthor.toLowerCase(),
  );
  if (mainIdx >= 0) {
    mainTweet = tweets[mainIdx];
    replies = tweets.filter((_, i) => i !== mainIdx);
  } else if (tweets.length > 0) {
    mainTweet = tweets[0];
    replies = tweets.slice(1);
  }

  // Detect threads: sequential replies by the same author as the main tweet
  const threadParts: string[] = [];
  const nonThreadReplies: ParsedTweet[] = [];

  if (mainTweet) {
    for (const reply of replies) {
      if (reply.handle.toLowerCase() === mainTweet.handle.toLowerCase() && nonThreadReplies.length === 0) {
        // Part of the thread (only consecutive same-author replies before other replies)
        threadParts.push(reply.text);
      } else {
        nonThreadReplies.push(reply);
      }
    }
  }

  // Build content
  const lines: string[] = [];

  if (mainTweet) {
    lines.push(`# ${mainTweet.displayName} (@${mainTweet.handle})`);
    lines.push('');
    lines.push(mainTweet.text);
    if (threadParts.length > 0) {
      for (const part of threadParts) {
        lines.push('');
        lines.push(part);
      }
    }
    lines.push('');

    // Engagement metrics
    const metrics: string[] = [];
    if (mainTweet.replies !== undefined) metrics.push(`${formatCount(mainTweet.replies)} replies`);
    if (mainTweet.reposts !== undefined) metrics.push(`${formatCount(mainTweet.reposts)} reposts`);
    if (mainTweet.likes !== undefined) metrics.push(`${formatCount(mainTweet.likes)} likes`);
    if (mainTweet.views !== undefined) metrics.push(`${formatCount(mainTweet.views)} views`);
    if (metrics.length > 0) {
      lines.push(`---`);
      lines.push(metrics.join(' | '));
      lines.push('');
    }
  }

  // Replies section
  if (nonThreadReplies.length > 0) {
    lines.push('## Replies');
    lines.push('');

    for (const reply of nonThreadReplies) {
      const likes = reply.likes !== undefined ? ` (${formatCount(reply.likes)} likes)` : '';
      lines.push(`**${reply.displayName}** (@${reply.handle})${likes}: ${reply.text}`);
      lines.push('');
    }
  }

  const content = lines.join('\n');
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  const title = mainTweet?.text
    ? mainTweet.text.slice(0, 120).trim() + (mainTweet.text.length > 120 ? '...' : '')
    : '';

  // Extract images from tweets
  const richImages = extractTweetImages(doc);

  // Get only the main tweet's own attached media grid (excluding quoted tweet media)
  const mainArticle = mainTweet ? findMainArticle(doc.querySelectorAll('article'), mainTweet.handle) : undefined;
  const thumbnailUrls = mainArticle ? extractMediaGridUrls(mainArticle).slice(0, 4) : [];

  // X/Twitter og:image is always a generic logo — use actual tweet images instead
  const ogImage = doc.querySelector('meta[property="og:image"]')?.getAttribute('content');
  const hasRealOgImage = ogImage && !ogImage.includes('abs.twimg.com/rweb/');
  const thumbnailUrl =
    (thumbnailUrls.length > 0 ? thumbnailUrls[0] : undefined) ||
    (richImages.length > 0 ? richImages[0].url : undefined) ||
    (hasRealOgImage ? ogImage : undefined);

  return {
    type: 'twitter',
    url: normalizeTwitterUrl(url),
    title,
    author: mainTweet?.displayName || mainAuthor || undefined,
    language: doc.documentElement.lang || undefined,
    content,
    wordCount,
    estimatedReadingTime: Math.ceil(wordCount / 200),
    thumbnailUrl,
    thumbnailUrls: thumbnailUrls.length > 1 ? thumbnailUrls : undefined,
    richImages: richImages.length > 0 ? richImages : undefined,
  };
}

// ---------------------------------------------------------------------------
// Feed-mode extraction (home, explore, profile, search)
// ---------------------------------------------------------------------------

function extractFeedTweet(url: string, doc: Document, options?: ExtractOptions): ExtractedContent {
  const articles = Array.from(doc.querySelectorAll('article'));
  const targetArticle = articles.length > 0 ? pickMostVisibleArticle(articles) : null;

  if (!targetArticle) {
    // No articles found — return minimal content
    const title = doc.querySelector('title')?.textContent?.trim() || '';
    return {
      type: 'twitter',
      url: normalizeTwitterUrl(url),
      title,
      content: '',
      wordCount: 0,
      estimatedReadingTime: 0,
      language: doc.documentElement.lang || undefined,
    };
  }

  const tweet = parseArticle(targetArticle);
  if (!tweet) {
    return {
      type: 'twitter',
      url: normalizeTwitterUrl(url),
      title: '',
      content: '',
      wordCount: 0,
      estimatedReadingTime: 0,
      language: doc.documentElement.lang || undefined,
    };
  }

  // Extract permalink from the article's status link
  const postUrl = extractArticlePermalink(targetArticle, url);

  // Build content
  const lines: string[] = [];
  lines.push(`# ${tweet.displayName} (@${tweet.handle})`);
  lines.push('');
  lines.push(tweet.text);
  lines.push('');

  // Engagement metrics
  const metrics: string[] = [];
  if (tweet.replies !== undefined) metrics.push(`${formatCount(tweet.replies)} replies`);
  if (tweet.reposts !== undefined) metrics.push(`${formatCount(tweet.reposts)} reposts`);
  if (tweet.likes !== undefined) metrics.push(`${formatCount(tweet.likes)} likes`);
  if (tweet.views !== undefined) metrics.push(`${formatCount(tweet.views)} views`);
  if (metrics.length > 0) {
    lines.push('---');
    lines.push(metrics.join(' | '));
    lines.push('');
  }

  const content = lines.join('\n');
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  const title = tweet.text.slice(0, 120).trim() + (tweet.text.length > 120 ? '...' : '');

  // Images from the target article only
  const richImages = extractArticleMedia(targetArticle);
  const thumbnailUrls = extractMediaGridUrls(targetArticle).slice(0, 4);
  const thumbnailUrl =
    (thumbnailUrls.length > 0 ? thumbnailUrls[0] : undefined) ||
    (richImages.length > 0 ? richImages[0].url : undefined);

  return {
    type: 'twitter',
    url: postUrl,
    title,
    author: tweet.displayName || undefined,
    language: doc.documentElement.lang || undefined,
    content,
    wordCount,
    estimatedReadingTime: Math.ceil(wordCount / 200),
    thumbnailUrl,
    thumbnailUrls: thumbnailUrls.length > 1 ? thumbnailUrls : undefined,
    richImages: richImages.length > 0 ? richImages : undefined,
  };
}

// ---------------------------------------------------------------------------
// Most-visible article selection (same scoring as LinkedIn)
// ---------------------------------------------------------------------------

function pickMostVisibleArticle(articles: Element[]): Element {
  const viewportHeight = window.innerHeight;

  let best = articles[0];
  let bestScore = -Infinity;

  for (const el of articles) {
    const rect = el.getBoundingClientRect();
    if (rect.height === 0) continue;

    const visibleTop = Math.max(rect.top, 0);
    const visibleBottom = Math.min(rect.bottom, viewportHeight);
    const visibleHeight = Math.max(0, visibleBottom - visibleTop);
    const visibleRatio = visibleHeight / rect.height; // 0..1

    // Fully visible posts (ratio >= 0.95) get a large bonus over partial ones
    const fullyVisible = visibleRatio >= 0.95 ? 1000 : 0;

    // Among posts with equal visibility tier, prefer the one closest to the top.
    const topScore = -Math.max(rect.top, 0);

    // Tiebreaker: visible ratio (for partially visible posts)
    const score = fullyVisible + topScore + visibleRatio * 100;

    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Extract permalink from an article element
// ---------------------------------------------------------------------------

function extractArticlePermalink(article: Element, fallbackUrl: string): string {
  const links = article.querySelectorAll('a[href]');
  for (const link of links) {
    const href = link.getAttribute('href') || '';
    if (TWITTER_STATUS_RE.test(href)) {
      try {
        return normalizeTwitterUrl(new URL(href, fallbackUrl).href);
      } catch { /* skip */ }
    }
  }
  return normalizeTwitterUrl(fallbackUrl);
}

// ---------------------------------------------------------------------------

interface ParsedTweet {
  displayName: string;
  handle: string;
  text: string;
  replies?: number;
  reposts?: number;
  likes?: number;
  views?: number;
}

function parseArticle(article: Element): ParsedTweet | null {
  // Extract from the aria-label which contains a structured summary
  const ariaLabel = article.getAttribute('aria-label') || '';

  // aria-label format: "DisplayName Verified account @handle Date Text N replies, N reposts, N likes, N bookmarks, N views"
  // Parse engagement from buttons instead (more reliable)

  // Get author info from links within the article
  let displayName = '';
  let handle = '';

  // Find all links - author links typically come first
  const links = article.querySelectorAll('a');
  for (const link of links) {
    const href = link.getAttribute('href') || '';
    const text = link.textContent?.trim() || '';

    // Handle link: "/@username"
    if (/^\/\w+$/.test(href) && !href.startsWith('/i/') && !href.includes('/status/')) {
      if (text.startsWith('@')) {
        handle = text.slice(1);
      } else if (text && !displayName && text.length < 100) {
        displayName = text;
      }
    }
  }

  if (!handle && !displayName) return null;

  // Extract tweet text from StaticText nodes that aren't part of buttons/links
  const text = extractTweetText(article);
  if (!text) return null;

  // Parse engagement metrics from buttons
  const buttons = article.querySelectorAll('button');
  let replies: number | undefined;
  let reposts: number | undefined;
  let likes: number | undefined;
  let views: number | undefined;

  for (const btn of buttons) {
    const btnText = btn.textContent?.trim() || '';
    const ariaLbl = btn.getAttribute('aria-label') || btnText;

    const replyMatch = ariaLbl.match(/^(\d[\d,.]*[KMB]?)\s*Repl/i);
    if (replyMatch) { replies = parseMetricCount(replyMatch[1]); continue; }

    const repostMatch = ariaLbl.match(/^(\d[\d,.]*[KMB]?)\s*repost/i);
    if (repostMatch) { reposts = parseMetricCount(repostMatch[1]); continue; }

    const likeMatch = ariaLbl.match(/^(\d[\d,.]*[KMB]?)\s*Like/i);
    if (likeMatch) { likes = parseMetricCount(likeMatch[1]); continue; }
  }

  // Views are in a link, not a button
  for (const link of links) {
    const href = link.getAttribute('href') || '';
    if (href.includes('/analytics')) {
      const viewText = link.textContent?.trim() || '';
      const viewMatch = viewText.match(/([\d,.]+[KMB]?)/);
      if (viewMatch) views = parseMetricCount(viewMatch[1]);
    }
  }

  return { displayName, handle, text, replies, reposts, likes, views };
}

function extractTweetText(article: Element): string {
  // Use X's data-testid="tweetText" container — reliably contains only the tweet text
  // with @mentions and URLs preserved, excluding all UI chrome.
  const tweetTextEl = article.querySelector('[data-testid="tweetText"]');
  if (tweetTextEl) {
    return (tweetTextEl.textContent || '').replace(/\s+/g, ' ').trim();
  }
  return '';
}

function parseMetricCount(text: string): number | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/[,\s]/g, '');
  if (/^\d+$/.test(cleaned)) return parseInt(cleaned, 10);
  const kMatch = cleaned.match(/^([\d.]+)K$/i);
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);
  const mMatch = cleaned.match(/^([\d.]+)M$/i);
  if (mMatch) return Math.round(parseFloat(mMatch[1]) * 1000000);
  const bMatch = cleaned.match(/^([\d.]+)B$/i);
  if (bMatch) return Math.round(parseFloat(bMatch[1]) * 1000000000);
  return undefined;
}

function formatCount(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

/** Find the article element that corresponds to the main tweet by matching the author handle */
function findMainArticle(articles: NodeListOf<Element>, handle: string): Element | undefined {
  for (const article of articles) {
    const links = article.querySelectorAll('a');
    for (const link of links) {
      const text = link.textContent?.trim() || '';
      if (text === `@${handle}`) return article;
    }
  }
  // Fallback: first article
  return articles.length > 0 ? articles[0] : undefined;
}

/** Extract only the main tweet's own media grid URLs (tweetPhoto containers, excluding quoted tweets) */
function extractMediaGridUrls(article: Element): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  // Images inside tweetPhoto containers (the actual media grid)
  const tweetPhotos = article.querySelectorAll('[data-testid="tweetPhoto"] img');
  for (const img of tweetPhotos) {
    if (isInsideQuotedTweet(img, article)) continue;
    const src = (img as HTMLImageElement).src || '';
    if (!src.includes('pbs.twimg.com')) continue;
    if (seen.has(src)) continue;
    seen.add(src);
    urls.push(src);
  }

  // Video posters (not inside quoted tweets)
  const videos = article.querySelectorAll('video');
  for (const video of videos) {
    if (isInsideQuotedTweet(video, article)) continue;
    const poster = video.poster || '';
    if (!poster.includes('pbs.twimg.com') || seen.has(poster)) continue;
    seen.add(poster);
    urls.push(poster);
  }

  return urls;
}

/** Check if an element is nested inside a quoted tweet within the article */
function isInsideQuotedTweet(el: Element, article: Element): boolean {
  let parent = el.parentElement;
  while (parent && parent !== article) {
    // Quoted tweets are wrapped in a role="link" container that has its own tweetText
    if (parent.getAttribute('role') === 'link' && parent.querySelector('[data-testid="tweetText"]')) {
      return true;
    }
    parent = parent.parentElement;
  }
  return false;
}

/** Extract images and video posters from a single article element (all media, for richImages) */
function extractArticleMedia(article: Element): ExtractedImage[] {
  const results: ExtractedImage[] = [];
  const seen = new Set<string>();

  const imgs = article.querySelectorAll('img');
  for (const img of imgs) {
    const src = img.src || '';
    if (!src.includes('pbs.twimg.com')) continue;
    if (src.includes('profile_images') || src.includes('emoji')) continue;
    if (seen.has(src)) continue;
    seen.add(src);

    const alt = img.alt || '';
    const width = img.naturalWidth || img.width || 0;
    const height = img.naturalHeight || img.height || 0;

    results.push({
      url: src,
      alt,
      tier: alt.length > 10 ? 'inline' : 'contextual',
      width: width || undefined,
      height: height || undefined,
    });
  }

  const videos = article.querySelectorAll('video');
  for (const video of videos) {
    const poster = video.poster || '';
    if (!poster.includes('pbs.twimg.com')) continue;
    if (seen.has(poster)) continue;
    seen.add(poster);

    results.push({
      url: poster,
      alt: 'Video thumbnail',
      tier: 'inline',
    });
  }

  return results;
}

function extractTweetImages(doc: Document): ExtractedImage[] {
  const results: ExtractedImage[] = [];
  const seen = new Set<string>();

  const articles = doc.querySelectorAll('article');
  for (const article of articles) {
    for (const img of extractArticleMedia(article)) {
      if (!seen.has(img.url)) {
        seen.add(img.url);
        results.push(img);
      }
    }
  }

  return results;
}

function normalizeTwitterUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    return u.href;
  } catch {
    return url;
  }
}
