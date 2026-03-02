import type { ModelInfo } from './types';
import { getProviderDefinition } from './registry';
import catalogData from './model-catalog.json';

interface CatalogEntry {
  name?: string;
  contextWindow?: number;
  maxOutput?: number;
  inputPrice?: number;
  outputPrice?: number;
  vision?: boolean;
  textGeneration?: boolean;
  reasoning?: boolean;
  webSearch?: boolean;
}

interface CatalogProvider {
  models: Record<string, CatalogEntry>;
  excluded?: string[];
}

interface Catalog {
  _generated: string;
  providers: Record<string, CatalogProvider>;
}

const catalog = catalogData as Catalog;

export function getCatalogEntry(providerId: string, modelId: string): CatalogEntry | undefined {
  return catalog.providers?.[providerId]?.models?.[modelId];
}

export function getCatalogModelIds(providerId: string): Set<string> {
  const models = catalog.providers?.[providerId]?.models;
  return models ? new Set(Object.keys(models)) : new Set();
}

/** Cached excluded ID sets per provider */
const excludedCache = new Map<string, Set<string>>();

function getExcludedSet(providerId: string): Set<string> {
  let set = excludedCache.get(providerId);
  if (!set) {
    const excluded = catalog.providers?.[providerId]?.excluded;
    set = excluded ? new Set(excluded) : new Set();
    excludedCache.set(providerId, set);
  }
  return set;
}

/** Check if a model ID is in the provider's excluded list */
export function isModelExcluded(providerId: string, modelId: string): boolean {
  return getExcludedSet(providerId).has(modelId);
}

/** Patterns matching non-chat model IDs to exclude */
const NON_CHAT_PATTERNS = [
  /embedding/,
  /\btts\b/,
  /\brealtime\b/,
  /^gpt-audio/,
  /transcribe/,
  /^gpt-image/,
  /^chatgpt-image/,
  /\bimage\b/,
  /\bimagin/,
  /codex/,
  /instruct/,
];

/** Date suffix like -2024-05-13 or -0709 (MMDD) */
const DATE_SUFFIX_RE = /^(.+)-(\d{4}-\d{2}-\d{2}|\d{4})$/;

/** Preview suffix like -preview-05-06 or -preview-09-2025 */
const PREVIEW_SUFFIX_RE = /^(.+)-preview-\d{2}-\d{2,4}$/;

export function filterChatModels(models: ModelInfo[]): ModelInfo[] {
  // Collect all model IDs for dedup lookup
  const idSet = new Set(models.map((m) => m.id));
  const byId = new Map(models.map((m) => [m.id, m]));

  // Before dedup, propagate pricing from dated/preview variants to their base
  // models so that when the variant is hidden, the base still shows a price.
  for (const m of models) {
    if (m.inputPrice == null) continue;

    let baseId: string | undefined;
    const dateMatch = DATE_SUFFIX_RE.exec(m.id);
    if (dateMatch && idSet.has(dateMatch[1])) baseId = dateMatch[1];
    if (!baseId) {
      const previewMatch = PREVIEW_SUFFIX_RE.exec(m.id);
      if (previewMatch && idSet.has(previewMatch[1])) baseId = previewMatch[1];
    }
    if (!baseId) continue;

    const base = byId.get(baseId)!;
    if (base.inputPrice != null) continue; // base already has pricing
    base.inputPrice = m.inputPrice;
    base.outputPrice = m.outputPrice;
    if (base.maxOutput == null) base.maxOutput = m.maxOutput;
    if (base.vision == null) base.vision = m.vision;
    if (base.reasoning == null) base.reasoning = m.reasoning;
    if (base.webSearch == null) base.webSearch = m.webSearch;
  }

  return models.filter((m) => {
    // a) Catalog says not text-capable
    if (m.textGeneration === false) return false;

    // b) Pattern-based exclusion
    if (NON_CHAT_PATTERNS.some((re) => re.test(m.id))) return false;

    // c) Dated snapshot dedup: hide if the base model (without date) also exists
    const match = DATE_SUFFIX_RE.exec(m.id);
    if (match) {
      const base = match[1];
      if (idSet.has(base)) return false;
    }

    // d) Preview snapshot dedup: hide "foo-preview-05-06" if "foo" exists
    const previewMatch = PREVIEW_SUFFIX_RE.exec(m.id);
    if (previewMatch) {
      const base = previewMatch[1];
      if (idSet.has(base)) return false;
    }

    return true;
  });
}

