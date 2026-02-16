import type { ExtractedComment } from './types';

export function extractComments(doc: Document, url: string): ExtractedComment[] {
  // Facebook comments are handled by the async loader in content/index.ts
  if (/facebook\.com/.test(url)) return [];
  // Reddit comments come from background JSON fetch
  if (/reddit\.com/.test(url)) return [];
  // X replies are extracted by the X extractor
  if (/(?:twitter|x)\.com/.test(url)) return [];
  // GitHub comments are embedded by the GitHub extractor
  if (/github\.com/.test(url)) return [];

  if (/youtube\.com|youtu\.be/.test(url)) {
    return extractYouTubeComments(doc);
  }
  return extractGenericComments(doc);
}

function extractYouTubeComments(doc: Document): ExtractedComment[] {
  const comments: ExtractedComment[] = [];

  // YouTube renders comments dynamically; try to grab what's in the DOM
  const commentRenderers = doc.querySelectorAll('ytd-comment-renderer, ytd-comment-view-model');
  for (const renderer of commentRenderers) {
    const author =
      renderer.querySelector('#author-text')?.textContent?.trim() ||
      renderer.querySelector('.author-text')?.textContent?.trim() ||
      undefined;

    const text =
      renderer.querySelector('#content-text')?.textContent?.trim() ||
      renderer.querySelector('.comment-text')?.textContent?.trim() ||
      '';

    const likesEl = renderer.querySelector('#vote-count-middle, .vote-count');
    const likesText = likesEl?.textContent?.trim() || '';
    const likes = parseLikeCount(likesText);

    if (text) {
      comments.push({ author, text, likes });
    }
  }

  return comments;
}

// ---------------------------------------------------------------------------
// Schema.org JSON-LD extraction
// ---------------------------------------------------------------------------

function extractSchemaOrgComments(doc: Document): ExtractedComment[] {
  const comments: ExtractedComment[] = [];
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');

  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent || '');
      collectSchemaComments(data, comments);
    } catch { /* malformed JSON-LD, skip */ }
  }

  return deduplicateComments(comments);
}

/** Recursively walk a JSON-LD object looking for Comment nodes */
function collectSchemaComments(obj: unknown, out: ExtractedComment[]): void {
  if (!obj || typeof obj !== 'object') return;

  if (Array.isArray(obj)) {
    for (const item of obj) collectSchemaComments(item, out);
    return;
  }

  const node = obj as Record<string, unknown>;

  // Check if this node is a Comment
  const nodeType = node['@type'];
  if (nodeType === 'Comment' || nodeType === 'UserComments') {
    const text =
      (typeof node.text === 'string' ? node.text : '') ||
      (typeof node.description === 'string' ? node.description : '') ||
      (typeof node.commentText === 'string' ? node.commentText : '');

    if (text.trim()) {
      const authorObj = node.author as Record<string, unknown> | undefined;
      const author =
        (typeof authorObj?.name === 'string' ? authorObj.name : undefined) ||
        (typeof node.author === 'string' ? node.author : undefined);

      const likes =
        typeof node.upvoteCount === 'number' ? node.upvoteCount :
        typeof node.upvoteCount === 'string' ? parseLikeCount(node.upvoteCount) :
        undefined;

      out.push({ author: author?.trim(), text: text.trim(), likes });
    }
  }

  // Recurse into known container properties
  for (const key of ['comment', '@graph', 'mainEntity', 'mainEntityOfPage', 'discusses']) {
    if (node[key]) collectSchemaComments(node[key], out);
  }
}

// ---------------------------------------------------------------------------
// Generic DOM heuristics
// ---------------------------------------------------------------------------

