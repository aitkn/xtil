/**
 * Content script injected into Disqus embed iframes.
 * Extracts comments from the Disqus DOM and sends them to the background
 * via IFRAME_COMMENTS messages. Uses a MutationObserver to pick up
 * dynamically loaded comments.
 */
import type { ExtractedComment } from '@/lib/extractors/types';
import { parseLikeCount } from '@/lib/extractors/comments';

export default defineContentScript({
  matches: ['*://disqus.com/embed/comments/*'],
  allFrames: true,
  runAt: 'document_idle',

  main() {
    const chromeObj = (globalThis as unknown as { chrome: typeof chrome }).chrome;

    function extractDisqusComments(): ExtractedComment[] {
      const comments: ExtractedComment[] = [];
      // Each comment (including nested replies) is an li.post inside ul#post-list
      const posts = document.querySelectorAll('#post-list li.post');

      for (const post of posts) {
        const text = post.querySelector('.post-message')?.textContent?.trim() || '';
        if (!text) continue;

        const author = post.querySelector('.author a')?.textContent?.trim() || undefined;

        const likesText = post.querySelector('span[data-role="likes"]')?.textContent?.trim() || '';
        const likes = parseLikeCount(likesText);

        comments.push({ author, text, likes });
      }

      return comments;
    }

    function sendComments(): void {
      const comments = extractDisqusComments();
      if (comments.length === 0) return;

      chromeObj.runtime.sendMessage({
        type: 'IFRAME_COMMENTS',
        source: 'disqus',
        comments,
      });
    }

    // Observe the post list for dynamically loaded comments
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const observer = new MutationObserver(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(sendComments, 1000);
    });

    const postList = document.querySelector('#post-list');
    if (postList) {
      observer.observe(postList, { childList: true, subtree: true });
    }

    // Initial extraction after a short delay for Disqus to render
    setTimeout(sendComments, 2000);
  },
});
