import type { SummaryDocument } from '../summarizer/types';
import type { ExtractedContent } from '../extractors/types';

export interface DisplayMessage {
  role: 'user' | 'assistant';
  content: string;
  internal?: boolean;
  /** Snapshot of the summary before this user message was processed. */
  summaryBefore?: SummaryDocument;
  /** Whether this user message caused the summary to change. */
  didUpdateSummary?: boolean;
}

export interface PersistedTabState {
  summary: SummaryDocument | null;
  content: ExtractedContent | null;
  chatMessages: DisplayMessage[];
  notionUrl: string | null;
  url: string;
}

const PREFIX = 'tldr_tab_';

const chromeStorage = () =>
  (globalThis as unknown as { chrome: { storage: typeof chrome.storage } }).chrome.storage;

export async function savePersistedTabState(tabId: number, state: PersistedTabState): Promise<void> {
  await chromeStorage().session.set({ [`${PREFIX}${tabId}`]: state });
}

export async function getPersistedTabState(tabId: number): Promise<PersistedTabState | null> {
  const key = `${PREFIX}${tabId}`;
  const result = await chromeStorage().session.get(key);
  return (result[key] as PersistedTabState) || null;
}

export async function deletePersistedTabState(tabId: number): Promise<void> {
  await chromeStorage().session.remove(`${PREFIX}${tabId}`);
}

export async function clearAllPersistedTabStates(): Promise<void> {
  const all = await chromeStorage().session.get(null);
  const keys = Object.keys(all).filter(k => k.startsWith(PREFIX));
  if (keys.length > 0) {
    await chromeStorage().session.remove(keys);
  }
}
