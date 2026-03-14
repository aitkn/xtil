export type ContentType = 'article' | 'pdf' | 'youtube' | 'facebook' | 'reddit' | 'twitter' | 'github' | 'gmail' | 'linkedin' | 'generic';

export interface ExtractedContent {
  type: ContentType;
  url: string;
  title: string;
  author?: string;
  publishDate?: string;
  language?: string;
  content: string; // main text content (markdown)
  wordCount: number;
  estimatedReadingTime: number; // minutes

  // YouTube-specific
  channelName?: string;
  duration?: string;
  viewCount?: string;
  thumbnailUrl?: string;
  thumbnailUrls?: string[]; // multiple thumbnails for collage display (e.g. X multi-image posts)
  description?: string;

  // Reddit-specific
  subreddit?: string;
  postScore?: number;
  commentCount?: number;

  // GitHub-specific
  githubPageType?: 'pr' | 'issue' | 'code' | 'repo' | 'commit' | 'release';
  prNumber?: number;
  prState?: 'open' | 'closed' | 'merged';
  issueState?: 'open' | 'closed';
  repoStars?: number;

  // Video transcript (non-YouTube: CF Stream, Vimeo, Dailymotion, HTML5)
  transcriptWordCount?: number;

  // Comments
  comments?: ExtractedComment[];

  // Images
  images?: string[];
  richImages?: ExtractedImage[];
}

export interface ExtractedImage {
  url: string;
  alt: string;
  caption?: string;
  tier: 'inline' | 'contextual';
  width?: number;
  height?: number;
}

export interface ExtractedComment {
  author?: string;
  text: string;
  likes?: number;
}

export interface ExtractOptions {
  /** When true, extractor must not mutate the DOM (e.g. clicking "see more"). */
  readonly?: boolean;
}

export interface ContentExtractor {
  canExtract(url: string, document: Document): boolean;
  extract(url: string, document: Document, options?: ExtractOptions): ExtractedContent;
}
