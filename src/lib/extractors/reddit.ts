import type { ContentExtractor, ExtractedContent, ExtractedImage } from './types';

const REDDIT_POST_RE = /reddit\.com\/r\/\w+\/comments\//;

export const redditExtractor: ContentExtractor = {
  canExtract(url: string): boolean {
    return REDDIT_POST_RE.test(url);
  },

  extract(url: string, doc: Document): ExtractedContent {
    // Extract basic metadata from DOM
    const title =
      doc.querySelector('h1')?.textContent?.trim() ||
      doc.querySelector('title')?.textContent?.replace(/ : \w+$/, '').replace(/ - Reddit$/, '').trim() ||
      '';

    const subredditMatch = url.match(/\/r\/(\w+)\//);
    const subreddit = subredditMatch?.[1] || undefined;

    // Try to get post author from DOM
    const author = extractRedditAuthor(doc);

    // Normalize the URL for JSON fetch (strip query params, trailing slashes)
    const normalizedUrl = normalizeRedditUrl(url);

    // Emit placeholder — background will fetch JSON and replace
    const content = `[Fetching Reddit discussion...]\n\n[REDDIT_JSON:${normalizedUrl}]`;

    return {
      type: 'reddit',
      url: normalizedUrl,
      title,
      author: author || undefined,
      language: doc.documentElement.lang || undefined,
      content,
      wordCount: 0,
      estimatedReadingTime: 0,
      subreddit,
    };
  },
};

function extractRedditAuthor(doc: Document): string | null {
  // New Reddit: shreddit-post has author attribute
  const shredditPost = doc.querySelector('shreddit-post');
  if (shredditPost) {
    const author = shredditPost.getAttribute('author');
    if (author) return author;
  }

  // Old Reddit: .top-matter .author
  const authorEl = doc.querySelector('.top-matter .author');
  if (authorEl?.textContent) return authorEl.textContent.trim();

  return null;
}

function normalizeRedditUrl(url: string): string {
  try {
    const u = new URL(url);
    // Strip query params and hash
    u.search = '';
    u.hash = '';
    // Ensure trailing slash
    if (!u.pathname.endsWith('/')) u.pathname += '/';
    return u.href;
  } catch {
    return url;
  }
}

// --- Reddit JSON parsing (called from background service worker) ---

interface RedditComment {
  author: string;
  body: string;
  score: number;
  depth: number;
  isOP: boolean;
  replies: RedditComment[];
}

interface RedditPostData {
  title: string;
  selftext: string;
  author: string;
  score: number;
  subreddit: string;
  num_comments: number;
  url: string;
  is_self: boolean;
  link_flair_text?: string;
  thumbnail?: string;
  preview_url?: string;
  post_hint?: string;
}

export function buildRedditMarkdown(
  post: RedditPostData,
  commentsRaw: unknown[],
): { markdown: string; wordCount: number; title: string; commentCount: number; postScore: number; subreddit: string; author: string; thumbnailUrl?: string; richImages?: ExtractedImage[] } {
  const comments = flattenCommentTree(commentsRaw, post.author, 0, 4);

  // Filter out noise
  const filtered = comments.filter((c) => {
    if (c.author === '[deleted]' || c.author === '[removed]') return false;
    if (c.body === '[deleted]' || c.body === '[removed]') return false;
    if (c.author === 'AutoModerator') return false;
    // Keep top-level even with low score, filter nested low-score
    if (c.depth > 0 && c.score <= 0) return false;
    return true;
  });

  // Sort top-level by score desc
  const topLevel = filtered.filter((c) => c.depth === 0).sort((a, b) => b.score - a.score);

  // Build markdown
  const lines: string[] = [];

  // Title and post body
  lines.push(`# ${post.title}`);
  if (post.link_flair_text) lines.push(`*Flair: ${post.link_flair_text}*`);
  lines.push(`**r/${post.subreddit}** | **u/${post.author}** | ${post.score} points | ${post.num_comments} comments`);
  lines.push('');

  if (post.selftext) {
    lines.push(post.selftext);
    lines.push('');
  } else if (!post.is_self) {
    lines.push(`*Link post: ${post.url}*`);
    lines.push('');
  }

  // Discussion section
  lines.push('## Discussion');
  lines.push('');

  // Limit to ~100 top comments with their best replies
  let commentBudget = 100;
  for (const comment of topLevel) {
    if (commentBudget <= 0) break;

    lines.push(formatComment(comment));
    commentBudget--;

    // Include top 3 replies per top-level comment
    const replies = filtered
      .filter((c) => c.depth === 1 && isReplyTo(c, comment, filtered))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    for (const reply of replies) {
      if (commentBudget <= 0) break;
      lines.push(formatComment(reply));
      commentBudget--;
    }

    lines.push('');
  }

  const markdown = lines.join('\n');
  const wordCount = markdown.split(/\s+/).filter(Boolean).length;

  // Extract images from post
  const thumbnailUrl = post.preview_url || (post.thumbnail && !['self', 'default', 'nsfw', 'spoiler', ''].includes(post.thumbnail) ? post.thumbnail : undefined);
  const richImages: ExtractedImage[] = [];
  if (post.preview_url) {
    richImages.push({
      url: post.preview_url,
      alt: post.title,
      tier: 'inline',
    });
  }
  // For link posts, the linked URL might be an image
  if (!post.is_self && post.post_hint === 'image' && post.url && post.url !== post.preview_url) {
    richImages.push({
      url: post.url,
      alt: post.title,
      tier: 'inline',
    });
  }

  return {
    markdown,
    wordCount,
    title: post.title,
    commentCount: post.num_comments,
    postScore: post.score,
    subreddit: post.subreddit,
    author: post.author,
    thumbnailUrl,
    richImages: richImages.length > 0 ? richImages : undefined,
  };
}

function formatComment(comment: RedditComment): string {
  const indent = comment.depth > 0 ? '> '.repeat(Math.min(comment.depth, 3)) : '';
  const opTag = comment.isOP ? ' [OP]' : '';
  const score = comment.score !== undefined ? ` (${comment.score} points)` : '';
  // Collapse multi-line comments
  const body = comment.body.replace(/\n{3,}/g, '\n\n');
  return `${indent}**u/${comment.author}**${opTag}${score}: ${body}`;
}

function flattenCommentTree(
  children: unknown[],
  opAuthor: string,
  depth: number,
  maxDepth: number,
): RedditComment[] {
  const result: RedditComment[] = [];

  for (const child of children) {
    const data = (child as { kind?: string; data?: Record<string, unknown> });
    if (data.kind !== 't1' || !data.data) continue;

    const d = data.data;
    const comment: RedditComment = {
      author: (d.author as string) || '[deleted]',
      body: (d.body as string) || '',
      score: (d.score as number) || 0,
      depth,
      isOP: (d.author as string) === opAuthor,
      replies: [],
    };

    result.push(comment);

    // Recurse into replies
    if (depth < maxDepth && d.replies && typeof d.replies === 'object') {
      const repliesData = (d.replies as { data?: { children?: unknown[] } });
      if (repliesData.data?.children) {
        const nested = flattenCommentTree(repliesData.data.children, opAuthor, depth + 1, maxDepth);
        result.push(...nested);
      }
    }
  }

  return result;
}

/** Heuristic: a reply "belongs" to a parent if it's depth+1 and appears after it in the flat list. */
function isReplyTo(reply: RedditComment, parent: RedditComment, all: RedditComment[]): boolean {
  const parentIdx = all.indexOf(parent);
  const replyIdx = all.indexOf(reply);
  if (replyIdx <= parentIdx) return false;
  // Check no other top-level comment appears between them
  for (let i = parentIdx + 1; i < replyIdx; i++) {
    if (all[i].depth === 0) return false;
  }
  return true;
}

export function parseRedditJson(json: unknown[]): { post: RedditPostData; comments: unknown[] } {
  const postListing = json[0] as { data?: { children?: Array<{ data: Record<string, unknown> }> } };
  const commentListing = json[1] as { data?: { children?: unknown[] } };

  const postData = postListing?.data?.children?.[0]?.data;
  if (!postData) throw new Error('Could not parse Reddit post data');

  const post: RedditPostData = {
    title: (postData.title as string) || '',
    selftext: (postData.selftext as string) || '',
    author: (postData.author as string) || '[deleted]',
    score: (postData.score as number) || 0,
    subreddit: (postData.subreddit as string) || '',
    num_comments: (postData.num_comments as number) || 0,
    url: (postData.url as string) || '',
    is_self: (postData.is_self as boolean) || false,
    link_flair_text: (postData.link_flair_text as string) || undefined,
    thumbnail: (postData.thumbnail as string) || undefined,
    post_hint: (postData.post_hint as string) || undefined,
    preview_url: extractPreviewUrl(postData),
  };

  const comments = commentListing?.data?.children || [];

  return { post, comments };
}

function extractPreviewUrl(postData: Record<string, unknown>): string | undefined {
  try {
    const preview = postData.preview as { images?: Array<{ source?: { url?: string } }> } | undefined;
    const url = preview?.images?.[0]?.source?.url;
    // Reddit HTML-encodes the URL in JSON (e.g. &amp;)
    return url ? url.replace(/&amp;/g, '&') : undefined;
  } catch {
    return undefined;
  }
}