function extractGenericComments(doc: Document): ExtractedComment[] {
  // Schema.org is the most reliable source — use it if available
  const schemaComments = extractSchemaOrgComments(doc);
  if (schemaComments.length > 0) return schemaComments;

  const comments: ExtractedComment[] = [];

  // Heuristic selectors for common comment patterns
  const selectors = [
    // WordPress
    '.comment-content',
    '.comment-body',
    // wpDiscuz
    '.wpd-comment-text',
    // Commento
    '.commento-body',
    // Remark42
    '.comment__text',
    // Isso
    '.isso-text',
    // Generic patterns
    '[data-comment]',
    '[data-comment-id]',
    '[data-testid*="comment"]',
    '[class*="comment-text"]',
    '[class*="comment-body"]',
    '[class*="comment-content"]',
    '.comment p',
    '#comments .text',
  ];

  // Try to find a comment section container.
  // Some sites use #comments on an <h2> heading — skip headings and other
  // non-container elements that can't hold comment children.
  const containerCandidates = [
    '#comments',
    '#comment-section',
    '#comments-section',
    '#disqus_thread',
    '#commentlist',
    '.commentlist',
    '[data-comments-container]',
    '[class*="comments-area"]',
    '[class*="comment-section"]',
    '[data-comments]',
    '[class*="comments"]',
    '[id*="comments"]',
    '.discussion',
  ];

  let commentSection: Element | null = null;
  for (const sel of containerCandidates) {
    const el = doc.querySelector(sel);
    // Skip headings, anchors, and other non-container elements.
    // A real comment section must be a block element with children.
    if (el && el.children.length >= 1 && !/^(H[1-6]|A|SPAN|LABEL|INPUT|IMG)$/.test(el.tagName)) {
      commentSection = el;
      break;
    }
  }

  const searchRoot = commentSection || doc;

  for (const selector of selectors) {
    const elements = searchRoot.querySelectorAll(selector);
    if (elements.length === 0) continue;

    for (const el of elements) {
      const text = el.textContent?.trim() || '';
      if (text.length < 5) continue;

      // Try to find the enclosing comment block that also holds author/likes.
      // Start from parentElement because el itself often matches [class*="comment"]
      // (e.g. .comment-content) which would prevent walking up to the wrapper.
      const parent =
        el.parentElement?.closest('[class*="comment"]') ||
        el.closest('li') ||
        el.parentElement;
      const author = findAuthor(parent);
      const likes = findLikes(parent);

      comments.push({ author, text, likes });
    }

    if (comments.length > 0) break; // use first selector that matches
  }

  // Fallback: match comments by ID pattern (e.g. id="comment123", id="comment-456")
  // Many CMS/custom systems use this convention without semantic CSS classes
  if (comments.length === 0 && commentSection) {
    const idCandidates = commentSection.querySelectorAll('[id]');
    const commentEls = Array.from(idCandidates).filter(el => /^comment-?\d+$/.test(el.id));
    if (commentEls.length >= 2) {
      for (const el of commentEls) {
        const author = findAuthor(el);
        const text = extractCommentBody(el, author);
        if (text.length < 2) continue;
        const likes = findLikes(el);
        comments.push({ author, text, likes });
      }
    }
  }

  return deduplicateComments(comments);
}

/** Search nearby elements for an author name */
function findAuthor(parent: Element | null): string | undefined {
  if (!parent) return undefined;

  const authorEl =
    parent.querySelector('[itemprop="author"]') ||
    parent.querySelector('[class*="author"]') ||
    parent.querySelector('[class*="username"]') ||
    parent.querySelector('[class*="user-name"]') ||
    parent.querySelector('[class*="commenter"]') ||
    parent.querySelector('[class*="display-name"]') ||
    parent.querySelector('a[rel="author"]') ||
    parent.querySelector('cite') ||  // WordPress default
    parent.querySelector('.fn');      // vCard microformat

  if (authorEl) return authorEl.textContent?.trim() || undefined;

  // Fallback: profile link with aria-label (e.g. ixbt.com)
  const ariaLink = parent.querySelector('a[aria-label][href*="profile"]');
  return ariaLink?.getAttribute('aria-label')?.trim() || undefined;
}

/**
 * Extract comment body text from a comment block that lacks semantic CSS classes.
 * Used by the ID-pattern fallback where Tailwind utility classes cause false
 * positives with generic [class*="text"] selectors. Instead, relies on the
 * typical layout: [header, body, actions] where children[1] is the comment body.
 */
function extractCommentBody(el: Element, author?: string): string {
  // Typical layout: [header (avatar+author), body, actions].
  // Take children[1] specifically — don't scan further to avoid grabbing action buttons.
  const children = Array.from(el.children);
  if (children.length >= 2) {
    const bodyText = children[1].textContent?.trim() || '';
    if (bodyText.length >= 2) return bodyText;
  }

  // Fallback: full textContent, stripping author name prefix
  let text = el.textContent?.trim() || '';
  if (author && text.startsWith(author)) {
    text = text.slice(author.length).trim();
  }
  return text;
}

/** Search nearby elements for a like/upvote count */
function findLikes(parent: Element | null): number | undefined {
  if (!parent) return undefined;

  // Check data attribute first
  const dataLikes = parent.querySelector('[data-likes]');
  if (dataLikes) {
    const val = parseLikeCount(dataLikes.getAttribute('data-likes') || '');
    if (val != null) return val;
  }

  // Search for like/upvote count elements
  const likesEl =
    parent.querySelector('[class*="like"] [class*="count"]') ||
    parent.querySelector('[class*="upvote"]') ||
    parent.querySelector('[class*="like-count"]') ||
    parent.querySelector('[class*="likes"]');

  if (likesEl) {
    return parseLikeCount(likesEl.textContent?.trim() || '');
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deduplicateComments(comments: ExtractedComment[]): ExtractedComment[] {
  const seen = new Set<string>();
  return comments.filter((c) => {
    if (seen.has(c.text)) return false;
    seen.add(c.text);
    return true;
  });
}

export function parseLikeCount(text: string): number | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/[,\s]/g, '');
  if (/^\d+$/.test(cleaned)) return parseInt(cleaned, 10);
  const kMatch = cleaned.match(/^(\d+(?:\.\d+)?)K$/i);
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);
  const mMatch = cleaned.match(/^(\d+(?:\.\d+)?)M$/i);
  if (mMatch) return Math.round(parseFloat(mMatch[1]) * 1000000);
  return undefined;
}
