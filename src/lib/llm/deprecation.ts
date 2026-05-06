import type { ModelInfo, ProviderConfig } from './types';
import type { MigrationNotice } from '../storage/types';
import { fetchModels, getCatalogEntry } from './models';
import { getProviderDefinition } from './registry';
import { saveSettings } from '../storage/settings';

const MODEL_ERROR_PATTERNS = [
  /\bmodel[_\s-]*not[_\s-]*found\b/i,
  /\bmodel[_\s-]*decommissioned\b/i,
  /\bdoes\s*not\s*exist\b/i,
  /\bunknown\s*model\b/i,
  /\binvalid\s*model\b/i,
  /\bdeprecated\s*model\b/i,
  /\bnot[_\s-]*found[_\s-]*error\b/i,
  /\bno\s+such\s+model\b/i,
  /\bmodel\b[^.]*\b(retired|sunset|discontinued|removed)\b/i,
];

/** Loose check whether an error message implies the model itself was rejected. */
export function looksLikeModelError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  if (!msg) return false;
  if (/\b404\b/.test(msg) && /\bmodel\b/i.test(msg)) return true;
  return MODEL_ERROR_PATTERNS.some((re) => re.test(msg));
}

interface FallbackContext {
  needsVision: boolean;
  needsReasoning: boolean;
  needsWebSearch: boolean;
}

function deriveContext(deadModel: string, providerId: string): FallbackContext {
  const entry = getCatalogEntry(providerId, deadModel);
  return {
    needsVision: entry?.vision === true,
    needsReasoning: entry?.reasoning === true,
    needsWebSearch: entry?.webSearch === true,
  };
}

/** Pick the closest live replacement for a discontinued model. */
export function pickFallbackModel(
  liveModels: ModelInfo[],
  ctx: FallbackContext,
): ModelInfo | null {
  if (liveModels.length === 0) return null;

  const score = (m: ModelInfo): number => {
    let s = 0;
    if (ctx.needsVision && m.vision === true) s += 8;
    if (ctx.needsVision && m.vision === false) s -= 4;
    if (ctx.needsReasoning && m.reasoning === true) s += 4;
    if (ctx.needsWebSearch && m.webSearch === true) s += 2;
    if (m.inputPrice != null) s += 1; // priced-in-catalog ≈ curated
    return s;
  };

  const ranked = [...liveModels].sort((a, b) => score(b) - score(a));
  return ranked[0] ?? null;
}

export interface DiscontinuationResult {
  newConfig: ProviderConfig;
  notice: MigrationNotice;
}

/**
 * After an LLM call failure, verify whether the configured model has been
 * discontinued by refreshing the provider's /models endpoint. If confirmed:
 * persist the swap into settings (providerConfigs + discoveredDiscontinued +
 * pendingMigrationNotices) and return the new config so the caller can retry.
 *
 * Returns null for any non-discontinuation error (transient, auth, network) —
 * caller should rethrow the original error in that case.
 */
export async function handleDiscontinuationOnError(
  error: unknown,
  config: ProviderConfig,
): Promise<DiscontinuationResult | null> {
  if (!looksLikeModelError(error)) return null;
  if (!config.apiKey && config.providerId !== 'self-hosted') return null;

  let liveModels: ModelInfo[];
  try {
    liveModels = await fetchModels(config.providerId, config.apiKey, config.endpoint);
  } catch {
    // /models also failed — likely auth/network issue. Don't touch settings.
    return null;
  }

  const stillThere = liveModels.some((m) => m.id === config.model);
  if (stillThere) return null; // transient or non-model error

  const ctx = deriveContext(config.model, config.providerId);
  const fallback = pickFallbackModel(liveModels, ctx);
  if (!fallback) return null;

  const notice: MigrationNotice = {
    providerId: config.providerId,
    from: config.model,
    to: fallback.id,
    toName: fallback.name,
    providerName: getProviderDefinition(config.providerId)?.name,
    at: Date.now(),
  };

  // Use the function form of saveSettings so the merge runs against the freshest
  // snapshot under the storage write queue — concurrent failures (e.g. summary +
  // vision probe failing on the same retired model) won't lose each other's
  // notices or discoveredDiscontinued entries.
  let newConfig!: ProviderConfig;
  await saveSettings((current) => {
    const existing = current.providerConfigs[config.providerId] || config;
    newConfig = {
      ...existing,
      model: fallback.id,
      contextWindow: fallback.contextWindow || existing.contextWindow,
    };
    const discoveredFor = new Set(current.discoveredDiscontinued?.[config.providerId] ?? []);
    discoveredFor.add(config.model);
    return {
      providerConfigs: {
        ...current.providerConfigs,
        [config.providerId]: newConfig,
      },
      discoveredDiscontinued: {
        ...current.discoveredDiscontinued,
        [config.providerId]: [...discoveredFor],
      },
      pendingMigrationNotices: [...(current.pendingMigrationNotices ?? []), notice],
    };
  });

  return { newConfig, notice };
}
