#!/usr/bin/env node

/**
 * update-model-catalog.mjs — Build src/lib/llm/model-catalog.json
 *
 * Three-layer merge:
 *   1. Hardcoded baseline (KNOWN_MODELS)
 *   2. API model lists (discovers current model IDs, Google returns context sizes)
 *   3. LLM-parsed docs (optional, catches new models/prices/context changes)
 *
 * Usage:
 *   node scripts/update-model-catalog.mjs
 *   node scripts/update-model-catalog.mjs --skip-docs
 *   node scripts/update-model-catalog.mjs --provider=google
 *   node scripts/update-model-catalog.mjs --dry-run
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUTPUT_PATH = resolve(ROOT, 'src/lib/llm/model-catalog.json');
const ENV_PATH = resolve(ROOT, '.env');

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const skipDocs = args.includes('--skip-docs');
const dryRun = args.includes('--dry-run');
const providerFlag = args.find((a) => a.startsWith('--provider='))?.split('=')[1];

// ---------------------------------------------------------------------------
// Read .env
// ---------------------------------------------------------------------------
function loadEnv() {
  if (!existsSync(ENV_PATH)) return {};
  const lines = readFileSync(ENV_PATH, 'utf-8').split('\n');
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
  }
  return env;
}

const env = loadEnv();

// Map .env keys → provider IDs
const API_KEYS = {
  openai: env.OPENAI,
  anthropic: env.ANTROPIC,
  google: env.GOOGLE,
  xai: env.X,
  deepseek: env.DEEP_SEEK,
};

// ---------------------------------------------------------------------------
// Layer 1 — Hardcoded baseline (KNOWN_MODELS)
// ---------------------------------------------------------------------------
const KNOWN_MODELS = {
  openai: {
    models: {
      'gpt-4o': {
        name: 'GPT-4o',
        contextWindow: 128000,
        maxOutput: 16384,
        inputPrice: 2.5,
        outputPrice: 10.0,
        vision: true,
      },
      'gpt-4o-mini': {
        name: 'GPT-4o mini',
        contextWindow: 128000,
        maxOutput: 16384,
        inputPrice: 0.15,
        outputPrice: 0.6,
        vision: true,
      },
      'gpt-4.1': {
        name: 'GPT-4.1',
        contextWindow: 1047576,
        maxOutput: 32768,
        inputPrice: 2.0,
        outputPrice: 8.0,
        vision: true,
      },
      'gpt-4.1-mini': {
        name: 'GPT-4.1 mini',
        contextWindow: 1047576,
        maxOutput: 32768,
        inputPrice: 0.4,
        outputPrice: 1.6,
        vision: true,
      },
      'gpt-4.1-nano': {
        name: 'GPT-4.1 nano',
        contextWindow: 1047576,
        maxOutput: 32768,
        inputPrice: 0.1,
        outputPrice: 0.4,
        vision: true,
      },
      'gpt-4-turbo': {
        name: 'GPT-4 Turbo',
        contextWindow: 128000,
        maxOutput: 4096,
        inputPrice: 10.0,
        outputPrice: 30.0,
        vision: true,
      },
      'o1': {
        name: 'o1',
        contextWindow: 200000,
        maxOutput: 100000,
        inputPrice: 15.0,
        outputPrice: 60.0,
        vision: true,
      },
      'o1-mini': {
        name: 'o1 mini',
        contextWindow: 128000,
        maxOutput: 65536,
        inputPrice: 1.1,
        outputPrice: 4.4,
        vision: false,
      },
      'o1-pro': {
        name: 'o1 Pro',
        contextWindow: 200000,
        maxOutput: 100000,
        inputPrice: 150.0,
        outputPrice: 600.0,
        vision: true,
      },
      'o3': {
        name: 'o3',
        contextWindow: 200000,
        maxOutput: 100000,
        inputPrice: 10.0,
        outputPrice: 40.0,
        vision: true,
      },
      'o3-mini': {
        name: 'o3 mini',
        contextWindow: 200000,
        maxOutput: 100000,
        inputPrice: 1.1,
        outputPrice: 4.4,
        vision: false,
      },
      'o4-mini': {
        name: 'o4 mini',
        contextWindow: 200000,
        maxOutput: 100000,
        inputPrice: 1.1,
        outputPrice: 4.4,
        vision: true,
      },
      'chatgpt-4o-latest': {
        name: 'ChatGPT-4o Latest',
        contextWindow: 128000,
        maxOutput: 16384,
        inputPrice: 5.0,
        outputPrice: 15.0,
        vision: true,
      },
    },
  },
  anthropic: {
    models: {
      'claude-sonnet-4-5-20250929': {
        name: 'Claude Sonnet 4.5',
        contextWindow: 200000,
        maxOutput: 16384,
        inputPrice: 3.0,
        outputPrice: 15.0,
        vision: true,
      },
      'claude-opus-4-20250514': {
        name: 'Claude Opus 4',
        contextWindow: 200000,
        maxOutput: 32000,
        inputPrice: 15.0,
        outputPrice: 75.0,
        vision: true,
      },
      'claude-haiku-4-5-20251001': {
        name: 'Claude Haiku 4.5',
        contextWindow: 200000,
        maxOutput: 16384,
        inputPrice: 0.8,
        outputPrice: 4.0,
        vision: true,
      },
      'claude-3-5-sonnet-20241022': {
        name: 'Claude 3.5 Sonnet',
        contextWindow: 200000,
        maxOutput: 8192,
        inputPrice: 3.0,
        outputPrice: 15.0,
        vision: true,
      },
      'claude-3-5-haiku-20241022': {
        name: 'Claude 3.5 Haiku',
        contextWindow: 200000,
        maxOutput: 8192,
        inputPrice: 0.8,
        outputPrice: 4.0,
        vision: false,
      },
      'claude-3-opus-20240229': {
        name: 'Claude 3 Opus',
        contextWindow: 200000,
        maxOutput: 4096,
        inputPrice: 15.0,
        outputPrice: 75.0,
        vision: true,
      },
      'claude-3-haiku-20240307': {
        name: 'Claude 3 Haiku',
        contextWindow: 200000,
        maxOutput: 4096,
        inputPrice: 0.25,
        outputPrice: 1.25,
        vision: true,
      },
    },
  },
  google: {
    models: {
      'gemini-2.5-pro-preview-05-06': {
        name: 'Gemini 2.5 Pro',
        contextWindow: 1048576,
        maxOutput: 65536,
        inputPrice: 1.25,
        outputPrice: 10.0,
        vision: true,
      },
      'gemini-2.5-flash-preview-05-20': {
        name: 'Gemini 2.5 Flash',
        contextWindow: 1048576,
        maxOutput: 65536,
        inputPrice: 0.15,
        outputPrice: 0.6,
        vision: true,
      },
      'gemini-2.0-flash': {
        name: 'Gemini 2.0 Flash',
        contextWindow: 1048576,
        maxOutput: 8192,
        inputPrice: 0.1,
        outputPrice: 0.4,
        vision: true,
      },
      'gemini-2.0-flash-lite': {
        name: 'Gemini 2.0 Flash Lite',
        contextWindow: 1048576,
        maxOutput: 8192,
        inputPrice: 0.075,
        outputPrice: 0.3,
        vision: true,
      },
      'gemini-1.5-pro': {
        name: 'Gemini 1.5 Pro',
        contextWindow: 2097152,
        maxOutput: 8192,
        inputPrice: 1.25,
        outputPrice: 5.0,
        vision: true,
      },
      'gemini-1.5-flash': {
        name: 'Gemini 1.5 Flash',
        contextWindow: 1048576,
        maxOutput: 8192,
        inputPrice: 0.075,
        outputPrice: 0.3,
        vision: true,
      },
    },
  },
  xai: {
    models: {
      // --- Text generation models ---
      'grok-4-1-fast-reasoning': {
        name: 'Grok 4.1 Fast (Reasoning)',
        contextWindow: 2097152,
        inputPrice: 0.2,
        outputPrice: 0.5,
        vision: true,
        textGeneration: true,
      },
      'grok-4-1-fast-non-reasoning': {
        name: 'Grok 4.1 Fast (Non-Reasoning)',
        contextWindow: 2097152,
        inputPrice: 0.2,
        outputPrice: 0.5,
        vision: true,
        textGeneration: true,
      },
      'grok-code-fast-1': {
        name: 'Grok Code Fast 1',
        contextWindow: 262144,
        inputPrice: 0.2,
        outputPrice: 1.5,
        vision: false,
        textGeneration: true,
      },
      'grok-4-0709': {
        name: 'Grok 4',
        contextWindow: 262144,
        inputPrice: 3.0,
        outputPrice: 15.0,
        vision: true,
        textGeneration: true,
      },
      'grok-4-fast-reasoning': {
        name: 'Grok 4 Fast (Reasoning)',
        contextWindow: 2097152,
        inputPrice: 0.2,
        outputPrice: 0.5,
        vision: true,
        textGeneration: true,
      },
      'grok-4-fast-non-reasoning': {
        name: 'Grok 4 Fast (Non-Reasoning)',
        contextWindow: 2097152,
        inputPrice: 0.2,
        outputPrice: 0.5,
        vision: true,
        textGeneration: true,
      },
      'grok-3': {
        name: 'Grok 3',
        contextWindow: 131072,
        inputPrice: 3.0,
        outputPrice: 15.0,
        vision: false,
        textGeneration: true,
      },
      'grok-3-mini': {
        name: 'Grok 3 Mini',
        contextWindow: 131072,
        inputPrice: 0.3,
        outputPrice: 0.5,
        vision: false,
        textGeneration: true,
      },
      'grok-2-vision-1212': {
        name: 'Grok 2 Vision',
        contextWindow: 32768,
        inputPrice: 2.0,
        outputPrice: 10.0,
        vision: true,
        textGeneration: true,
      },
      // --- Image/video generation models (not for chat) ---
      'grok-2-image-1212': {
        name: 'Grok 2 Image',
        vision: false,
        textGeneration: false,
      },
      'grok-imagine-image-pro': {
        name: 'Grok Imagine Image Pro',
        vision: false,
        textGeneration: false,
      },
      'grok-imagine-image': {
        name: 'Grok Imagine Image',
        vision: false,
        textGeneration: false,
      },
      'grok-imagine-video': {
        name: 'Grok Imagine Video',
        vision: false,
        textGeneration: false,
      },
    },
  },
  deepseek: {
    models: {
      'deepseek-chat': {
        name: 'DeepSeek V3',
        contextWindow: 65536,
        maxOutput: 8192,
        inputPrice: 0.27,
        outputPrice: 1.1,
        vision: false,
      },
      'deepseek-reasoner': {
        name: 'DeepSeek R1',
        contextWindow: 65536,
        maxOutput: 8192,
        inputPrice: 0.55,
        outputPrice: 2.19,
        vision: false,
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Provider endpoints & doc URLs
// ---------------------------------------------------------------------------
const PROVIDERS = {
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    docUrl: 'https://platform.openai.com/docs/pricing',
    filters: [/^gpt-/, /^o[134]-/, /^chatgpt-/],
  },
  anthropic: {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    docUrl: 'https://docs.anthropic.com/en/docs/about-claude/models',
  },
  google: {
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    docUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
  },
  xai: {
    name: 'xAI (Grok)',
    baseUrl: 'https://api.x.ai',
    docUrl: 'https://docs.x.ai/developers/models',
  },
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    docUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
  },
};

// ---------------------------------------------------------------------------
// Layer 2 — API model lists
// ---------------------------------------------------------------------------
async function fetchOpenAIApiModels(apiKey, baseUrl, filters) {
  try {
    const res = await fetch(`${baseUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      console.warn(`  API ${baseUrl}/v1/models → ${res.status}`);
      return {};
    }
    const data = await res.json();
    let models = data.data ?? [];
    if (filters?.length) {
      models = models.filter((m) => filters.some((re) => re.test(m.id)));
    }
    const result = {};
    for (const m of models) {
      // Don't set name — raw ID is low-quality, let baseline/docs provide it
      result[m.id] = {};
    }
    return result;
  } catch (err) {
    console.warn(`  API fetch failed: ${err.message}`);
    return {};
  }
}

async function fetchAnthropicApiModels(apiKey) {
  try {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=1000', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    });
    if (!res.ok) {
      console.warn(`  Anthropic API → ${res.status}`);
      return {};
    }
    const data = await res.json();
    const result = {};
    for (const m of data.data ?? []) {
      result[m.id] = { name: m.display_name || m.id };
    }
    return result;
  } catch (err) {
    console.warn(`  API fetch failed: ${err.message}`);
    return {};
  }
}

async function fetchGoogleApiModels(apiKey) {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
    );
    if (!res.ok) {
      console.warn(`  Google API → ${res.status}`);
      return {};
    }
    const data = await res.json();
    const result = {};
    for (const m of data.models ?? []) {
      if (!m.supportedGenerationMethods?.includes('generateContent')) continue;
      const id = m.name.replace(/^models\//, '');
      result[id] = {
        name: m.displayName || id,
        contextWindow: m.inputTokenLimit || undefined,
        maxOutput: m.outputTokenLimit || undefined,
      };
    }
    return result;
  } catch (err) {
    console.warn(`  API fetch failed: ${err.message}`);
    return {};
  }
}

async function fetchApiModels(providerId, apiKey) {
  const provider = PROVIDERS[providerId];
  if (!apiKey) {
    console.warn(`  No API key for ${providerId}, skipping API layer`);
    return {};
  }

  switch (providerId) {
    case 'openai':
      return fetchOpenAIApiModels(apiKey, provider.baseUrl, provider.filters);
    case 'anthropic':
      return fetchAnthropicApiModels(apiKey);
    case 'google':
      return fetchGoogleApiModels(apiKey);
    case 'xai':
      return fetchOpenAIApiModels(apiKey, provider.baseUrl);
    case 'deepseek':
      return fetchOpenAIApiModels(apiKey, provider.baseUrl);
    default:
      return {};
  }
}

// ---------------------------------------------------------------------------
// Layer 3 — LLM-parsed docs (optional)
// ---------------------------------------------------------------------------
function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchDocPage(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) {
      console.warn(`  Doc fetch ${url} → ${res.status}`);
      return null;
    }
    const html = await res.text();
    const text = stripHtml(html);
    // Truncate to ~30K chars to fit in Claude's context
    return text.slice(0, 30000);
  } catch (err) {
    console.warn(`  Doc fetch failed: ${err.message}`);
    return null;
  }
}

async function parseDocsWithLLM(providerName, docsText) {
  const anthropicKey = API_KEYS.anthropic;
  if (!anthropicKey) {
    console.warn('  No Anthropic API key, skipping LLM doc parsing');
    return {};
  }

  const prompt = `You are extracting model metadata from a pricing/models documentation page for ${providerName}.

Extract ALL models mentioned with their specifications. For each model, provide:
- id: the exact API model ID (e.g., "gpt-4o", "claude-sonnet-4-5-20250929", "gemini-2.0-flash")
- name: human-friendly display name
- contextWindow: input context window in tokens (number)
- maxOutput: maximum output tokens (number)
- inputPrice: price per 1 million input tokens in USD (number)
- outputPrice: price per 1 million output tokens in USD (number)
- vision: whether the model supports image/vision input (boolean)

Respond with ONLY a JSON object mapping model IDs to their metadata. Omit fields you cannot determine. Example:
{
  "gpt-4o": {
    "name": "GPT-4o",
    "contextWindow": 128000,
    "maxOutput": 16384,
    "inputPrice": 2.50,
    "outputPrice": 10.00,
    "vision": true
  }
}

Documentation text:
${docsText}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      console.warn(`  LLM parse failed: ${res.status}`);
      return {};
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '';

    // Extract JSON from response (may be wrapped in markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('  LLM response had no JSON');
      return {};
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return parsed;
  } catch (err) {
    console.warn(`  LLM parse error: ${err.message}`);
    return {};
  }
}

// ---------------------------------------------------------------------------
// Merge logic
// ---------------------------------------------------------------------------
function mergeModelEntry(baseline, api, docs) {
  const merged = { ...baseline };

  // API layer overrides baseline (per non-null field)
  if (api) {
    for (const [key, val] of Object.entries(api)) {
      if (val != null) merged[key] = val;
    }
  }

  // Docs layer overrides both (per non-null field)
  if (docs) {
    for (const [key, val] of Object.entries(docs)) {
      if (val != null) merged[key] = val;
    }
  }

  return merged;
}

function mergeCatalog(baseline, apiModels, docsModels) {
  // Collect all model IDs from all sources
  const allIds = new Set([
    ...Object.keys(baseline),
    ...Object.keys(apiModels),
    ...Object.keys(docsModels),
  ]);

  const merged = {};
  for (const id of allIds) {
    merged[id] = mergeModelEntry(baseline[id] || {}, apiModels[id], docsModels[id]);

    // Ensure required fields have fallbacks
    if (!merged[id].name) merged[id].name = id;
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
function validateProvider(providerId, models) {
  const warnings = [];
  for (const [id, meta] of Object.entries(models)) {
    if (!meta.contextWindow) {
      warnings.push(`  WARN: ${providerId}/${id} — missing contextWindow`);
    }
    if (meta.inputPrice == null) {
      warnings.push(`  WARN: ${providerId}/${id} — missing inputPrice`);
    }
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function processProvider(providerId) {
  const provider = PROVIDERS[providerId];
  console.log(`\n[${provider.name}]`);

  // Layer 1: baseline
  const baseline = KNOWN_MODELS[providerId]?.models || {};
  console.log(`  Baseline: ${Object.keys(baseline).length} models`);

  // Layer 2: API
  const apiKey = API_KEYS[providerId];
  console.log(`  Fetching API models...`);
  const apiModels = await fetchApiModels(providerId, apiKey);
  console.log(`  API: ${Object.keys(apiModels).length} models`);

  // Log models found in API but not in baseline
  for (const id of Object.keys(apiModels)) {
    if (!baseline[id]) {
      console.log(`  NEW from API: ${id}`);
    }
  }

  // Layer 3: docs (optional)
  let docsModels = {};
  if (!skipDocs && provider.docUrl) {
    console.log(`  Fetching docs: ${provider.docUrl}`);
    const docsText = await fetchDocPage(provider.docUrl);
    if (docsText) {
      console.log(`  Parsing docs with LLM (${docsText.length} chars)...`);
      docsModels = await parseDocsWithLLM(provider.name, docsText);
      console.log(`  Docs: ${Object.keys(docsModels).length} models parsed`);
    }
  } else if (skipDocs) {
    console.log(`  Skipping docs (--skip-docs)`);
  }

  // Merge
  const merged = mergeCatalog(baseline, apiModels, docsModels);
  console.log(`  Merged: ${Object.keys(merged).length} models`);

  // Validate
  const warnings = validateProvider(providerId, merged);
  for (const w of warnings) console.log(w);

  return merged;
}

async function main() {
  console.log('=== xTil Model Catalog Update ===');
  console.log(`Flags: skipDocs=${skipDocs}, dryRun=${dryRun}, provider=${providerFlag || 'all'}`);

  const providerIds = providerFlag ? [providerFlag] : Object.keys(PROVIDERS);

  // If single provider mode, load existing catalog and update just that provider
  let existingCatalog = null;
  if (providerFlag && existsSync(OUTPUT_PATH)) {
    try {
      existingCatalog = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'));
    } catch {
      // ignore parse errors
    }
  }

  const catalog = {
    _generated: new Date().toISOString(),
    providers: {},
  };

  // Copy existing providers if updating single provider
  if (existingCatalog?.providers) {
    catalog.providers = { ...existingCatalog.providers };
  }

  for (const id of providerIds) {
    if (!PROVIDERS[id]) {
      console.error(`Unknown provider: ${id}`);
      process.exit(1);
    }
    const models = await processProvider(id);

    // Sort models alphabetically by ID
    const sorted = {};
    for (const key of Object.keys(models).sort()) {
      sorted[key] = models[key];
    }

    catalog.providers[id] = { models: sorted };
  }

  // Sort providers
  const sortedProviders = {};
  for (const key of Object.keys(catalog.providers).sort()) {
    sortedProviders[key] = catalog.providers[key];
  }
  catalog.providers = sortedProviders;

  const json = JSON.stringify(catalog, null, 2) + '\n';

  if (dryRun) {
    console.log('\n--- DRY RUN OUTPUT ---');
    console.log(json);
  } else {
    writeFileSync(OUTPUT_PATH, json, 'utf-8');
    console.log(`\nWritten to ${OUTPUT_PATH}`);
  }

  // Summary
  let total = 0;
  for (const p of Object.values(catalog.providers)) {
    total += Object.keys(p.models).length;
  }
  console.log(`Total: ${total} models across ${Object.keys(catalog.providers).length} providers`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
