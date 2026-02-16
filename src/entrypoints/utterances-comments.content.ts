/**
 * Content script injected into Utterances embed iframes.
 * Extracts comments from the Utterances DOM and sends them
 * to the background via IFRAME_COMMENTS messages.
 */
import type { ExtractedComment } from '@/lib/extractors/types';
import { parseLikeCount } from '@/lib/extractors/comments';

export default defineContentScript({
  matches: ['*://utteranc.es/*'],
  allFrames: true,
  runAt: 'document_idle',

  main() {
    const chromeObj = (globalThis as unknown as { chrome: typeof chrome }).chrome;

    function extractUtterancesComments(): ExtractedComment[] {
      const comments: ExtractedComment[] = [];
      const articles = document.querySelectorAll('article.timeline-comment');

      for (const article of articles) {
        const text = article.querySelector('div.markdown-body')?.textContent?.trim() || '';
        if (!text) continue;

        const author =
          article.querySelector('.comment-meta a strong')?.textContent?.trim() ||
          article.querySelector('.comment-header strong')?.textContent?.trim() ||
          undefined;

        // Reaction count from footer
        const reactionFooter = article.querySelector('div.comment-footer[reaction-count]');
        const likes = reactionFooter
          ? parseLikeCount(reactionFooter.getAttribute('reaction-count') || '')
          : undefined;

        comments.push({ author, text, likes });
      }

      return comments;
    }

    function sendComments(): void {
      const comments = extractUtterancesComments();
      if (comments.length === 0) return;

      chromeObj.runtime.sendMessage({
        type: 'IFRAME_COMMENTS',
        source: 'utterances',
        comments,
      });
    }

    // Observe for dynamically loaded comments
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const observer = new MutationObserver(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(sendComments, 1000);
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Initial extraction
    setTimeout(sendComments, 2000);
  },
});