export function getCatalogModels(providerId: string): ModelInfo[] {
  const providerCatalog = catalog.providers?.[providerId];
  if (!providerCatalog) return [];
  const defaultCtx = getProviderDefinition(providerId)?.defaultContextWindow || 100000;
  const models: ModelInfo[] = Object.entries(providerCatalog.models)
    .filter(([, e]) => e.textGeneration !== false)
    .map(([id, e]) => ({
      id,
      name: e.name || id,
      contextWindow: e.contextWindow || defaultCtx,
      maxOutput: e.maxOutput,
      inputPrice: e.inputPrice,
      outputPrice: e.outputPrice,
      vision: e.vision,
      textGeneration: e.textGeneration,
      reasoning: e.reasoning,
      webSearch: e.webSearch,
    }));
  return filterChatModels(models);
}

export async function fetchModels(
  providerId: string,
  apiKey: string,
  endpoint?: string,
): Promise<ModelInfo[]> {
  const def = getProviderDefinition(providerId);
  const defaultCtx = def?.defaultContextWindow ?? 100000;

  let models: ModelInfo[];
  switch (providerId) {
    case 'openai':
      models = await fetchOpenAIModels('openai', apiKey, endpoint || def?.defaultEndpoint || '', defaultCtx, [
        /^gpt-/,
        /^o[134]-/,
        /^chatgpt-/,
      ]);
      break;
    case 'xai':
      models = await fetchOpenAIModels('xai', apiKey, endpoint || def?.defaultEndpoint || '', defaultCtx);
      break;
    case 'deepseek':
      models = await fetchOpenAIModels('deepseek', apiKey, endpoint || def?.defaultEndpoint || '', defaultCtx);
      break;
    case 'anthropic':
      models = await fetchAnthropicModels(apiKey, endpoint || def?.defaultEndpoint || '', defaultCtx);
      break;
    case 'google':
      models = await fetchGoogleModels(apiKey, endpoint || def?.defaultEndpoint || '', defaultCtx);
      break;
    case 'self-hosted':
      models = await fetchSelfHostedModels(endpoint || def?.defaultEndpoint || '', defaultCtx);
      break;
    default:
      models = await fetchOpenAIModels(providerId, apiKey, endpoint || '', defaultCtx);
      break;
  }

  return filterChatModels(models);
}

async function fetchOpenAIModels(
  providerId: string,
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

  return models.map((m) => {
    const entry = getCatalogEntry(providerId, m.id);
    return {
      id: m.id,
      name: entry?.name || m.id,
      contextWindow: entry?.contextWindow || defaultCtx,
      maxOutput: entry?.maxOutput,
      inputPrice: entry?.inputPrice,
      outputPrice: entry?.outputPrice,
      vision: entry?.vision,
      textGeneration: entry?.textGeneration,
      reasoning: entry?.reasoning,
      webSearch: entry?.webSearch,
    };
  });
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

  return models.map((m) => {
    const entry = getCatalogEntry('anthropic', m.id);
    return {
      id: m.id,
      name: entry?.name || m.display_name || m.id,
      contextWindow: entry?.contextWindow || defaultCtx,
      maxOutput: entry?.maxOutput,
      inputPrice: entry?.inputPrice,
      outputPrice: entry?.outputPrice,
      vision: entry?.vision,
      textGeneration: entry?.textGeneration,
      reasoning: entry?.reasoning,
      webSearch: entry?.webSearch,
    };
  });
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
    outputTokenLimit?: number;
    supportedGenerationMethods?: string[];
  }> = data.models ?? [];

  return models
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => {
      const id = m.name.replace(/^models\//, '');
      const entry = getCatalogEntry('google', id);
      // Google API's inputTokenLimit takes priority over catalog
      const contextWindow = m.inputTokenLimit ?? entry?.contextWindow ?? defaultCtx;
      return {
        id,
        name: entry?.name || m.displayName || id,
        contextWindow,
        maxOutput: m.outputTokenLimit ?? entry?.maxOutput,
        inputPrice: entry?.inputPrice,
        outputPrice: entry?.outputPrice,
        vision: entry?.vision,
        textGeneration: entry?.textGeneration,
        reasoning: entry?.reasoning,
        webSearch: entry?.webSearch,
      };
    });
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
