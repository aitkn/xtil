import type { LLMProvider, ProviderConfig, ProviderDefinition } from './types';
import { OpenAICompatibleProvider } from './provider';
import { AnthropicProvider } from './anthropic';
import { GoogleProvider } from './google';

export const PROVIDER_DEFINITIONS: ProviderDefinition[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    defaultEndpoint: 'https://api.openai.com',
    defaultContextWindow: 128000,
    apiKeyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    defaultEndpoint: 'https://api.anthropic.com',
    defaultContextWindow: 200000,
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'google',
    name: 'Google Gemini',
    defaultEndpoint: 'https://generativelanguage.googleapis.com',
    defaultContextWindow: 1000000,
    apiKeyUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    defaultEndpoint: 'https://api.x.ai',
    defaultContextWindow: 128000,
    apiKeyUrl: 'https://console.x.ai/',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    defaultEndpoint: 'https://api.deepseek.com',
    defaultContextWindow: 64000,
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'self-hosted',
    name: 'Self-hosted',
    defaultEndpoint: 'http://localhost:11434',
    defaultContextWindow: 100000,
  },
];

export function createProvider(config: ProviderConfig): LLMProvider {
  const definition = PROVIDER_DEFINITIONS.find((d) => d.id === config.providerId);
  const defaultEndpoint = definition?.defaultEndpoint || '';

  switch (config.providerId) {
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'google':
      return new GoogleProvider(config);
    case 'openai':
      return new OpenAICompatibleProvider(config, 'OpenAI', defaultEndpoint);
    case 'xai':
      return new OpenAICompatibleProvider(config, 'xAI (Grok)', defaultEndpoint);
    case 'deepseek':
      return new OpenAICompatibleProvider(config, 'DeepSeek', defaultEndpoint);
    case 'self-hosted':
      return new OpenAICompatibleProvider(config, 'Self-hosted', defaultEndpoint);
    default:
      // Treat unknown providers as OpenAI-compatible
      return new OpenAICompatibleProvider(config, config.providerId, defaultEndpoint);
  }
}

export function getProviderDefinition(providerId: string): ProviderDefinition | undefined {
  return PROVIDER_DEFINITIONS.find((d) => d.id === providerId);
}
