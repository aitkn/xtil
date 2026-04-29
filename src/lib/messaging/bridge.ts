import type { Message } from './types';

const chromeRuntime = (globalThis as unknown as { chrome: { runtime: typeof chrome.runtime } }).chrome.runtime;
const chromeTabs = (globalThis as unknown as { chrome: { tabs: typeof chrome.tabs } }).chrome.tabs;

// 120s is an inactivity (idle) timeout — see SendMessageOptions.keepAliveTypes.
const MESSAGE_TIMEOUT_MS = 120_000;

export interface SendMessageOptions {
  /**
   * Broadcast message types whose arrival counts as "the request is still
   * making progress" — receiving one resets the inactivity timer. Use this
   * for streaming flows (SUMMARIZE → SUMMARY_CHUNK, CHAT_MESSAGE → CHAT_CHUNK)
   * so a long generation doesn't trip the timeout while chunks are arriving.
   *
   * The listener is scoped to the request's `tabId` when both the outgoing
   * message and the incoming broadcast carry one — this prevents a chunk
   * stream for one tab from keeping a stuck request in another tab alive.
   * If either side omits `tabId`, the listener falls back to runtime-wide
   * matching (acceptable for single-side-panel usage).
   */
  keepAliveTypes?: readonly string[];
}

export function sendMessage<T extends Message>(
  message: T,
  options?: SendMessageOptions,
): Promise<Message> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;

    const onTimeout = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Message "${message.type}" timed out after ${MESSAGE_TIMEOUT_MS / 1000}s with no activity`));
    };
    const armTimer = () => { timer = setTimeout(onTimeout, MESSAGE_TIMEOUT_MS); };

    const keepAliveTypes = options?.keepAliveTypes;
    const requestTabId = (message as { tabId?: unknown }).tabId;
    const activityListener = keepAliveTypes && keepAliveTypes.length > 0
      ? (msg: unknown) => {
          if (settled) return;
          const incoming = msg as { type?: unknown; tabId?: unknown } | undefined;
          const t = incoming?.type;
          if (typeof t !== 'string' || !keepAliveTypes.includes(t)) return;
          // Scope by tabId when both sides have one — prevents one tab's
          // chunks from keeping a stuck request in another tab alive.
          if (requestTabId !== undefined && incoming?.tabId !== undefined && incoming.tabId !== requestTabId) {
            return;
          }
          clearTimeout(timer);
          armTimer();
        }
      : null;

    const cleanup = () => {
      clearTimeout(timer);
      if (activityListener) chromeRuntime.onMessage.removeListener(activityListener);
    };

    if (activityListener) chromeRuntime.onMessage.addListener(activityListener);
    armTimer();

    chromeRuntime.sendMessage(message, (response: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (chromeRuntime.lastError) {
        reject(new Error(chromeRuntime.lastError.message));
      } else {
        resolve(response as Message);
      }
    });
  });
}

export function sendTabMessage<T extends Message>(tabId: number, message: T): Promise<Message> {
  return new Promise((resolve, reject) => {
    chromeTabs.sendMessage(tabId, message, (response: unknown) => {
      if (chromeRuntime.lastError) {
        reject(new Error(chromeRuntime.lastError.message));
      } else {
        resolve(response as Message);
      }
    });
  });
}
