import { getSettings, saveSettings } from '@/lib/storage/settings';
import { getActiveProviderConfig } from '@/lib/storage/types';
import { createProvider, getProviderDefinition } from '@/lib/llm/registry';
import { fetchModels, getCatalogEntry } from '@/lib/llm/models';
import { summarize, ImageRequestError } from '@/lib/summarizer/summarizer';
import { getSystemPrompt } from '@/lib/summarizer/prompts';
import { fetchImages } from '@/lib/images/fetcher';
import { probeVision } from '@/lib/llm/vision-probe';
import type { FetchedImage } from '@/lib/images/fetcher';
import type { Message, ExtractResultMessage, SummaryResultMessage, ChatResponseMessage, ConnectionTestResultMessage, SettingsResultMessage, SaveSettingsResultMessage, NotionDatabasesResultMessage, ExportResultMessage, FetchModelsResultMessage } from '@/lib/messaging/types';
import type { ChatMessage, ImageContent, VisionSupport, LLMProvider, ChatOptions } from '@/lib/llm/types';
import { RESPONSE_SCHEMA, SCHEMA_ENFORCED_PROVIDERS } from '@/lib/llm/schemas';
import type { SummaryDocument } from '@/lib/summarizer/types';
import type { ExtractedContent, ExtractedComment } from '@/lib/extractors/types';
import type { IframeCommentsMessage } from '@/lib/messaging/types';
import { parseRedditJson, buildRedditMarkdown } from '@/lib/extractors/reddit';
import { extractText as pdfExtractText, getMeta as pdfGetMeta, extractImages as pdfExtractImages, getDocumentProxy, getResolvedPDFJS } from 'unpdf';
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

/** Broadcast a fire-and-forget message to all extension views (sidepanel, popup). */
function broadcastMessage(msg: Record<string, unknown>): void {
  const chromeRT = (globalThis as unknown as { chrome: typeof chrome }).chrome.runtime;
  try { chromeRT.sendMessage(msg, () => { void chromeRT.lastError; }); } catch { /* no listeners */ }
}

// Per-tab iframe comment storage (Disqus, Giscus, Utterances)
const iframeComments = new Map<number, ExtractedComment[]>();

