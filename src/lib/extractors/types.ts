export type ContentType = 'article' | 'youtube' | 'facebook' | 'generic';

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
  description?: string;

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

export interface ContentExtractor {
  canExtract(url: string, document: Document): boolean;
  extract(url: string, document: Document): ExtractedContent;
}
