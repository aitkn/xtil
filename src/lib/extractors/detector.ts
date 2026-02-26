import type { ContentExtractor } from './types';
import { pdfExtractor } from './pdf';
import { youtubeExtractor } from './youtube';
import { gdocsExtractor } from './gdocs';
import { gmailExtractor } from './gmail';
import { facebookExtractor } from './facebook';
import { redditExtractor } from './reddit';
import { twitterExtractor } from './twitter';
import { githubExtractor } from './github';
import { linkedinExtractor } from './linkedin';
import { articleExtractor } from './article';
import { genericExtractor } from './generic';

const extractors: ContentExtractor[] = [
  pdfExtractor, // first — PDFs have no DOM for other extractors
  youtubeExtractor,
  gdocsExtractor,
  gmailExtractor,
  facebookExtractor,
  redditExtractor,
  twitterExtractor,
  githubExtractor,
  linkedinExtractor,
  articleExtractor,
  genericExtractor, // always last — fallback
];

export function detectExtractor(url: string, doc: Document): ContentExtractor {
  for (const extractor of extractors) {
    if (extractor.canExtract(url, doc)) {
      return extractor;
    }
  }
  return genericExtractor; // should never reach here since generic always matches
}