export default defineBackground(() => {
  const chromeObj = (globalThis as unknown as { chrome: typeof chrome }).chrome;

  // Open side panel when available (Chrome 114+), otherwise fall back to opening as a tab
  // (Kiwi, Yandex mobile, and other browsers that support extensions but not sidePanel)
  const sidePanel = (chromeObj as unknown as { sidePanel?: { setPanelBehavior: (opts: { openPanelOnActionClick: boolean }) => Promise<void> } }).sidePanel;
  if (sidePanel?.setPanelBehavior) {
    sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
  } else {
    chromeObj.action.onClicked.addListener(() => {
      const url = chromeObj.runtime.getURL('/sidepanel.html');
      // Reuse existing xTil tab if already open
      chromeObj.tabs.query({}, (tabs: chrome.tabs.Tab[]) => {
        const existing = tabs.find((t: chrome.tabs.Tab) => t.url === url);
        if (existing?.id != null) {
          chromeObj.tabs.update(existing.id, { active: true });
        } else {
          chromeObj.tabs.create({ url });
        }
      });
    });
  }

  // On first install, navigate to xtil.ai (reuse existing tab if open)
  chromeObj.runtime.onInstalled.addListener(async (details: chrome.runtime.InstalledDetails) => {
    if (details.reason !== 'install') return;
    try {
      const win = await chromeObj.windows.getCurrent({ populate: true });
      const tabs = win.tabs || [];
      const existing = tabs.find((t: chrome.tabs.Tab) => {
        try { return new URL(t.url || '').hostname.endsWith('xtil.ai'); }
        catch { return false; }
      });
      if (existing?.id != null) {
        chromeObj.tabs.update(existing.id, { active: true });
      } else {
        chromeObj.tabs.create({ url: 'https://xtil.ai' });
      }
    } catch {
      chromeObj.tabs.create({ url: 'https://xtil.ai' });
    }
  });

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

  // Skip probe if model catalog already knows the answer
  const catalogEntry = getCatalogEntry(providerId, model);
  if (catalogEntry?.vision === true) return 'url';
  if (catalogEntry?.vision === false) return 'none';

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
      return handleExtractContent(message.readonly);
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
      return handleChatMessage(message.messages, message.summary, message.content, message.tabId, message.webSearch);
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

async function handleExtractContent(readonly?: boolean): Promise<ExtractResultMessage> {
  try {
    const [tab, settings] = await Promise.all([resolveTargetTab(), getSettings()]);

    if (isRestrictedUrl(tab.url)) {
      return { type: 'EXTRACT_RESULT', success: false, error: 'restricted', tabId: tab.id } as ExtractResultMessage;
    }

    const extractMsg = {
      type: 'EXTRACT_CONTENT' as const,
      langPrefs: settings.summaryLanguageExcept,
      summaryLang: settings.summaryLanguage,
      readonly,
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

    // Resolve PDF text extraction (fetch binary + parse with unpdf)
    if (result.success && result.data) {
      const pdfMarker = '[PDF_EXTRACT:';
      const pidx = result.data.content.indexOf(pdfMarker);
      if (pidx !== -1) {
        const pend = result.data.content.indexOf(']', pidx + pdfMarker.length);
        if (pend !== -1) {
          const pdfUrl = result.data.content.slice(pidx + pdfMarker.length, pend);
          try {
            const { text, title, author, images } = await fetchPdfText(pdfUrl);
            result.data.content = text;
            result.data.wordCount = text.split(/\s+/).filter(Boolean).length;
            result.data.estimatedReadingTime = Math.ceil(result.data.wordCount / 200);
            if (title) result.data.title = title;
            if (author) result.data.author = author;
            if (images.length > 0) {
              result.data.richImages = images.map((img) => ({
                url: img.dataUri,
                alt: `Figure from page ${img.pageNum}`,
                tier: 'inline' as const,
                width: img.width,
                height: img.height,
              }));
            }
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            result.data.content = `*Could not extract PDF text: ${errMsg}*`;
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
  let lastConversation: { role: string; content: string }[] = [];
  let rollingSummaryText = '';
  let lastRequestBody = '';
  let lastResponseBody = '';

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
    console.log(`[xTil summarize] richImages: ${content.richImages?.length ?? 0}, imageAnalysis: ${settings.enableImageAnalysis ?? true}, modelVision: ${modelVision}, enabled: ${imageAnalysisEnabled}`);

    let allFetchedImages: FetchedImage[] = [];
    let imageUrlList: { url: string; alt: string }[] = [];

    if (imageAnalysisEnabled) {
      // Send all images as actual image data (inline first, then contextual)
      const richImages = content.richImages!;
      const sorted = [
        ...richImages.filter((i) => i.tier === 'inline'),
        ...richImages.filter((i) => i.tier === 'contextual'),
      ];
      console.log(`[xTil summarize] Fetching ${sorted.length} images, URLs start with: ${sorted.map(i => i.url.substring(0, 30)).join(', ')}`);

      // Always fetch and encode as base64 — sending URLs directly is unreliable
      // because the remote LLM API can't access images behind auth/cookies (e.g. x.com)
      // or served with unsupported content-types. The service worker has the user's
      // session and fetchImages() converts unsupported formats to JPEG.
      allFetchedImages = await fetchImages(sorted, 5);
      console.log(`[xTil summarize] fetchImages returned ${allFetchedImages.length} images`);
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
    const onConversation = (msgs: { role: string; content: string }[]) => {
      lastConversation = msgs.map(m => ({ role: m.role, content: m.content }));
    };
    const onRollingSummary = (s: string) => { rollingSummaryText = s; };
    const onRequestBody = (b: string) => { lastRequestBody = b; };
    const onResponseBody = (b: string) => { lastResponseBody = b; };

    // Streaming: broadcast SUMMARY_CHUNK messages as LLM text arrives
    let currentChunkIndex: number | undefined;
    let currentTotalChunks: number | undefined;
    let lastStreamPush = 0;
    const STREAM_THROTTLE_MS = 150;
    const onStreamChunk = (accumulated: string) => {
      const now = Date.now();
      if (now - lastStreamPush < STREAM_THROTTLE_MS) return;
      lastStreamPush = now;
      broadcastMessage({ type: 'SUMMARY_CHUNK', chunk: accumulated, chunkIndex: currentChunkIndex, totalChunks: currentTotalChunks, tabId });
    };
    const onChunkProgress = (chunkIndex: number, totalChunks: number) => {
      currentChunkIndex = chunkIndex;
      currentTotalChunks = totalChunks;
    };

    try {
      const result = await summarize(provider, content, {
        detailLevel: settings.summaryDetailLevel,
        language: settings.summaryLanguage,
        languageExcept: settings.summaryLanguageExcept,
        contextWindow: llmConfig.contextWindow,
        providerId: llmConfig.providerId,
        userInstructions,
        fetchedImages: allFetchedImages.length > 0 ? allFetchedImages : undefined,
        imageUrlList: imageUrlList.length > 0 ? imageUrlList : undefined,
        signal,
        onRawResponse,
        onSystemPrompt,
        onConversation,
        onRollingSummary,
        onRequestBody,
        onResponseBody,
        onStreamChunk,
        onChunkProgress,
      });
      result.llmProvider = providerName;
      result.llmModel = llmConfig.model;
      return { type: 'SUMMARY_RESULT', success: true, data: result, rawResponses, systemPrompt: actualSystemPrompt, conversationLog: lastConversation, rollingSummary: rollingSummaryText || undefined, lastRequestBody: lastRequestBody || undefined, lastResponseBody: lastResponseBody || undefined };
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
          providerId: llmConfig.providerId,
          userInstructions,
          fetchedImages: allFetchedImages.length > 0 ? allFetchedImages : undefined,
          imageUrlList: imageUrlList.length > 0 ? imageUrlList : undefined,
          signal,
          onRawResponse,
          onSystemPrompt,
          onConversation,
          onRequestBody,
          onResponseBody,
          onStreamChunk,
          onChunkProgress,
        });
        result.llmProvider = providerName;
        result.llmModel = llmConfig.model;
        return { type: 'SUMMARY_RESULT', success: true, data: result, rawResponses, systemPrompt: actualSystemPrompt, conversationLog: lastConversation, lastRequestBody: lastRequestBody || undefined, lastResponseBody: lastResponseBody || undefined };
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
      conversationLog: lastConversation.length > 0 ? lastConversation : undefined,
      rollingSummary: rollingSummaryText || undefined,
      lastRequestBody: lastRequestBody || undefined,
      lastResponseBody: lastResponseBody || undefined,
    };
  } finally {
    if (tabId != null) activeSummarizations.delete(tabId);
  }
}

async function handleChatMessage(
  messages: ChatMessage[],
  summary: SummaryDocument,
  content: ExtractedContent,
  tabId?: number,
  webSearch?: boolean,
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
      : content.type === 'linkedin' ? 'LinkedIn post'
      : content.type === 'github' ? 'GitHub page'
      : content.type === 'pdf' ? 'PDF document'
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

    const chatFormatInstructions = `Response format: same JSON envelope as summarization.
- "text": your conversational response. Markdown supported. Use "" if only updating.
- "updates": partial changes — only include fields you want to change. "__DELETE__" removes a field. extraSections is deep-merged by key.
- "summary": full summary replacement (all fields). Use when regenerating the entire summary.
- Use "updates" or "summary", not both. Use neither if just answering a question.
- To add a new section, use "extraSections" with a plain-text title key and markdown string value, e.g. {"updates":{"extraSections":{"Comment Highlights":"- Great video!\\n- Love this series"}}}. Do NOT invent new top-level camelCase field names — always use "extraSections" for custom sections.
- To delete a specific extra section: {"updates":{"extraSections":{"Section Title":"__DELETE__"}}}. To delete ALL extra sections: {"updates":{"extraSections":"__DELETE__"}}. To delete any other field: {"updates":{"fieldName":"__DELETE__"}}.`
      + (schemaEnforced ? '' : '\n- IMPORTANT: Always respond with valid JSON. No markdown fences, no extra text.');

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
    // Strip data URI images from summary to avoid bloating the chat context
    // (the LLM can't usefully manipulate base64 blobs; original images are already attached)
    const summaryForChat = JSON.stringify(summary, null, 2)
      .replace(/!\[([^\]]*)\]\(data:[^)]+\)/g, '![[$1] — embedded image]');
    const summarySystem = `Current summary (JSON):\n${summaryForChat}`;

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
    let lastRequestBody = '';
    let lastResponseBody = '';

    const chatOpts: ChatOptions = schemaEnforced
      ? { jsonSchema: RESPONSE_SCHEMA, webSearch, onRequestBody: (b) => { lastRequestBody = b; }, onResponseBody: (b) => { lastResponseBody = b; } }
      : { jsonMode: true, webSearch, onRequestBody: (b) => { lastRequestBody = b; }, onResponseBody: (b) => { lastResponseBody = b; } };

    // Stream the chat response so the user sees typing in real-time
    let accumulated = '';
    let lastChatPush = 0;
    const CHAT_THROTTLE_MS = 150;

    const generator = provider.streamChat(chatMessages, chatOpts);
    for await (const chunk of generator) {
      accumulated += chunk;
      const now = Date.now();
      if (now - lastChatPush >= CHAT_THROTTLE_MS) {
        lastChatPush = now;
        broadcastMessage({ type: 'CHAT_CHUNK', chunk: accumulated, tabId });
      }
    }

    // Final flush
    broadcastMessage({ type: 'CHAT_CHUNK', chunk: accumulated, tabId });
    const response = accumulated;
    rawResponses.push(response);

    const conversationLog = [
      ...chatMessages.map(m => ({ role: m.role, content: m.content })),
      { role: 'assistant', content: response },
    ];

    return { type: 'CHAT_RESPONSE', success: true, message: response, rawResponses, conversationLog, lastRequestBody: lastRequestBody || undefined, lastResponseBody: lastResponseBody || undefined };
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

interface PdfImage {
  dataUri: string;
  width: number;
  height: number;
  pageNum: number;
}

async function fetchPdfText(pdfUrl: string): Promise<{ text: string; title?: string; author?: string; images: PdfImage[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(pdfUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`PDF fetch failed (${response.status}).`);
    }

    // Guard against huge PDFs that could exhaust service worker memory
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > 50_000_000) {
      throw new Error('PDF is too large to process (>50 MB).');
    }

    const arrayBuffer = await response.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    // Get a shared document proxy for all operations
    // disableFontFace: service worker has no DOM/@font-face — forces pdfjs to
    // convert text glyphs to vector paths so rendered images show readable text
    const pdf = await getDocumentProxy(data, { disableFontFace: true });

    // Extract text from all pages
    const { totalPages, text: pageTexts } = await pdfExtractText(pdf, { mergePages: false });

    // Extract metadata (title, author)
    let pdfTitle: string | undefined;
    let pdfAuthor: string | undefined;
    try {
      const { info } = await pdfGetMeta(pdf);
      if (info) {
        const meta = info as Record<string, unknown>;
        if (typeof meta.Title === 'string' && meta.Title.trim()) pdfTitle = meta.Title.trim();
        if (typeof meta.Author === 'string' && meta.Author.trim()) pdfAuthor = meta.Author.trim();
      }
    } catch {
      // Metadata extraction is non-critical
    }

    // Extract images from PDF pages (raster first, then render figure pages as fallback)
    const images = await extractPdfImages(pdf, totalPages, pageTexts as string[]);

    // Build structured text preserving page breaks
    const pages = pageTexts as string[];
    const parts: string[] = [];
    for (let i = 0; i < pages.length; i++) {
      const pageText = pages[i].trim();
      if (!pageText) continue;

      const cleaned = pageText
        .replace(/\r\n/g, '\n')
        .replace(/([^\n])\n([^\n])/g, '$1 $2') // join broken lines within paragraphs
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      if (totalPages > 1) {
        parts.push(`--- Page ${i + 1} ---\n\n${cleaned}`);
      } else {
        parts.push(cleaned);
      }
    }

    let fullText = parts.join('\n\n');
    if (!fullText.trim()) {
      throw new Error('PDF appears to contain no extractable text (may be scanned/image-based).');
    }

    // Detect garbled text (custom font encodings without proper Unicode maps)
    // Count replacement characters (□ U+FFFD, etc.) vs normal alphanumeric chars
    const alphaNum = fullText.match(/[a-zA-Z0-9]/g)?.length || 0;
    const replacementChars = fullText.match(/[\uFFFD\u25A1\u2610\u2612\u00A0]/g)?.length || 0;
    const totalChars = fullText.length;
    if (totalChars > 100 && alphaNum / totalChars < 0.15) {
      console.warn(`[xTil PDF] Text appears garbled (${alphaNum} alphanumeric / ${totalChars} total chars)`);
      fullText = '*Note: This PDF uses custom font encodings that could not be fully decoded. Text below may contain garbled characters. The page images (if any) provide the visual content.*\n\n' + fullText;
    }

    pdf.destroy();

    return { text: fullText, title: pdfTitle, author: pdfAuthor, images };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('PDF fetch timed out after 60s');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const MAX_PDF_IMAGES = 10;
const MIN_IMAGE_DIM = 100; // skip tiny images (icons, bullets, decorations)
const PAGE_RENDER_SCALE = 1.5; // 108 DPI — good balance between quality and size

async function extractPdfImages(
  pdf: Awaited<ReturnType<typeof getDocumentProxy>>,
  totalPages: number,
  pageTexts: string[],
): Promise<PdfImage[]> {
  // Step 1: Try extracting embedded raster images (including inline images)
  const rasterImages = await extractAllImages(pdf, totalPages);
  if (rasterImages.length > 0) {
    console.log(`[xTil PDF] Found ${rasterImages.length} images`);
    return rasterImages;
  }

  // Step 2: No embedded images — render pages that contain figures/tables
  console.log('[xTil PDF] No raster images found, rendering figure pages...');
  const figurePages = detectFigurePages(pageTexts);
  console.log(`[xTil PDF] Detected figure pages: ${figurePages.join(', ') || 'none'}`);

  if (figurePages.length === 0) return [];

  const rendered: PdfImage[] = [];
  for (const pageNum of figurePages.slice(0, MAX_PDF_IMAGES)) {
    try {
      const image = await renderPageAsDataUri(pdf, pageNum);
      if (image) rendered.push(image);
    } catch (err) {
      console.warn(`[xTil PDF] Failed to render page ${pageNum}:`, err);
    }
  }

  console.log(`[xTil PDF] Rendered ${rendered.length} figure pages as images`);
  return rendered;
}

/** Detect pages that likely contain figures or tables by scanning for captions. */
function detectFigurePages(pageTexts: string[]): number[] {
  const pages: number[] = [];
  for (let i = 0; i < pageTexts.length; i++) {
    const lines = pageTexts[i].split('\n');
    for (const line of lines) {
      const t = line.trim();
      if (/^Fig(?:ure)?[\s.:]+\d/i.test(t) || /^Table\s+\d/i.test(t)) {
        pages.push(i + 1); // 1-indexed
        break;
      }
    }
  }
  return pages;
}

/** Render a PDF page and crop to just the figure area.
 *  Strategy: find the caption line, then find the last "body text" line above it.
 *  Body text = long strings (>40 chars) that span the page width.
 *  Short strings (axis labels, legends) inside the figure are ignored. */
async function renderPageAsDataUri(
  pdf: Awaited<ReturnType<typeof getDocumentProxy>>,
  pageNum: number,
): Promise<PdfImage | null> {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: PAGE_RENDER_SCALE });
  const fullWidth = Math.floor(viewport.width);
  const fullHeight = Math.floor(viewport.height);

  // Get text items with positions
  const textContent = await page.getTextContent();
  const items = textContent.items.filter((it: unknown) => 'str' in (it as Record<string, unknown>)) as { str: string; transform: number[]; width?: number }[];

  // Find the caption item
  let captionCanvasY: number | null = null;
  for (const item of items) {
    const t = item.str.trim();
    if (/^Fig(?:ure)?[\s.:]+\d/i.test(t) || /^Table\s+\d/i.test(t)) {
      const [, y] = viewport.convertToViewportPoint(0, item.transform[5]);
      captionCanvasY = y;
      break;
    }
  }

  if (captionCanvasY === null) return null;

  // Collect "body text" lines — long strings that are paragraph text, not figure labels.
  // Body text lines have many characters; figure labels are short.
  const MIN_BODY_TEXT_LEN = 40;
  const bodyTextYs: number[] = [];
  for (const item of items) {
    if (item.str.trim().length >= MIN_BODY_TEXT_LEN) {
      const [, y] = viewport.convertToViewportPoint(0, item.transform[5]);
      bodyTextYs.push(y);
    }
  }
  bodyTextYs.sort((a, b) => a - b); // ascending (top of page first)

  // Find the last body text line ABOVE the caption (with some margin)
  const captionMargin = 15 * PAGE_RENDER_SCALE;
  let figureTop = 0; // default: top of page
  for (let i = bodyTextYs.length - 1; i >= 0; i--) {
    if (bodyTextYs[i] < captionCanvasY - captionMargin) {
      figureTop = bodyTextYs[i] + 12 * PAGE_RENDER_SCALE; // just below that text line
      break;
    }
  }

  // Include caption + one extra line below
  const captionBottom = captionCanvasY + 25 * PAGE_RENDER_SCALE;

  const cropTop = Math.max(0, Math.floor(figureTop));
  const cropBottom = Math.min(fullHeight, Math.floor(captionBottom));
  const cropHeight = cropBottom - cropTop;

  if (cropHeight < MIN_IMAGE_DIM) return null;

  // Render full page
  const fullCanvas = new OffscreenCanvas(fullWidth, fullHeight);
  const fullCtx = fullCanvas.getContext('2d');
  if (!fullCtx) return null;
  await page.render({ canvasContext: fullCtx as unknown as CanvasRenderingContext2D, viewport }).promise;

  // Crop to figure area
  const cropCanvas = new OffscreenCanvas(fullWidth, cropHeight);
  const cropCtx = cropCanvas.getContext('2d');
  if (!cropCtx) return null;
  cropCtx.drawImage(fullCanvas, 0, cropTop, fullWidth, cropHeight, 0, 0, fullWidth, cropHeight);

  // Trim white space from all sides by scanning pixels
  const imgData = cropCtx.getImageData(0, 0, fullWidth, cropHeight);
  const pixels = imgData.data; // RGBA
  const WHITE_THRESHOLD = 250; // near-white
  const isNonWhite = (idx: number) =>
    pixels[idx] < WHITE_THRESHOLD || pixels[idx + 1] < WHITE_THRESHOLD || pixels[idx + 2] < WHITE_THRESHOLD;
  const ROW_THRESHOLD = Math.floor(fullWidth * 0.02); // 2% of width
  const COL_THRESHOLD = Math.floor(cropHeight * 0.02); // 2% of height

  // Trim top
  let trimTop = 0;
  for (let row = 0; row < cropHeight; row++) {
    let count = 0;
    for (let col = 0; col < fullWidth; col++) {
      if (isNonWhite((row * fullWidth + col) * 4) && ++count >= ROW_THRESHOLD) break;
    }
    if (count >= ROW_THRESHOLD) { trimTop = Math.max(0, row - 5); break; }
  }

  // Trim bottom
  let trimBottom = cropHeight;
  for (let row = cropHeight - 1; row > trimTop; row--) {
    let count = 0;
    for (let col = 0; col < fullWidth; col++) {
      if (isNonWhite((row * fullWidth + col) * 4) && ++count >= ROW_THRESHOLD) break;
    }
    if (count >= ROW_THRESHOLD) { trimBottom = Math.min(cropHeight, row + 6); break; }
  }

  // Trim left
  let trimLeft = 0;
  for (let col = 0; col < fullWidth; col++) {
    let count = 0;
    for (let row = trimTop; row < trimBottom; row++) {
      if (isNonWhite((row * fullWidth + col) * 4) && ++count >= COL_THRESHOLD) break;
    }
    if (count >= COL_THRESHOLD) { trimLeft = Math.max(0, col - 5); break; }
  }

  // Trim right
  let trimRight = fullWidth;
  for (let col = fullWidth - 1; col > trimLeft; col--) {
    let count = 0;
    for (let row = trimTop; row < trimBottom; row++) {
      if (isNonWhite((row * fullWidth + col) * 4) && ++count >= COL_THRESHOLD) break;
    }
    if (count >= COL_THRESHOLD) { trimRight = Math.min(fullWidth, col + 6); break; }
  }

  const trimmedW = trimRight - trimLeft;
  const trimmedH = trimBottom - trimTop;
  if (trimmedW < MIN_IMAGE_DIM || trimmedH < MIN_IMAGE_DIM) return null;

  const needsTrim = trimTop > 0 || trimLeft > 0 || trimRight < fullWidth || trimBottom < cropHeight;
  let finalCanvas: OffscreenCanvas;
  if (needsTrim) {
    finalCanvas = new OffscreenCanvas(trimmedW, trimmedH);
    const finalCtx = finalCanvas.getContext('2d');
    if (!finalCtx) return null;
    finalCtx.drawImage(cropCanvas, trimLeft, trimTop, trimmedW, trimmedH, 0, 0, trimmedW, trimmedH);
    console.log(`[xTil PDF] Page ${pageNum}: trimmed whitespace — top=${trimTop} bottom=${cropHeight - trimBottom} left=${trimLeft} right=${fullWidth - trimRight}`);
  } else {
    finalCanvas = cropCanvas;
  }

  // PNG is better for diagrams/vector graphics rendered from PDFs
  const blob = await finalCanvas.convertToBlob({ type: 'image/png' });
  console.log(`[xTil PDF] Page ${pageNum}: figure ${trimmedW}x${trimmedH} (crop y=${cropTop}..${cropBottom})`);

  return { dataUri: await blobToBase64DataUri(blob), width: trimmedW, height: trimmedH, pageNum };
}

/** Diagnose what operator types exist on figure pages (for debugging). */
async function diagnoseFigurePages(
  pdf: Awaited<ReturnType<typeof getDocumentProxy>>,
  figurePages: number[],
): Promise<void> {
  const pdfjs = await getResolvedPDFJS();
  const OPS = pdfjs.OPS;

  // Build reverse map: OPS value → name
  const opsNames: Record<number, string> = {};
  for (const [name, value] of Object.entries(OPS)) {
    if (typeof value === 'number') opsNames[value] = name;
  }

  for (const pageNum of figurePages.slice(0, 3)) {
    try {
      const page = await pdf.getPage(pageNum);
      const opList = await page.getOperatorList();

      // Count operators by type
      const counts: Record<string, number> = {};
      for (const op of opList.fnArray) {
        const name = opsNames[op] || `unknown(${op})`;
        counts[name] = (counts[name] || 0) + 1;
      }

      // Show image-related and form-related ops
      const imageOps = Object.entries(counts).filter(([name]) =>
        name.toLowerCase().includes('image') ||
        name.toLowerCase().includes('form') ||
        name.toLowerCase().includes('paint'),
      );

      console.log(`[xTil PDF] Page ${pageNum} operators:`, JSON.stringify(counts));
      console.log(`[xTil PDF] Page ${pageNum} image/form ops:`, JSON.stringify(Object.fromEntries(imageOps)));
    } catch (err) {
      console.warn(`[xTil PDF] Failed to diagnose page ${pageNum}:`, err);
    }
  }
}

/** Extract ALL image types from PDF pages (ImageXObject, inline images, image masks). */
async function extractAllImages(
  pdf: Awaited<ReturnType<typeof getDocumentProxy>>,
  totalPages: number,
): Promise<PdfImage[]> {
  const pdfjs = await getResolvedPDFJS();
  const OPS = pdfjs.OPS;
  const images: PdfImage[] = [];

  for (let pageNum = 1; pageNum <= totalPages && images.length < MAX_PDF_IMAGES; pageNum++) {
    try {
      const page = await pdf.getPage(pageNum);
      const opList = await page.getOperatorList();

      for (let i = 0; i < opList.fnArray.length; i++) {
        if (images.length >= MAX_PDF_IMAGES) break;
        const op = opList.fnArray[i];

        // Standard ImageXObject
        if (op === OPS.paintImageXObject || op === OPS.paintImageXObjectRepeat) {
          const imageKey = opList.argsArray[i][0];
          try {
            const image = await new Promise<{ data: Uint8ClampedArray; width: number; height: number } | null>(
              (resolve) => {
                const objs = imageKey.startsWith('g_') ? page.commonObjs : page.objs;
                objs.get(imageKey, (obj: unknown) => resolve(obj as { data: Uint8ClampedArray; width: number; height: number } | null));
              },
            );
            if (image?.data && image.width >= MIN_IMAGE_DIM && image.height >= MIN_IMAGE_DIM) {
              const channels = Math.round(image.data.length / (image.width * image.height)) as 1 | 3 | 4;
              if ([1, 3, 4].includes(channels)) {
                const pdfImage = await pixelsToDataUri(image.data, image.width, image.height, channels);
                if (pdfImage) images.push({ ...pdfImage, pageNum });
              }
            }
          } catch { /* skip */ }
        }

        // Inline images (embedded directly in the content stream)
        if (op === OPS.paintInlineImageXObject || op === OPS.paintInlineImageXObjectGroup) {
          try {
            const imgData = opList.argsArray[i][0];
            if (imgData?.data && imgData.width >= MIN_IMAGE_DIM && imgData.height >= MIN_IMAGE_DIM) {
              const channels = Math.round(imgData.data.length / (imgData.width * imgData.height)) as 1 | 3 | 4;
              if ([1, 3, 4].includes(channels)) {
                const pdfImage = await pixelsToDataUri(imgData.data, imgData.width, imgData.height, channels);
                if (pdfImage) images.push({ ...pdfImage, pageNum });
              }
            }
          } catch { /* skip */ }
        }
      }
    } catch {
      // skip page
    }
  }

  return images;
}

/** Convert raw pixel data to a PNG data URI via OffscreenCanvas. */
async function pixelsToDataUri(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  channels: 1 | 3 | 4,
): Promise<Omit<PdfImage, 'pageNum'> | null> {
  const rgbaData = toRGBA(data, channels, width, height);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.putImageData(new ImageData(rgbaData, width, height), 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const dataUri = await blobToBase64DataUri(blob);

  return { dataUri, width, height };
}

/** Convert a Blob to a base64 data URI string. */
async function blobToBase64DataUri(blob: Blob): Promise<string> {
  const ab = await blob.arrayBuffer();
  const bytes = new Uint8Array(ab);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}

function toRGBA(data: Uint8ClampedArray, channels: 1 | 3 | 4, width: number, height: number): Uint8ClampedArray {
  if (channels === 4) return data;

  const rgba = new Uint8ClampedArray(width * height * 4);
  if (channels === 3) {
    for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
      rgba[j] = data[i];
      rgba[j + 1] = data[i + 1];
      rgba[j + 2] = data[i + 2];
      rgba[j + 3] = 255;
    }
  } else {
    // Grayscale
    for (let i = 0, j = 0; i < data.length; i++, j += 4) {
      rgba[j] = rgba[j + 1] = rgba[j + 2] = data[i];
      rgba[j + 3] = 255;
    }
  }
  return rgba;
}
