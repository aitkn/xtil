import { getSettings, saveSettings } from '@/lib/storage/settings';
import { getActiveProviderConfig } from '@/lib/storage/types';
import { createProvider } from '@/lib/llm/registry';
import { fetchModels } from '@/lib/llm/models';
import { summarize } from '@/lib/summarizer/summarizer';
import type { Message, ExtractResultMessage, SummaryResultMessage, ChatResponseMessage, ConnectionTestResultMessage, SettingsResultMessage, SaveSettingsResultMessage, NotionDatabasesResultMessage, ExportResultMessage, FetchModelsResultMessage } from '@/lib/messaging/types';
import type { ChatMessage } from '@/lib/llm/types';
import type { SummaryDocument } from '@/lib/summarizer/types';
import type { ExtractedContent } from '@/lib/extractors/types';

export default defineBackground(() => {
  const chromeObj = (globalThis as unknown as { chrome: typeof chrome }).chrome;

  // Open side panel when extension icon is clicked
  (chromeObj as unknown as { sidePanel?: { setPanelBehavior: (opts: { openPanelOnActionClick: boolean }) => Promise<void> } })
    .sidePanel?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch(console.error);

  chromeObj.runtime.onMessage.addListener(
    (message: unknown, _sender: unknown, sendResponse: (response: unknown) => void) => {
      handleMessage(message as Message)
        .then(sendResponse)
        .catch((err) => {
          sendResponse({ type: (message as Message).type, success: false, error: String(err) });
        });
      return true; // keep channel open for async response
    },
  );
});

async function handleMessage(message: Message): Promise<Message> {
  switch (message.type) {
    case 'EXTRACT_CONTENT':
      return handleExtractContent();
    case 'EXTRACT_COMMENTS':
      return handleExtractComments();
    case 'SUMMARIZE':
      return handleSummarize(message.content, message.userInstructions);
    case 'CHAT_MESSAGE':
      return handleChatMessage(message.messages, message.summary, message.content);
    case 'EXPORT':
      return handleExport(message.adapterId, message.summary, message.content);
    case 'TEST_LLM_CONNECTION':
      return handleTestLLMConnection();
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
    default:
      return { type: (message as Message).type, success: false, error: 'Unknown message type' } as Message;
  }
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

async function handleExtractContent(): Promise<ExtractResultMessage> {
  try {
    const chromeTabs = (globalThis as unknown as { chrome: { tabs: typeof chrome.tabs } }).chrome.tabs;
    const [tab] = await chromeTabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab found');

    let response: unknown;
    try {
      response = await sendToTab(tab.id, { type: 'EXTRACT_CONTENT' });
    } catch {
      // Content script not injected yet (page was open before extension loaded).
      // Inject it programmatically and retry.
      const chromeScripting = (globalThis as unknown as { chrome: { scripting: typeof chrome.scripting } }).chrome.scripting;
      await chromeScripting.executeScript({
        target: { tabId: tab.id },
        files: ['content-scripts/content.js'],
      });
      response = await sendToTab(tab.id, { type: 'EXTRACT_CONTENT' });
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
    const chromeTabs = (globalThis as unknown as { chrome: { tabs: typeof chrome.tabs } }).chrome.tabs;
    const [tab] = await chromeTabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab found');

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
    return response as Message;
  } catch (err) {
    return { type: 'EXTRACT_COMMENTS', success: false, error: err instanceof Error ? err.message : String(err) } as Message;
  }
}

async function handleSummarize(content: ExtractedContent, userInstructions?: string): Promise<SummaryResultMessage> {
  try {
    const settings = await getSettings();
    const llmConfig = getActiveProviderConfig(settings);

    if (!llmConfig.apiKey && llmConfig.providerId !== 'self-hosted') {
      throw new Error('Please configure your LLM API key in Settings');
    }

    const provider = createProvider(llmConfig);
    const result = await summarize(provider, content, {
      detailLevel: settings.summaryDetailLevel,
      language: settings.summaryLanguage,
      languageExcept: settings.summaryLanguageExcept,
      contextWindow: llmConfig.contextWindow,
      userInstructions,
    });

    return { type: 'SUMMARY_RESULT', success: true, data: result };
  } catch (err) {
    return {
      type: 'SUMMARY_RESULT',
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
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

    const systemPrompt = `You are a helpful assistant that helps refine and discuss content summaries.
The user has a summary of a ${content.type === 'youtube' ? 'YouTube video' : 'web page'} titled "${content.title}".

Current summary (JSON):
${JSON.stringify(summary, null, 2)}

Response format rules:
- If you need to UPDATE the summary, include the full updated JSON inside a \`\`\`json fenced code block.
- If you want to say something to the user (explanation, answer, comment), write it as plain text OUTSIDE the code block.
- You may include BOTH a text message and a JSON update in the same response, or just one of them.
- When updating the summary, always return the COMPLETE JSON object (all fields), not just the changed parts.
- Never wrap plain-text chat in a code block. Only use \`\`\`json for summary updates.`;

    const chatMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];

    const response = await provider.sendChat(chatMessages);
    return { type: 'CHAT_RESPONSE', success: true, message: response };
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
    const result = await adapter.export(summary, content);

    if (result.databaseId && !settings.notion.databaseId) {
      await saveSettings({
        notion: { ...settings.notion, databaseId: result.databaseId },
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

async function handleTestLLMConnection(): Promise<ConnectionTestResultMessage> {
  try {
    const settings = await getSettings();
    const provider = createProvider(getActiveProviderConfig(settings));
    // Call sendChat directly instead of testConnection() so errors propagate.
    // If sendChat doesn't throw, the connection works (even if response is empty
    // due to e.g. Gemini safety filters on trivial prompts).
    await provider.sendChat(
      [{ role: 'user', content: 'Reply with "ok"' }],
      { maxTokens: 10 },
    );
    return { type: 'CONNECTION_TEST_RESULT', success: true };
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

    const response = await fetch('https://api.notion.com/v1/users/me', {
      headers: {
        Authorization: `Bearer ${settings.notion.apiKey}`,
        'Notion-Version': '2022-06-28',
      },
    });

    return { type: 'CONNECTION_TEST_RESULT', success: response.ok };
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
    const databases = data.results.map((db: Record<string, unknown>) => ({
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

async function fetchGoogleDocText(docId: string): Promise<string> {
  // Background service worker can fetch cross-origin with cookies (host_permissions: <all_urls>)
  const url = `https://docs.google.com/document/d/${docId}/export?format=txt`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Google Docs export failed (${response.status}). The document may not be accessible.`);
  }
  const text = await response.text();
  if (!text.trim()) {
    throw new Error('Document appears to be empty.');
  }
  return text.trim();
}
