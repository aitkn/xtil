import { getSettings, saveSettings } from '@/lib/storage/settings';
import { getActiveProviderConfig } from '@/lib/storage/types';
import { createProvider, getProviderDefinition } from '@/lib/llm/registry';
import { fetchModels } from '@/lib/llm/models';
import { summarize, ImageRequestError } from '@/lib/summarizer/summarizer';
import { getSystemPrompt } from '@/lib/summarizer/prompts';
import { fetchImages } from '@/lib/images/fetcher';
import { probeVision } from '@/lib/llm/vision-probe';
import type { FetchedImage } from '@/lib/images/fetcher';
import type { Message, ExtractResultMessage, SummaryResultMessage, ChatResponseMessage, ConnectionTestResultMessage, SettingsResultMessage, SaveSettingsResultMessage, NotionDatabasesResultMessage, ExportResultMessage, FetchModelsResultMessage } from '@/lib/messaging/types';
import type { ChatMessage, ImageContent, VisionSupport, LLMProvider, ChatOptions } from '@/lib/llm/types';
import { CHAT_RESPONSE_SCHEMA, SCHEMA_ENFORCED_PROVIDERS } from '@/lib/llm/schemas';
import type { SummaryDocument } from '@/lib/summarizer/types';
import type { ExtractedContent, ExtractedComment } from '@/lib/extractors/types';
import type { IframeCommentsMessage } from '@/lib/messaging/types';
import { parseRedditJson, buildRedditMarkdown } from '@/lib/extractors/reddit';
import { getPersistedTabState, deletePersistedTabState, pruneStaleTabStates } from '@/lib/storage/tab-state';

// Persist images across service worker restarts via chrome.storage.session
const chromeStorage = () => (globalThis as unknown as { chrome: { storage: typeof chrome.storage } }).chrome.storage;

async function cacheImages(images: ImageContent[], urls: { url: string; alt: string }[]): Promise<void> {
  await chromeStorage().session.set({ _cachedImages: images, _cachedImageUrls: urls });
}

async function getCachedImages(): Promise<{ images: ImageContent[]; urls: { url: string; alt: string }[] }> {
  const result = await chromeStorage().session.get(['_cachedImages', '_cachedImageUrls']);
  return {
    images: (result._cachedImages as ImageContent[]) || [],
    urls: (result._cachedImageUrls as { url: string; alt: string }[]) || [],
  };
}

// Per-tab AbortController registry for in-flight summarizations
const activeSummarizations = new Map<number, AbortController>();

// Per-tab iframe comment storage (Disqus, Giscus, Utterances)
const iframeComments = new Map<number, ExtractedComment[]>();

