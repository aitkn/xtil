/**
 * Content script injected into Giscus embed iframes.
 * Extracts comments and replies from the Giscus DOM and sends them
 * to the background via IFRAME_COMMENTS messages.
 */
import type { ExtractedComment } from '@/lib/extractors/types';
import { parseLikeCount } from '@/lib/extractors/comments';

export default defineContentScript({
  matches: ['*://giscus.app/*'],
  allFrames: true,
  runAt: 'document_idle',

  main() {
    const chromeObj = (globalThis as unknown as { chrome: typeof chrome }).chrome;

    function extractGiscusComments(): ExtractedComment[] {
      const comments: ExtractedComment[] = [];

      // Main comments and replies both use .gsc-comment
      const commentEls = document.querySelectorAll('.gsc-comment');

      for (const el of commentEls) {
        const text = el.querySelector('.gsc-comment-content')?.textContent?.trim() || '';
        if (!text) continue;

        // Author is typically in a link with font-semibold class
        const author =
          el.querySelector('a.font-semibold')?.textContent?.trim() ||
          el.querySelector('.gsc-comment-author a')?.textContent?.trim() ||
          undefined;

        // Reaction counts
        const reactionEl = el.querySelector('.gsc-social-reaction-summary-item-count');
        const likes = reactionEl ? parseLikeCount(reactionEl.textContent?.trim() || '') : undefined;

        comments.push({ author, text, likes });
      }

      return comments;
    }

    function sendComments(): void {
      const comments = extractGiscusComments();
      if (comments.length === 0) return;

      chromeObj.runtime.sendMessage({
        type: 'IFRAME_COMMENTS',
        source: 'giscus',
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
