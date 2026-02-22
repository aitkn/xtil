// Typical 5,000-word article: ~6,250 content tokens + ~1,000 system prompt overhead
const TYPICAL_INPUT_TOKENS = 7250;
// Output tokens vary by detail level
const OUTPUT_TOKENS_BY_DETAIL: Record<string, number> = {
  brief: 600,
  standard: 1000,
  detailed: 1800,
};

/** Estimate cost in USD for summarizing a typical 5,000-word article. */
export function estimateArticlePrice(
  inputPrice: number | undefined,  // per 1M tokens
  outputPrice: number | undefined, // per 1M tokens
  detailLevel: string = 'standard',
): number | null {
  if (inputPrice == null || outputPrice == null) return null;
  const outputTokens = OUTPUT_TOKENS_BY_DETAIL[detailLevel] ?? OUTPUT_TOKENS_BY_DETAIL.standard;
  return (TYPICAL_INPUT_TOKENS / 1_000_000) * inputPrice
       + (outputTokens / 1_000_000) * outputPrice;
}

/** Format a dollar amount for display (e.g., "$0.0037", "<$0.001"). */
export function formatArticlePrice(dollars: number): string {
  if (dollars < 0.001) return '<$0.001';
  if (dollars < 0.01) return `~$${dollars.toFixed(4)}`;
  return `~$${dollars.toFixed(3)}`;
}

/**
 * Format a dollar amount with fixed width for monospace alignment.
 * Always uses 4 decimal places so decimal points align in a column.
 */
export function formatArticlePriceFixed(dollars: number): string {
  return `$${dollars.toFixed(4)}`;
}
