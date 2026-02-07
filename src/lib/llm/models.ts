import type { ModelInfo } from './types';
import { getProviderDefinition } from './registry';

export async function fetchModels(
  providerId: string,
  apiKey: string,
  endpoint?: string,
): Promise<ModelInfo[]> {
  const def = getProviderDefinition(providerId);
  const defaultCtx = def?.defaultContextWindow ?? 100000;

  switch (providerId) {
    case 'openai':
      return fetchOpenAIModels(apiKey, endpoint || def?.defaultEndpoint || '', defaultCtx, [
        /^gpt-/,
        /^o[134]-/,
        /^chatgpt-/,
      ]);
    case 'xai':
      return fetchOpenAIModels(apiKey, endpoint || def?.defaultEndpoint || '', defaultCtx);
    case 'deepseek':
      return fetchOpenAIModels(apiKey, endpoint || def?.defaultEndpoint || '', defaultCtx);
    case 'anthropic':
      return fetchAnthropicModels(apiKey, endpoint || def?.defaultEndpoint || '', defaultCtx);
    case 'google':
      return fetchGoogleModels(apiKey, endpoint || def?.defaultEndpoint || '', defaultCtx);
    case 'self-hosted':
      return fetchSelfHostedModels(endpoint || def?.defaultEndpoint || '', defaultCtx);
    default:
      return fetchOpenAIModels(apiKey, endpoint || '', defaultCtx);
  }
}

async function fetchOpenAIModels(
  apiKey: string,
  baseUrl: string,
  defaultCtx: number,
  filters?: RegExp[],
): Promise<ModelInfo[]> {
  const response = await fetch(`${baseUrl}/v1/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Invalid or unauthorized API key');
    }
    throw new Error(`Failed to fetch models (${response.status})`);
  }

  const data = await response.json();
  let models: Array<{ id: string; created: number }> = data.data ?? [];

  if (filters && filters.length > 0) {
    models = models.filter((m) => filters.some((re) => re.test(m.id)));
  }

  // Sort by created descending (most recent first)
  models.sort((a, b) => (b.created ?? 0) - (a.created ?? 0));

  return models.map((m) => ({
    id: m.id,
    name: m.id,
    contextWindow: defaultCtx,
  }));
}

async function fetchAnthropicModels(
  apiKey: string,
  baseUrl: string,
  defaultCtx: number,
): Promise<ModelInfo[]> {
  const response = await fetch(`${baseUrl}/v1/models?limit=1000`, {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Invalid or unauthorized API key');
    }
    throw new Error(`Failed to fetch models (${response.status})`);
  }

  const data = await response.json();
  const models: Array<{ id: string; display_name?: string; created_at?: string }> = data.data ?? [];

  return models.map((m) => ({
    id: m.id,
    name: m.display_name || m.id,
    contextWindow: defaultCtx,
  }));
}

async function fetchGoogleModels(
  apiKey: string,
  baseUrl: string,
  defaultCtx: number,
): Promise<ModelInfo[]> {
  const response = await fetch(`${baseUrl}/v1beta/models?key=${apiKey}`);

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Invalid or unauthorized API key');
    }
    throw new Error(`Failed to fetch models (${response.status})`);
  }

  const data = await response.json();
  const models: Array<{
    name: string;
    displayName?: string;
    inputTokenLimit?: number;
    supportedGenerationMethods?: string[];
  }> = data.models ?? [];

  return models
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => ({
      id: m.name.replace(/^models\//, ''),
      name: m.displayName || m.name.replace(/^models\//, ''),
      contextWindow: m.inputTokenLimit ?? defaultCtx,
    }));
}

async function fetchSelfHostedModels(
  baseUrl: string,
  defaultCtx: number,
): Promise<ModelInfo[]> {
  // Try Ollama /api/tags first
  try {
    const response = await fetch(`${baseUrl}/api/tags`);
    if (response.ok) {
      const data = await response.json();
      const models: Array<{ name: string }> = data.models ?? [];
      return models.map((m) => ({
        id: m.name,
        name: m.name,
        contextWindow: defaultCtx,
      }));
    }
  } catch {
    // Fall through to OpenAI-compatible
  }

  // Fallback: OpenAI-compatible /v1/models
  try {
    const response = await fetch(`${baseUrl}/v1/models`);
    if (response.ok) {
      const data = await response.json();
      const models: Array<{ id: string }> = data.data ?? [];
      return models.map((m) => ({
        id: m.id,
        name: m.id,
        contextWindow: defaultCtx,
      }));
    }
  } catch {
    // Both failed
  }

  throw new Error('Could not fetch models. Check the endpoint URL.');
}
