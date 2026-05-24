---
name: curate-models
description: Incrementally curate the model catalog based on a diff from the raw catalog. Only new/removed/changed models are reviewed — existing decisions are stable.
disable-model-invocation: true
allowed-tools: Read, Edit, Write, Bash(node *), WebSearch, WebFetch, Grep, Glob
---

# Model Catalog Curation (Incremental)

You are curating the model catalog for **xTil**, a Chrome extension that summarizes web pages and YouTube videos using LLM APIs. Users pick a model from this catalog in Settings.

The curated catalog lives at `src/lib/llm/model-catalog.json`.
The raw catalog lives at `src/lib/llm/model-catalog-raw.json`.
The diff lives at `src/lib/llm/.model-catalog-diff.json`.

**Key principle: existing keep/exclude decisions are NEVER re-evaluated.** You only process the diff.

---

## Input: The Diff

Read `src/lib/llm/.model-catalog-diff.json`. It has this structure:
```json
{
  "newModels": { "provider/modelId": { ...specs } },
  "removedModels": { "provider/modelId": { ...specs } },
  "changedModels": { "provider/modelId": { "field": { "old": ..., "new": ... } } },
  "hasChanges": true
}
```

**If `hasChanges` is false** → print "No changes to curate." and stop.

---

## Bootstrap: No Existing Curated Catalog

If `src/lib/llm/model-catalog.json` does not exist, fall back to full curation:
1. Copy `src/lib/llm/model-catalog-raw.json` to `src/lib/llm/model-catalog.json`
2. Apply the **Full Curation Rules** (appendix at bottom) to every model
3. Stop — do not process the diff

---

## Incremental Process

Read both `model-catalog.json` (curated) and `model-catalog-raw.json` (raw).

### 1. Handle REMOVED models

For each model in `removedModels`:
- If it exists in curated `models` → remove it
- If it exists in curated `excluded` → remove it from `excluded`
- Print: `REMOVED provider/modelId — removed from curated catalog`

### 2. Handle CHANGED specs

For each model in `changedModels`:
- If it exists in curated `models` → update the changed fields in the curated entry
- If `inputPrice` changed by >3x (either direction), flag it:
  `FLAG provider/modelId — inputPrice changed from $X to $Y (>3x), re-evaluate keep/drop`
  Apply the same curation criteria as for new models to decide if it should still be kept or excluded.
- For non-flagged changes, just update silently
- Print: `UPDATED provider/modelId — fields: contextWindow, inputPrice, ...`

### 3. Handle NEW models (main work)

For each model in `newModels`:

#### 3a. Rename detection
Check if a model was simultaneously removed and added from the same provider with similar name/specs. If so, this is a rename — preserve the old decision:
- If old model was in curated `models` → add new model to `models` (same position), remove old
- If old model was in `excluded` → add new model to `excluded`, remove old
- Print: `RENAME provider/oldId → provider/newId — preserving decision`

#### 3b. Automatic filters (no judgment needed)
Remove models matching ANY of these — add to `excluded` if they pass `filterChatModels`:

1. **No pricing data** — missing both `inputPrice` and `outputPrice`. Exception: if you recognize the model as important and widely used, search the web for its current pricing.
2. **Non-text-generation models** — image generation, video, audio/TTS, speech-to-text, realtime, embeddings, moderation. Check for keywords: `image`, `tts`, `audio`, `realtime`, `transcribe`, `codex`, `embed`, `moderate`, `imagine`, `video`. Also check `textGeneration: false`.
3. **Dated snapshots** when a stable alias exists — e.g., `gpt-5-2025-08-07` if `gpt-5` exists.
4. **Deep research / specialized** — autonomous multi-step research, computer use, robotics.

#### 3c. Intelligent curation (requires reasoning)
For each remaining new model, decide keep or exclude by comparing against existing curated models from the same provider:

1. **Supersession** — Does this new model supersede a kept model? (newer gen, same/better price, better specs) → **substitute**: add new, exclude old. Is it superseded by a kept model? → **exclude**.
2. **Price ceiling** — `inputPrice > $10/M` → exclude. Exception: if provider has NO models under $10, keep cheapest.
3. **Fills a new tier?** — Does this model occupy a genuinely different price/capability tier not covered by existing models? → **keep**.
4. **Redundant?** — Too close in price (<20% diff) and capability to an existing kept model? → **exclude**.
5. **Target: 3-7 models per provider** — Don't exceed without good reason.

#### 3d. Print decision table for new models only
```
NEW MODELS:
✅ KEEP  openai/gpt-6-mini     $0.30  — fills budget tier, vision+reasoning
❌ DROP  openai/gpt-4o-2025-03 $2.50  — dated snapshot, gpt-4o alias exists
🔄 SWAP  anthropic/claude-5-haiku $0.50 → replaces claude-haiku-4-5 (superseded)
```

### 4. Re-order affected providers

Only re-order providers that had models added or removed. Follow the ordering principles:
- **Top** = best default choice (quality/price/features balance, latest generation)
- **Next** = strong picks at different price points, best-value-first
- **Bottom** = niche (ultra-cheap, expensive/premium, older gen, reasoning-only)

### 5. Update excluded arrays

For each provider, ensure `excluded` contains all dropped model IDs that pass `filterChatModels` (i.e., NOT already caught by `NON_CHAT_PATTERNS`, `DATE_SUFFIX_RE`, or `PREVIEW_SUFFIX_RE` in `src/lib/llm/models.ts`). Remove stale entries for models no longer in raw catalog.

### 6. Final steps

1. **Update `_generated` timestamp** to current time
2. **Print summary**: `Curated: X models across Y providers (+N added, -M removed, ~K updated)`

---

## Important rules

- NEVER re-evaluate existing keep/exclude decisions (unless flagged by >3x price change)
- NEVER invent models or pricing — only work with what's in the catalogs
- NEVER modify the data of existing kept models (unless updating changed specs from diff)
- When in doubt about whether a new model is important, search the web for it
- If a provider ends up with 0 models after curation, that's a problem — re-evaluate
- Show your reasoning for every non-obvious decision

---

## Appendix: Full Curation Rules (bootstrap only)

Used only when `model-catalog.json` doesn't exist. Review every model:

### Automatic removal
1. No pricing data (missing both inputPrice and outputPrice)
2. Non-text-generation models (image, video, audio, embeddings, moderation)
3. Dated snapshots when stable alias exists
4. Deep research / specialized models

### Intelligent curation
1. Superseded models — older, same/higher price, strictly worse → remove (unless >30% cheaper)
2. Price ceiling — inputPrice > $10/M → remove (unless provider's only option)
3. Redundant tiers — <20% price difference, same capability → keep only the better one
4. Target 3-7 models per provider

### Ordering
- Top = best default (quality/price/features balance)
- Middle = other strong picks at different price points
- Bottom = niche (ultra-cheap, expensive, older gen)

### Output
Print decision table, edit catalog, update excluded arrays, update timestamp.
Print: `Curated: X models across Y providers (removed Z)`
