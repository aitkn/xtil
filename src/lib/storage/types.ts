import type { ModelInfo } from '../llm/types';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface ProviderConfig {
  providerId: string; // 'openai' | 'anthropic' | 'google' | 'xai' | 'deepseek' | 'self-hosted'
  apiKey: string;
  model: string;
  endpoint?: string; // custom endpoint for self-hosted
  contextWindow: number; // in tokens
}

export interface NotionConfig {
  apiKey: string;
  databaseId?: string;
  databaseName?: string;
}

export interface Settings {
  providerConfigs: Record<string, ProviderConfig>;
  activeProviderId: string;
  notion: NotionConfig;
  summaryLanguage: string; // target language code, e.g. 'en'
  summaryLanguageExcept: string[]; // don't translate if source is one of these, e.g. ['en', 'ru']
  summaryDetailLevel: 'brief' | 'standard' | 'detailed';
  theme: ThemeMode;
  cachedModels?: Record<string, ModelInfo[]>;
}

export const DEFAULT_SETTINGS: Settings = {
  providerConfigs: {
    openai: {
      providerId: 'openai',
      apiKey: '',
      model: 'gpt-4o',
      contextWindow: 128000,
    },
  },
  activeProviderId: 'openai',
  notion: {
    apiKey: '',
  },
  summaryLanguage: 'en',
  summaryLanguageExcept: ['en'],
  summaryDetailLevel: 'standard',
  theme: 'system',
};

export function getActiveProviderConfig(settings: Settings): ProviderConfig {
  const config = settings.providerConfigs[settings.activeProviderId];
  if (config) return config;
  // Fallback: return the first available config or a default
  const firstKey = Object.keys(settings.providerConfigs)[0];
  if (firstKey) return settings.providerConfigs[firstKey];
  return DEFAULT_SETTINGS.providerConfigs['openai'];
}