export default defineBackground(() => {
  const chromeObj = (globalThis as unknown as { chrome: typeof chrome }).chrome;

  // Open side panel when extension icon is clicked
  (chromeObj as unknown as { sidePanel?: { setPanelBehavior: (opts: { openPanelOnActionClick: boolean }) => Promise<void> } })
    .sidePanel?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch(console.error);

  chromeObj.runtime.onMessage.addListener(
    (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => {
      if (sender.id !== chromeObj.runtime.id) {
        sendResponse({ success: false, error: 'Unauthorized sender' });
        return;
      }

      // Fire-and-forget: iframe content scripts push comments here
      const msg = message as Record<string, unknown>;
      if (msg.type === 'IFRAME_COMMENTS') {
        const iframeMsg = message as IframeCommentsMessage;
        const tabId = sender.tab?.id;
        if (tabId != null && iframeMsg.comments?.length) {
          iframeComments.set(tabId, iframeMsg.comments);
        }
        // No response needed — fire-and-forget
        return;
      }

      handleMessage(message as Message)
        .then(sendResponse)
        .catch((err) => {
          console.warn(`[xTil] ${(message as Message).type} failed:`, err);
          sendResponse({ type: (message as Message).type, success: false, error: String(err) });
        });
      return true; // keep channel open for async response
    },
  );

  // Prune stale tab states on service worker startup (handles extension reload, missed events)
  pruneStaleTabStates().catch(() => {});

  // Clean up persisted tab state when a tab is closed
  chromeObj.tabs.onRemoved.addListener((tabId: number) => {
    deletePersistedTabState(tabId).catch(() => {});
    iframeComments.delete(tabId);
  });

  // Clean up persisted tab state when a tab navigates to a different URL
  chromeObj.tabs.onUpdated.addListener((tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
    if (!changeInfo.url) return;
    getPersistedTabState(tabId).then((persisted) => {
      if (!persisted) return;
      // Different URL → invalidate
      if (persisted.url !== changeInfo.url) {
        deletePersistedTabState(tabId).catch(() => {});
        iframeComments.delete(tabId);
      }
    }).catch(() => {});
  });
});

async function getModelVision(
  provider: LLMProvider,
  providerId: string,
  model: string,
): Promise<VisionSupport> {
  const settings = await getSettings();
  const key = `${providerId}:${model}`;
  const cached = settings.modelCapabilities?.[key];

  // Return cached if known and < 30 days old
  if (cached && cached.vision !== 'unknown' && Date.now() - cached.probedAt < 30 * 86400000) {
    return cached.vision;
  }

  const vision = await probeVision(provider);

  // Only cache definitive results
  if (vision !== 'unknown') {
    await saveSettings({
      modelCapabilities: {
        ...settings.modelCapabilities,
        [key]: { vision, probedAt: Date.now() },
      },
    });
  }

  return vision;
}

async function handleMessage(message: Message): Promise<Message> {
  switch (message.type) {
    case 'EXTRACT_CONTENT':
      return handleExtractContent();
    case 'EXTRACT_COMMENTS':
      return handleExtractComments();
    case 'SEEK_VIDEO':
      return handleSeekVideo((message as Message & { seconds: number }).seconds);
    case 'SUMMARIZE':
      return handleSummarize(message.content, message.userInstructions, message.tabId);
    case 'CANCEL_SUMMARIZE': {
      const ctrl = activeSummarizations.get((message as import('@/lib/messaging/types').CancelSummarizeMessage).tabId);
      if (ctrl) {
        ctrl.abort();
        activeSummarizations.delete((message as import('@/lib/messaging/types').CancelSummarizeMessage).tabId);
      }
      return { type: 'CANCEL_SUMMARIZE', success: true } as Message;
    }
    case 'CHAT_MESSAGE':
      return handleChatMessage(message.messages, message.summary, message.content);
    case 'EXPORT':
      return handleExport(message.adapterId, message.summary, message.content, message.replacePageId);
    case 'CHECK_NOTION_DUPLICATE':
      return handleCheckNotionDuplicate(message.url);
    case 'TEST_LLM_CONNECTION':
      return handleTestLLMConnection();
    case 'PROBE_VISION':
      return handleProbeVision(message);
    case 'TEST_NOTION_CONNECTION':
      return handleTestNotionConnection();
    case 'GET_SETTINGS':
      return handleGetSettings();
    case 'SAVE_SETTINGS':
      return handleSaveSettings(message.settings);
    case 'FETCH_NOTION_DATABASES':
      return handleFetchNotionDatabases();
    case 'FETCH_MODELS':
      return handleFetchModels(message.providerId, message.apiKey, message.endpoint);
    case 'OPEN_TAB':
      return handleOpenTab((message as import('@/lib/messaging/types').OpenTabMessage).url);
    case 'CLOSE_ONBOARDING_TABS':
      return handleCloseOnboardingTabs();
    default:
      return { type: (message as Message).type, success: false, error: 'Unknown message type' } as Message;
  }
}

/**
 * Resolve the target tab: normally the active tab, but if the active tab is
 * the extension itself (opened as a tab for debugging), fall back to the most
 * recently accessed non-extension tab in the same window.
 */
async function resolveTargetTab(): Promise<chrome.tabs.Tab> {
  const chromeTabs = (globalThis as unknown as { chrome: { tabs: typeof chrome.tabs } }).chrome.tabs;
  let [tab] = await chromeTabs.query({ active: true, currentWindow: true });

  if (tab?.url?.startsWith('chrome-extension://')) {
    const allTabs = await chromeTabs.query({ currentWindow: true });
    const candidates = allTabs
      .filter(t => t.id !== tab!.id && !t.url?.startsWith('chrome-extension://'))
      .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
    if (candidates.length) tab = candidates[0];
  }

  if (!tab?.id) throw new Error('No active tab found');
  return tab;
}

function sendToTab(tabId: number, message: unknown): Promise<unknown> {
  const chromeTabs = (globalThis as unknown as { chrome: { tabs: typeof chrome.tabs } }).chrome.tabs;
  return new Promise((resolve, reject) => {
    chromeTabs.sendMessage(tabId, message, (resp: unknown) => {
      const chromeRT = (globalThis as unknown as { chrome: { runtime: typeof chrome.runtime } }).chrome.runtime;
      if (chromeRT.lastError) reject(new Error(chromeRT.lastError.message));
      else resolve(resp);
    });
  });
}

/**
 * On-demand extraction of comments from cross-origin iframes (Disqus, Giscus, Utterances).
 * Uses chrome.scripting.executeScript with allFrames to run extraction in every frame,
 * then filters to iframe-sourced results. This is reliable regardless of service worker
 * lifecycle — no dependency on the fire-and-forget messages from content scripts.
 */
async function extractIframeComments(tabId: number): Promise<ExtractedComment[]> {
  const chromeScripting = (globalThis as unknown as { chrome: { scripting: typeof chrome.scripting } }).chrome.scripting;
  try {
    const results = await chromeScripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const host = window.location.hostname;

        // --- Disqus ---
        if (host === 'disqus.com' && window.location.pathname.startsWith('/embed/comments')) {
          const comments: { author?: string; text: string; likes?: number }[] = [];
          for (const post of document.querySelectorAll('#post-list li.post')) {
            const text = post.querySelector('.post-message')?.textContent?.trim() || '';
            if (text.length < 5) continue;
            const author = post.querySelector('.author a')?.textContent?.trim() || undefined;
            const likesRaw = post.querySelector('span[data-role="likes"]')?.textContent?.trim() || '';
            const likes = likesRaw && /^\d+$/.test(likesRaw) ? parseInt(likesRaw, 10) : undefined;
            comments.push({ author, text, likes });
          }
          return comments.length > 0 ? comments : null;
        }

        // --- Giscus ---
        if (host === 'giscus.app') {
          const comments: { author?: string; text: string; likes?: number }[] = [];
          for (const el of document.querySelectorAll('.gsc-comment')) {
            const text = el.querySelector('.gsc-comment-content')?.textContent?.trim() || '';
            if (text.length < 5) continue;
            const author = (el.querySelector('a.font-semibold') || el.querySelector('.gsc-comment-author a'))?.textContent?.trim() || undefined;
            const reactRaw = el.querySelector('.gsc-social-reaction-summary-item-count')?.textContent?.trim() || '';
            const likes = reactRaw && /^\d+$/.test(reactRaw) ? parseInt(reactRaw, 10) : undefined;
            comments.push({ author, text, likes });
          }
          return comments.length > 0 ? comments : null;
        }

        // --- Utterances ---
        if (host === 'utteranc.es') {
          const comments: { author?: string; text: string; likes?: number }[] = [];
          for (const article of document.querySelectorAll('article.timeline-comment')) {
            const text = article.querySelector('div.markdown-body')?.textContent?.trim() || '';
            if (text.length < 5) continue;
            const author = (article.querySelector('.comment-meta a strong') || article.querySelector('.comment-header strong'))?.textContent?.trim() || undefined;
            const footer = article.querySelector('div.comment-footer[reaction-count]');
            const reactRaw = footer?.getAttribute('reaction-count') || '';
            const likes = reactRaw && /^\d+$/.test(reactRaw) ? parseInt(reactRaw, 10) : undefined;
            comments.push({ author, text, likes });
          }
          return comments.length > 0 ? comments : null;
        }

        // --- Generic iframe comment detection ---
        // Only run in sub-frames (not the main page) to avoid double-counting
        if (window.self === window.top) return null;

        // Try common comment selectors
        const commentSelectors = [
          '.comment-content', '.comment-body', '.comment-text', '.post-message',
          '.wpd-comment-text', '.commento-body', '.comment__text', '.isso-text',
          '[class*="comment-content"]', '[class*="comment-body"]', '[class*="comment-text"]',
        ];
        for (const sel of commentSelectors) {
          const els = document.querySelectorAll(sel);
          if (els.length < 2) continue; // need at least 2 to be a comment section

          const comments: { author?: string; text: string; likes?: number }[] = [];
          for (const el of els) {
            const text = el.textContent?.trim() || '';
            if (text.length < 5) continue;

            const parent = el.parentElement?.closest('[class*="comment"]') || el.closest('li') || el.parentElement;
            const authorEl = parent?.querySelector('[class*="author"] a') || parent?.querySelector('[class*="author"]')
              || parent?.querySelector('[class*="username"]') || parent?.querySelector('cite');
            const author = authorEl?.textContent?.trim() || undefined;

            const voteEl = parent?.querySelector('[class*="vote-count"]') || parent?.querySelector('[class*="likes"]')
              || parent?.querySelector('[class*="upvote"]');
            const voteRaw = voteEl?.textContent?.trim()?.replace(/[,\s]/g, '') || '';
            const likes = /^[+-]?\d+$/.test(voteRaw) ? parseInt(voteRaw, 10) : undefined;

            comments.push({ author, text, likes });
          }
          if (comments.length > 0) return comments;
        }

        return null;
      },
    });

    // Collect non-null results from all frames
    const all: ExtractedComment[] = [];
    for (const r of results) {
      if (r.result) all.push(...(r.result as ExtractedComment[]));
    }
    return all;
  } catch {
    // scripting.executeScript can fail if the tab is closed or a special page
    return [];
  }
}

