/**
 * Shared helpers for normalizing LLM output into SummaryDocument fields.
 * Used by both the summarizer pipeline (summarizer.ts) and the sidepanel (App.tsx).
 */

/** Coerce commentsHighlights from LLM — accepts "commentsHighlights" or "comments" alias,
 *  and converts a single string into a one-element array. */
export function coerceCommentsHighlights(parsed: Record<string, unknown>): string[] | undefined {
  const raw = parsed.commentsHighlights ?? parsed.comments;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) return [raw];
  return undefined;
}

/** Known SummaryDocument fields — anything else with string/array content is an extra section. */
export const KNOWN_FIELDS = new Set([
  'tldr', 'keyTakeaways', 'summary', 'notableQuotes', 'conclusion',
  'prosAndCons', 'factCheck', 'commentsHighlights', 'comments',
  'extraSections', 'relatedTopics', 'tags',
  'sourceLanguage', 'summaryLanguage', 'translatedTitle',
  'inferredTitle', 'inferredAuthor', 'inferredPublishDate',
  'llmProvider', 'llmModel',
  // Envelope/signal keys (not summary fields)
  'text', 'noContent', 'noSummary', 'requestedImages', 'message', 'reason', 'updates',
]);

/**
 * Collect unknown fields from a parsed LLM object into extraSections.
 * Converts camelCase/snake_case keys to Title Case labels.
 */
export function collectUnknownAsExtra(parsed: Record<string, unknown>, existing?: Record<string, string>): Record<string, string> | undefined {
  const extra: Record<string, string> = existing ? { ...existing } : {};
  for (const [key, value] of Object.entries(parsed)) {
    if (KNOWN_FIELDS.has(key)) continue;
    let content: string | undefined;
    if (typeof value === 'string' && value.trim()) {
      content = value;
    } else if (Array.isArray(value) && value.length > 0) {
      content = value.map(item => {
        if (typeof item === 'string') return `- ${item}`;
        if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          const parts = Object.entries(obj)
            .filter(([, v]) => v != null && v !== '')
            .map(([k, v]) => `${k}: ${String(v)}`);
          return `- ${parts.join(' | ')}`;
        }
        return `- ${String(item)}`;
      }).join('\n');
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      const lines = Object.entries(obj)
        .filter(([, v]) => v != null && v !== '')
        .map(([k, v]) => `**${k}**: ${String(v)}`);
      if (lines.length > 0) content = lines.join('\n');
    }
    if (content) {
      const label = key
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
      extra[label] = content;
    }
  }
  return Object.keys(extra).length > 0 ? extra : undefined;
}
