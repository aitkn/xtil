import { DEFAULT_SETTINGS, type Settings, type ProviderConfig } from './types';

const STORAGE_KEY = 'xtil_settings';
const OLD_STORAGE_KEY = 'tldr_settings';
const chromeStorage = (globalThis as unknown as { chrome: { storage: typeof chrome.storage } }).chrome.storage;

export async function getSettings(): Promise<Settings> {
  const result = await chromeStorage.local.get([STORAGE_KEY, OLD_STORAGE_KEY]);
  let stored = result[STORAGE_KEY] as Record<string, unknown> | undefined;

  // One-time migration from old key
  if (!stored) {
    const oldStored = result[OLD_STORAGE_KEY] as Record<string, unknown> | undefined;
    if (oldStored) {
      stored = oldStored;
      await chromeStorage.local.set({ [STORAGE_KEY]: stored });
      await chromeStorage.local.remove(OLD_STORAGE_KEY);
    }
  }

  if (!stored) return { ...DEFAULT_SETTINGS };

  // Migration: old format had `llm: ProviderConfig` instead of providerConfigs/activeProviderId
  if (stored.llm && !stored.providerConfigs) {
    const oldLlm = stored.llm as ProviderConfig;
    const migrated: Settings = {
      ...DEFAULT_SETTINGS,
      providerConfigs: {
        [oldLlm.providerId]: oldLlm,
      },
      activeProviderId: oldLlm.providerId,
      notion: (stored.notion as Settings['notion']) || DEFAULT_SETTINGS.notion,
      summaryLanguage: (stored.summaryLanguage as string) || DEFAULT_SETTINGS.summaryLanguage,
      summaryLanguageExcept: (stored.summaryLanguageExcept as string[]) || DEFAULT_SETTINGS.summaryLanguageExcept,
      summaryDetailLevel: (stored.summaryDetailLevel as Settings['summaryDetailLevel']) || DEFAULT_SETTINGS.summaryDetailLevel,
      theme: (stored.theme as Settings['theme']) || DEFAULT_SETTINGS.theme,
    };
    // Persist migration
    await chromeStorage.local.set({ [STORAGE_KEY]: migrated });
    return migrated;
  }

  return { ...DEFAULT_SETTINGS, ...(stored as Partial<Settings>) };
}

// Serialize concurrent writes within this process. chrome.storage doesn't expose
// a CAS primitive, so two concurrent saveSettings() calls would each read-then-
// write and the second one would clobber the first's mutations. Chaining keeps
// every write atomic relative to other writes in this process.
let writeQueue: Promise<unknown> = Promise.resolve();

export async function saveSettings(
  partial: Partial<Settings> | ((current: Settings) => Partial<Settings>),
): Promise<Settings> {
  const next = writeQueue.then(async () => {
    const current = await getSettings();
    const patch = typeof partial === 'function' ? partial(current) : partial;
    const updated = { ...current, ...patch };
    await chromeStorage.local.set({ [STORAGE_KEY]: updated });
    return updated;
  });
  writeQueue = next.catch(() => undefined);
  return next;
}
