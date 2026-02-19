// Typical 5,000-word article: ~6,250 content tokens + ~1,000 system prompt overhead
const TYPICAL_INPUT_TOKENS = 7250;
// Standard-detail summary output
const TYPICAL_OUTPUT_TOKENS = 1000;

/** Estimate cost in USD for summarizing a typical 5,000-word article. */
export function estimateArticlePrice(
  inputPrice: number | undefined,  // per 1M tokens
  outputPrice: number | undefined, // per 1M tokens
): number | null {
  if (inputPrice == null || outputPrice == null) return null;
  return (TYPICAL_INPUT_TOKENS / 1_000_000) * inputPrice
       + (TYPICAL_OUTPUT_TOKENS / 1_000_000) * outputPrice;
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
