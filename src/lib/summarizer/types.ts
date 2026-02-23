/** Convert any value to a markdown string suitable for an extra section. */
function valueToMarkdown(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (Array.isArray(value) && value.length > 0) {
    return value.map(item => {
      if (typeof item === 'string') return `- ${item}`;
      if (item && typeof item === 'object') {
        const parts = Object.entries(item as Record<string, unknown>)
          .filter(([, v]) => v != null && v !== '')
          .map(([k, v]) => `${k}: ${String(v)}`);
        return `- ${parts.join(' | ')}`;
      }
      return `- ${String(item)}`;
    }).join('\n');
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    // Nested object — flatten each sub-key into a combined markdown block
    const lines: string[] = [];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const md = valueToMarkdown(v);
      if (md) lines.push(`**${k}**:\n${md}`);
    }
    return lines.length > 0 ? lines.join('\n\n') : undefined;
  }
  return undefined;
}

/** Parse extraSections from LLM output: validate Record<string, string> and strip markdown bold from keys. */
export function coerceExtraSections(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const cleanKey = (k: string) => k.replace(/^\*\*(.+)\*\*$/, '$1').replace(/^__(.+)__$/, '$1').trim();
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const md = valueToMarkdown(v);
    if (md) result[cleanKey(k)] = md;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export interface SummaryDocument {
  tldr: string;
  keyTakeaways: string[];
  summary: string;
  notableQuotes: string[];
  conclusion: string;
  prosAndCons?: { pros: string[]; cons: string[] };
  factCheck?: string;
  commentsHighlights?: string[];
  relatedTopics: string[];
  tags: string[];
  extraSections?: Record<string, string>; // custom sections added via chat refinement (key = title, value = markdown content)
  sourceLanguage?: string; // detected source language code, e.g. 'ru'
  summaryLanguage?: string; // language the summary is written in, e.g. 'en'
  translatedTitle?: string; // title translated to summary language (only when translated)
  inferredTitle?: string; // title inferred from content when not in metadata (e.g. Facebook posts)
  inferredAuthor?: string; // author inferred from content when not in metadata
  inferredPublishDate?: string; // publish date inferred from content when not in metadata
  llmProvider?: string; // display name of the LLM provider used, e.g. 'OpenAI'
  llmModel?: string; // model ID used for summarization, e.g. 'gpt-4o'
}