/** Merge iframe-sourced comments into a main-frame comments array, deduplicating by text */
function mergeIframeComments(mainComments: ExtractedComment[], iframeExtra: ExtractedComment[]): ExtractedComment[] {
  if (!iframeExtra.length) return mainComments;

  const seen = new Set(mainComments.map(c => c.text));
  const merged = [...mainComments];
  for (const c of iframeExtra) {
    if (!seen.has(c.text)) {
      seen.add(c.text);
      merged.push(c);
    }
  }
  return merged;
}

/** Chrome blocks content scripts on these domains. */
function isRestrictedUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    return hostname === 'chromewebstore.google.com'
      || hostname === 'chrome.google.com';
  } catch { return false; }
}

async function handleExtractContent(): Promise<ExtractResultMessage> {
  try {
    const [tab, settings] = await Promise.all([resolveTargetTab(), getSettings()]);

    if (isRestrictedUrl(tab.url)) {
      return { type: 'EXTRACT_RESULT', success: false, error: 'restricted', tabId: tab.id } as ExtractResultMessage;
    }

    const extractMsg = {
      type: 'EXTRACT_CONTENT' as const,
      langPrefs: settings.summaryLanguageExcept,
      summaryLang: settings.summaryLanguage,
    };

    let response: unknown;
    try {
      response = await sendToTab(tab.id, extractMsg);
    } catch {
      // Content script not injected yet (page was open before extension loaded).
      // Inject it programmatically and retry.
      const chromeScripting = (globalThis as unknown as { chrome: { scripting: typeof chrome.scripting } }).chrome.scripting;
      await chromeScripting.executeScript({
        target: { tabId: tab.id },
        files: ['content-scripts/content.js'],
      });
      response = await sendToTab(tab.id, extractMsg);
    }
    const result = response as ExtractResultMessage;
    result.tabId = tab.id;

    // Resolve Google Docs export from background (no CORS restrictions here)
    if (result.success && result.data) {
      const gdocsMarker = '[GDOCS_EXPORT:';
      const idx = result.data.content.indexOf(gdocsMarker);
      if (idx !== -1) {
        const end = result.data.content.indexOf(']', idx + gdocsMarker.length);
        if (end !== -1) {
          const docId = result.data.content.slice(idx + gdocsMarker.length, end);
          try {
            const text = await fetchGoogleDocText(docId);
            result.data.content = text;
            result.data.wordCount = text.split(/\s+/).filter(Boolean).length;
            result.data.estimatedReadingTime = Math.ceil(result.data.wordCount / 200);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            result.data.content = `*Could not extract Google Doc content: ${errMsg}*`;
          }
        }
      }
    }

    // Resolve Reddit JSON from background (no CORS restrictions here)
    if (result.success && result.data) {
      const redditMarker = '[REDDIT_JSON:';
      const ridx = result.data.content.indexOf(redditMarker);
      if (ridx !== -1) {
        const rend = result.data.content.indexOf(']', ridx + redditMarker.length);
        if (rend !== -1) {
          const redditUrl = result.data.content.slice(ridx + redditMarker.length, rend);
          try {
            const redditData = await fetchRedditJson(redditUrl);
            const parsed = parseRedditJson(redditData);
            const built = buildRedditMarkdown(parsed.post, parsed.comments);
            result.data.content = built.markdown;
            result.data.wordCount = built.wordCount;
            result.data.estimatedReadingTime = Math.ceil(built.wordCount / 200);
            result.data.title = built.title || result.data.title;
            result.data.commentCount = built.commentCount;
            result.data.postScore = built.postScore;
            result.data.subreddit = built.subreddit;
            result.data.author = built.author;
            if (built.thumbnailUrl) result.data.thumbnailUrl = built.thumbnailUrl;
            if (built.richImages) result.data.richImages = built.richImages;
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            result.data.content = `*Could not fetch Reddit discussion: ${errMsg}*`;
          }
        }
      }
    }

    // Merge comments from cross-origin iframes (Disqus, Giscus, Utterances)
    if (result.success && result.data && tab.id) {
      const iframeExtra = await extractIframeComments(tab.id);
      // Also check fire-and-forget cache
      const cached = iframeComments.get(tab.id) || [];
      const combined = [...iframeExtra, ...cached];
      result.data.comments = mergeIframeComments(result.data.comments || [], combined);
    }

    return result;
  } catch (err) {
    return {
      type: 'EXTRACT_RESULT',
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function handleExtractComments(): Promise<Message> {
  try {
    const tab = await resolveTargetTab();

    let response: unknown;
    try {
      response = await sendToTab(tab.id, { type: 'EXTRACT_COMMENTS' });
    } catch {
      const chromeScripting = (globalThis as unknown as { chrome: { scripting: typeof chrome.scripting } }).chrome.scripting;
      await chromeScripting.executeScript({
        target: { tabId: tab.id },
        files: ['content-scripts/content.js'],
      });
      response = await sendToTab(tab.id, { type: 'EXTRACT_COMMENTS' });
    }

    // Merge iframe comments (Disqus, Giscus, Utterances) — on-demand + cached
    const resp = response as { success: boolean; comments?: ExtractedComment[] };
    if (resp.success && tab.id) {
      const iframeExtra = await extractIframeComments(tab.id);
      const cached = iframeComments.get(tab.id) || [];
      const combined = [...iframeExtra, ...cached];
      resp.comments = mergeIframeComments(resp.comments || [], combined);
    }

    return resp as Message;
  } catch (err) {
    return { type: 'EXTRACT_COMMENTS', success: false, error: err instanceof Error ? err.message : String(err) } as Message;
  }
}

async function handleSeekVideo(seconds: number): Promise<Message> {
  try {
    const tab = await resolveTargetTab();
    const response = await sendToTab(tab.id, { type: 'SEEK_VIDEO', seconds });
    return response as Message;
  } catch (err) {
    return { type: 'SEEK_VIDEO', success: false, error: err instanceof Error ? err.message : String(err) } as Message;
  }
}

async function handleSummarize(content: ExtractedContent, userInstructions?: string, tabId?: number): Promise<SummaryResultMessage> {
  // Create AbortController and register by tab ID
  const controller = new AbortController();
  if (tabId != null) {
    // Abort any previous in-flight summarization for this tab
    activeSummarizations.get(tabId)?.abort();
    activeSummarizations.set(tabId, controller);
  }
  const { signal } = controller;

  // Declared outside try so the outer catch can include them in error responses
  const rawResponses: string[] = [];
  let actualSystemPrompt = '';

  try {
    // Clear stale image cache from previous summarization
    await cacheImages([], []);
    const settings = await getSettings();
    const llmConfig = getActiveProviderConfig(settings);

    if (!llmConfig.apiKey && llmConfig.providerId !== 'self-hosted') {
      throw new Error('Please configure your LLM API key in Settings');
    }

    const provider = createProvider(llmConfig);

    let imageAnalysisEnabled = false;
    let modelVision: VisionSupport = 'unknown';
    if ((settings.enableImageAnalysis ?? true) && content.richImages?.length) {
      modelVision = await getModelVision(provider, llmConfig.providerId, llmConfig.model);
      imageAnalysisEnabled = modelVision === 'base64' || modelVision === 'url';
    }

    let allFetchedImages: FetchedImage[] = [];
    let imageUrlList: { url: string; alt: string }[] = [];

    if (imageAnalysisEnabled) {
      // Send all images as actual image data (inline first, then contextual)
      const richImages = content.richImages!;
      const sorted = [
        ...richImages.filter((i) => i.tier === 'inline'),
        ...richImages.filter((i) => i.tier === 'contextual'),
      ];

      // Always fetch and encode as base64 — sending URLs directly is unreliable
      // because the remote LLM API can't access images behind auth/cookies (e.g. x.com)
      // or served with unsupported content-types. The service worker has the user's
      // session and fetchImages() converts unsupported formats to JPEG.
      allFetchedImages = await fetchImages(sorted, 5);
      imageUrlList = allFetchedImages.map((fi) => ({ url: fi.url, alt: fi.alt }));
    }

    // Cache images + URLs for chat to reuse (survives service worker restarts)
    const cachedImageContents: ImageContent[] = allFetchedImages.map((fi) => ({ base64: fi.base64, mimeType: fi.mimeType }));
    await cacheImages(cachedImageContents, imageUrlList);

    const MAX_TOTAL_IMAGES = 5;

    const providerDef = getProviderDefinition(llmConfig.providerId);
    const providerName = providerDef?.name || llmConfig.providerId;

    const onRawResponse = (r: string) => rawResponses.push(r);
    const onSystemPrompt = (p: string) => { actualSystemPrompt = p; };
    let lastConversation: { role: string; content: string }[] = [];
    const onConversation = (msgs: { role: string; content: string }[]) => {
      lastConversation = msgs.map(m => ({ role: m.role, content: m.content }));
    };
    let rollingSummaryText = '';
    const onRollingSummary = (s: string) => { rollingSummaryText = s; };

    try {
      const result = await summarize(provider, content, {
        detailLevel: settings.summaryDetailLevel,
        language: settings.summaryLanguage,
        languageExcept: settings.summaryLanguageExcept,
        contextWindow: llmConfig.contextWindow,
        userInstructions,
        fetchedImages: allFetchedImages.length > 0 ? allFetchedImages : undefined,
        imageUrlList: imageUrlList.length > 0 ? imageUrlList : undefined,
        signal,
        onRawResponse,
        onSystemPrompt,
        onConversation,
        onRollingSummary,
      });
      result.llmProvider = providerName;
      result.llmModel = llmConfig.model;
      return { type: 'SUMMARY_RESULT', success: true, data: result, rawResponses, systemPrompt: actualSystemPrompt, conversationLog: lastConversation, rollingSummary: rollingSummaryText || undefined };
    } catch (err) {
      // Round-trip: LLM requested additional images
      if (err instanceof ImageRequestError && imageAnalysisEnabled) {
        if (signal.aborted) throw new Error('Summarization cancelled');
        const requestedUrls = err.requestedImages.slice(0, 3);
        const remaining = MAX_TOTAL_IMAGES - allFetchedImages.length;
        if (remaining > 0 && requestedUrls.length > 0) {
          const additionalUrlList = requestedUrls.slice(0, remaining).map((url) => ({ url, alt: '' }));
          imageUrlList = [...imageUrlList, ...additionalUrlList];
          const requestedExtracted = requestedUrls.slice(0, remaining).map((url) => ({
            url,
            alt: '',
            tier: 'contextual' as const,
          }));
          const additionalImages = await fetchImages(requestedExtracted, remaining);
          allFetchedImages = [...allFetchedImages, ...additionalImages];
        }

        // Retry summarization with all images — no further round-trips
        const result = await summarize(provider, content, {
          detailLevel: settings.summaryDetailLevel,
          language: settings.summaryLanguage,
          languageExcept: settings.summaryLanguageExcept,
          contextWindow: llmConfig.contextWindow,
          userInstructions,
          fetchedImages: allFetchedImages.length > 0 ? allFetchedImages : undefined,
          imageUrlList: imageUrlList.length > 0 ? imageUrlList : undefined,
          signal,
          onRawResponse,
          onSystemPrompt,
          onConversation,
        });
        result.llmProvider = providerName;
        result.llmModel = llmConfig.model;
        return { type: 'SUMMARY_RESULT', success: true, data: result, rawResponses, systemPrompt: actualSystemPrompt, conversationLog: lastConversation };
      }
      throw err;
    }
  } catch (err) {
    return {
      type: 'SUMMARY_RESULT',
      success: false,
      error: err instanceof Error ? err.message : String(err),
      rawResponses,
      systemPrompt: actualSystemPrompt,
    };
  } finally {
    if (tabId != null) activeSummarizations.delete(tabId);
  }
}

async function handleChatMessage(
  messages: ChatMessage[],
  summary: SummaryDocument,
  content: ExtractedContent,
): Promise<ChatResponseMessage> {
  try {
    const settings = await getSettings();
    const llmConfig = getActiveProviderConfig(settings);
    const provider = createProvider(llmConfig);
    const key = `${llmConfig.providerId}:${llmConfig.model}`;
    const visionCached = settings.modelCapabilities?.[key]?.vision;
    const hasVisionCapability = visionCached === 'base64' || visionCached === 'url';
    const cached = ((settings.enableImageAnalysis ?? true) && hasVisionCapability) ? await getCachedImages() : { images: [], urls: [] };
    const cachedImages = cached.images;
    const cachedImageUrls = cached.urls;
    const hasImages = cachedImages.length > 0;

    const metaLines = [`Title: ${content.title}`, `URL: ${content.url}`];
    if (content.channelName) metaLines.push(`Channel: ${content.channelName}`);
    if (content.description) metaLines.push(`Description: ${content.description}`);

    const contentLabel = content.type === 'youtube' ? 'YouTube video'
      : content.type === 'reddit' ? 'Reddit discussion'
      : content.type === 'twitter' ? 'X thread'
      : content.type === 'github' ? 'GitHub page'
      : 'web page';

    // Truncate original content based on context window (60% of context, ~4 chars/token)
    const maxContentChars = llmConfig.contextWindow * 0.6 * 4;
    const originalContent = content.content
      ? (content.content.length > maxContentChars
        ? content.content.slice(0, maxContentChars) + '\n\n[...content truncated...]'
        : content.content)
      : '';

    // --- SYSTEM MSG 1: Rules & instructions (cached across turns) ---
    const summarizationPrompt = getSystemPrompt(
      settings.summaryDetailLevel,
      settings.summaryLanguage,
      settings.summaryLanguageExcept,
      hasImages,
      content.wordCount,
    );

    let imageCapabilityNote = '';
    if (hasImages) {
      imageCapabilityNote = `\n\nYou have multimodal capabilities — images from the page are attached to this conversation. You can analyze and reference them when answering questions or updating the summary.`;
    }

    // Detect if existing summary is in the wrong language and needs translation
    const targetLangCode = settings.summaryLanguage;
    const exceptCodes = settings.summaryLanguageExcept || [];
    const sourceLang = summary.sourceLanguage || '';
    const summaryLang = summary.summaryLanguage || '';
    const isExceptLanguage = exceptCodes.includes(sourceLang);
    const needsLangFix = targetLangCode !== 'auto' && !isExceptLanguage && summaryLang !== targetLangCode;

    const langNames: Record<string, string> = { en: 'English', es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese', ru: 'Russian', zh: 'Chinese', ja: 'Japanese', ko: 'Korean' };
    const langFixNote = needsLangFix
      ? `\n\nLANGUAGE OVERRIDE: The current summary JSON is in ${langNames[summaryLang] || summaryLang}, but per the language settings it MUST be in ${langNames[targetLangCode] || targetLangCode}. When you produce ANY "updates", write all text fields in ${langNames[targetLangCode] || targetLangCode}. If the user asks a general question (no updates), answer in ${langNames[targetLangCode] || targetLangCode}. The existing non-${langNames[targetLangCode] || targetLangCode} summary is a prior mistake — do not perpetuate it.`
      : '';

    const schemaEnforced = SCHEMA_ENFORCED_PROVIDERS.has(llmConfig.providerId);

    const chatFormatInstructions = schemaEnforced
      ? `Chat response rules:
- "updates" vs "summary": use ONE or NEITHER, set the other to null.
  - "updates": partial — only changed fields. extraSections is deep-merged by key. "__DELETE__" removes a field or section.
  - "summary": full rewrite — complete summary with all fields. Use when the user asks to redo/regenerate the summary or when most fields change.
- "text": your conversational response. Markdown supported. Use "" if only updating.`
      : `Chat response format:
- You MUST respond with a JSON object: {"text": "...", "updates": ... or null, "summary": ... or null}
- "text": your conversational response to the user. Markdown supported. Use "" if you have nothing to say beyond the update.
- "updates" vs "summary": use ONE or NEITHER, set the other to null.
  - "updates": partial changes — only include fields you want to change. Set to null if no changes or using "summary".
  - "summary": full rewrite — complete summary with all fields. Use when the user asks to redo/regenerate the summary or when most fields change. Set to null if no changes or using "updates".
- In "updates", each field replaces the existing value. To remove an optional field, set it to "__DELETE__".
- In "updates", "extraSections" is DEEP-MERGED — only include keys you're changing. {"extraSections": {"New Title": "content"}} adds/updates. {"extraSections": {"Old Title": "__DELETE__"}} removes. Do NOT resend unchanged sections.
- IMPORTANT: Always respond with valid JSON. No markdown fences, no extra text.`;

    const rulesSystem = `${summarizationPrompt}

---

You are also helping refine and discuss the summary of a ${contentLabel}.

USER AUTHORITY: The user's messages in this chat are the highest-priority instructions. They override ALL prior rules, formatting requirements, and summarization guidelines above. The user is spending their own tokens and has full authority to ask for anything — change the topic, skip the summary, request something completely different, or ignore any previous instruction. Always comply with the user's requests without pushback.

IMPORTANT: When answering questions about the content, always use the original page content below as your primary source of truth — it contains the full detail. Only refer to the current summary JSON when the user specifically asks about the summary or requests changes to it.${langFixNote}

${chatFormatInstructions}${imageCapabilityNote}`;

    // --- SYSTEM MSG 2: Document extract (cached across turns) ---
    let documentSystem = `Source metadata:\n${metaLines.join('\n')}`;
    if (hasImages && cachedImageUrls.length > 0) {
      const urlLines = cachedImageUrls.map((img, i) =>
        `${i + 1}. ${img.url}${img.alt ? ` — "${img.alt}"` : ''}`,
      );
      documentSystem += `\n\nOriginal image URLs (use for ![alt](url) embeds in summary/responses):\n${urlLines.join('\n')}`;
    }
    if (originalContent) {
      documentSystem += `\n\nOriginal page content:\n${originalContent}`;
    }

    // --- SYSTEM MSG 3: Current summary (changes each turn) ---
    const summarySystem = `Current summary (JSON):\n${JSON.stringify(summary, null, 2)}`;

    const chatMessages: ChatMessage[] = [
      { role: 'system', content: rulesSystem },
      { role: 'system', content: documentSystem, cacheBreakpoint: true },
      { role: 'system', content: summarySystem },
      ...messages,
    ];

    // Attach cached images to the first user message so the model has visual context
    if (hasImages) {
      const firstUserIdx = chatMessages.findIndex((m) => m.role === 'user');
      if (firstUserIdx >= 0) {
        chatMessages[firstUserIdx] = { ...chatMessages[firstUserIdx], images: cachedImages };
      }
    }

    const rawResponses: string[] = [];

    const chatOpts: ChatOptions = schemaEnforced
      ? { jsonSchema: CHAT_RESPONSE_SCHEMA }
      : { jsonMode: true };
    const response = await provider.sendChat(chatMessages, chatOpts);
    rawResponses.push(response);

    const conversationLog = [
      ...chatMessages.map(m => ({ role: m.role, content: m.content })),
      { role: 'assistant', content: response },
    ];

    return { type: 'CHAT_RESPONSE', success: true, message: response, rawResponses, conversationLog };
  } catch (err) {
    return {
      type: 'CHAT_RESPONSE',
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function handleExport(
  adapterId: string,
  summary: SummaryDocument,
  content: ExtractedContent,
  replacePageId?: string,
): Promise<ExportResultMessage> {
  try {
    if (adapterId !== 'notion') {
      throw new Error(`Unknown export adapter: ${adapterId}`);
    }

    const settings = await getSettings();
    if (!settings.notion.apiKey) {
      throw new Error('Please configure your Notion API key in Settings');
    }

    const { NotionAdapter } = await import('@/lib/export/notion');
    const adapter = new NotionAdapter(settings.notion);

    if (replacePageId) {
      await adapter.archivePage(replacePageId);
    }

    const result = await adapter.export(summary, content);

    if (result.databaseId && !settings.notion.databaseId) {
      await saveSettings({
        notion: { ...settings.notion, databaseId: result.databaseId, databaseName: result.databaseName },
      });
    }

    return { type: 'EXPORT_RESULT', success: true, url: result.url };
  } catch (err) {
    return {
      type: 'EXPORT_RESULT',
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function handleCheckNotionDuplicate(url: string): Promise<import('@/lib/messaging/types').CheckNotionDuplicateResultMessage> {
  try {
    const settings = await getSettings();
    if (!settings.notion.apiKey) {
      return { type: 'CHECK_NOTION_DUPLICATE_RESULT', success: true };
    }

    const { NotionAdapter } = await import('@/lib/export/notion');
    const adapter = new NotionAdapter(settings.notion);
    const dup = await adapter.findDuplicateByUrl(url);

    if (dup) {
      return {
        type: 'CHECK_NOTION_DUPLICATE_RESULT',
        success: true,
        duplicatePageId: dup.pageId,
        duplicatePageUrl: dup.pageUrl,
        duplicateTitle: dup.title,
      };
    }
    return { type: 'CHECK_NOTION_DUPLICATE_RESULT', success: true };
  } catch {
    // Non-blocking — fall through to normal export
    return { type: 'CHECK_NOTION_DUPLICATE_RESULT', success: true };
  }
}

async function handleTestLLMConnection(): Promise<ConnectionTestResultMessage> {
  try {
    const settings = await getSettings();
    const llmConfig = getActiveProviderConfig(settings);
    const provider = createProvider(llmConfig);
    // Call sendChat directly instead of testConnection() so errors propagate.
    // If sendChat doesn't throw, the connection works (even if response is empty
    // due to e.g. Gemini safety filters on trivial prompts).
    await provider.sendChat(
      [{ role: 'user', content: 'Reply with "ok"' }],
      { maxTokens: 10 },
    );

    // Probe vision capabilities
    const vision = await getModelVision(provider, llmConfig.providerId, llmConfig.model);

    return { type: 'CONNECTION_TEST_RESULT', success: true, visionSupport: vision };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    // Try to extract a readable message from JSON error responses
    const readable = extractApiError(raw);
    return {
      type: 'CONNECTION_TEST_RESULT',
      success: false,
      error: readable,
    };
  }
}

async function handleProbeVision(msg: import('@/lib/messaging/types').ProbeVisionMessage): Promise<Message> {
  try {
    const settings = await getSettings();
    // Use provided config (from unsaved UI state) or fall back to saved settings
    const llmConfig = msg.providerId && msg.model ? {
      providerId: msg.providerId,
      apiKey: msg.apiKey || '',
      model: msg.model,
      endpoint: msg.endpoint,
      contextWindow: 100000,
    } : getActiveProviderConfig(settings);
    if (!llmConfig.apiKey && llmConfig.providerId !== 'self-hosted') {
      return { type: 'PROBE_VISION_RESULT', success: false, error: 'No API key' } as Message;
    }
    const provider = createProvider(llmConfig);
    const vision = await getModelVision(provider, llmConfig.providerId, llmConfig.model);
    return { type: 'PROBE_VISION_RESULT', success: true, vision } as Message;
  } catch (err) {
    return { type: 'PROBE_VISION_RESULT', success: false, error: err instanceof Error ? err.message : String(err) } as Message;
  }
}

function extractApiError(raw: string): string {
  try {
    // Match JSON embedded in error strings like "API error (400): {...}"
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const msg = parsed.error?.message || parsed.message;
      if (msg) return msg;
    }
  } catch { /* not JSON */ }
  return raw;
}

async function handleTestNotionConnection(): Promise<ConnectionTestResultMessage> {
  try {
    const settings = await getSettings();
    if (!settings.notion.apiKey) throw new Error('Notion API key not configured');

    const headers = {
      Authorization: `Bearer ${settings.notion.apiKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    };

    const response = await fetch('https://api.notion.com/v1/users/me', { headers });
    if (!response.ok) {
      return { type: 'CONNECTION_TEST_RESULT', success: false };
    }

    // If no database is selected (auto-create mode), try to set one up
    if (!settings.notion.databaseId) {
      try {
        const { NotionAdapter } = await import('@/lib/export/notion');
        const adapter = new NotionAdapter(settings.notion);
        const databaseId = await adapter.createDatabase();
        const databaseName = 'xTil Summaries';
        await saveSettings({
          notion: { ...settings.notion, databaseId, databaseName },
        });
        return {
          type: 'CONNECTION_TEST_RESULT',
          success: true,
          databaseId,
          databaseName,
        };
      } catch (err) {
        // Database creation failed — still connected, just warn
        return {
          type: 'CONNECTION_TEST_RESULT',
          success: true,
          warning: err instanceof Error ? err.message : 'Could not auto-create database',
        };
      }
    }

    return { type: 'CONNECTION_TEST_RESULT', success: true };
  } catch (err) {
    return {
      type: 'CONNECTION_TEST_RESULT',
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function handleGetSettings(): Promise<SettingsResultMessage> {
  const settings = await getSettings();
  return { type: 'SETTINGS_RESULT', settings };
}

async function handleSaveSettings(partial: object): Promise<SaveSettingsResultMessage> {
  try {
    await saveSettings(partial);
    return { type: 'SAVE_SETTINGS_RESULT', success: true };
  } catch {
    return { type: 'SAVE_SETTINGS_RESULT', success: false };
  }
}

// Required Notion database properties for compatibility check
const REQUIRED_NOTION_PROPERTIES: Record<string, string> = {
  Title: 'title',
  URL: 'url',
  Author: 'rich_text',
  'Source Type': 'select',
  'Publish Date': 'date',
  'Captured At': 'date',
  Duration: 'rich_text',
  Language: 'select',
  Tags: 'multi_select',
  'Reading Time': 'number',
  'LLM Provider': 'rich_text',
  'LLM Model': 'rich_text',
  Status: 'select',
};

function isCompatibleNotionDatabase(db: Record<string, unknown>): boolean {
  const properties = db.properties as Record<string, { type?: string }> | undefined;
  if (!properties) return false;

  for (const [name, expectedType] of Object.entries(REQUIRED_NOTION_PROPERTIES)) {
    const prop = properties[name];
    if (!prop || prop.type !== expectedType) return false;
  }
  return true;
}

async function handleFetchNotionDatabases(): Promise<NotionDatabasesResultMessage> {
  try {
    const settings = await getSettings();
    if (!settings.notion.apiKey) throw new Error('Notion API key not configured');

    const response = await fetch('https://api.notion.com/v1/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.notion.apiKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filter: { value: 'database', property: 'object' },
        page_size: 100,
      }),
    });

    if (!response.ok) throw new Error('Failed to fetch databases');

    const data = await response.json();
    const databases = data.results
      .filter((db: Record<string, unknown>) => isCompatibleNotionDatabase(db))
      .map((db: Record<string, unknown>) => ({
        id: db.id,
        title: ((db.title as Array<{ plain_text: string }>)?.[0]?.plain_text) || 'Untitled',
      }));

    return { type: 'NOTION_DATABASES_RESULT', success: true, databases };
  } catch (err) {
    return {
      type: 'NOTION_DATABASES_RESULT',
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Onboarding tabs — in-memory tracking (lost on SW restart, which is fine)
type TrackedTab = { tabId: number; originalDomain: string };
let onboardingTabs: TrackedTab[] = [];

/** Extract root domain (last 2 parts) — e.g. "accounts.x.ai" → "x.ai", "platform.openai.com" → "openai.com" */
function rootDomain(hostname: string): string {
  const parts = hostname.split('.');
  return parts.length >= 2 ? parts.slice(-2).join('.') : hostname;
}

async function handleOpenTab(url: string): Promise<{ type: 'OPEN_TAB_RESULT'; success: boolean; tabId?: number }> {
  try {
    const chromeTabs = (globalThis as unknown as { chrome: { tabs: typeof chrome.tabs } }).chrome.tabs;
    const tab = await chromeTabs.create({ url });
    if (tab.id != null) {
      const domain = new URL(url).hostname;
      onboardingTabs.push({ tabId: tab.id, originalDomain: domain });
    }
    return { type: 'OPEN_TAB_RESULT', success: true, tabId: tab.id };
  } catch {
    return { type: 'OPEN_TAB_RESULT', success: false };
  }
}

async function handleCloseOnboardingTabs(): Promise<{ type: 'CLOSE_ONBOARDING_TABS_RESULT'; success: boolean }> {
  try {
    const chromeTabs = (globalThis as unknown as { chrome: { tabs: typeof chrome.tabs } }).chrome.tabs;
    const tabs = onboardingTabs;
    onboardingTabs = [];
    for (const { tabId, originalDomain } of tabs) {
      try {
        const tab = await chromeTabs.get(tabId);
        if (tab?.url) {
          const currentRoot = rootDomain(new URL(tab.url).hostname);
          const originalRoot = rootDomain(originalDomain);
          if (currentRoot === originalRoot) {
            await chromeTabs.remove(tabId);
          }
        }
      } catch {
        // tab already closed
      }
    }
    return { type: 'CLOSE_ONBOARDING_TABS_RESULT', success: true };
  } catch {
    return { type: 'CLOSE_ONBOARDING_TABS_RESULT', success: true };
  }
}

async function handleFetchModels(
  providerId: string,
  apiKey: string,
  endpoint?: string,
): Promise<FetchModelsResultMessage> {
  try {
    const models = await fetchModels(providerId, apiKey, endpoint);
    // Cache results in storage
    const settings = await getSettings();
    await saveSettings({
      cachedModels: { ...settings.cachedModels, [providerId]: models },
    });
    return { type: 'FETCH_MODELS_RESULT', success: true, models };
  } catch (err) {
    return {
      type: 'FETCH_MODELS_RESULT',
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function fetchRedditJson(redditUrl: string): Promise<unknown[]> {
  const jsonUrl = `${redditUrl.replace(/\/$/, '')}.json?limit=200&depth=5&sort=top`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(jsonUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'web:xtil-extension:v1.0' },
    });
    if (response.status === 403) {
      throw new Error('Reddit returned 403 — the subreddit may be private or quarantined.');
    }
    if (response.status === 429) {
      throw new Error('Reddit rate limit hit. Please try again in a minute.');
    }
    if (!response.ok) {
      throw new Error(`Reddit JSON fetch failed (${response.status}).`);
    }
    return await response.json() as unknown[];
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Reddit JSON fetch timed out after 30s');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGoogleDocText(docId: string): Promise<string> {
  // Background service worker can fetch cross-origin with cookies (host_permissions: <all_urls>)
  const url = `https://docs.google.com/document/d/${docId}/export?format=txt`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Google Docs export failed (${response.status}). The document may not be accessible.`);
    }
    const text = await response.text();
    if (!text.trim()) {
      throw new Error('Document appears to be empty.');
    }
    return text.trim();
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Google Docs export timed out after 30s');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
