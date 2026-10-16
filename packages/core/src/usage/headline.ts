import type { TokenCounts } from './usage.js';

/**
 * New work vs cache reuse (docs/redesign/README.md §4.5), derived from one set of already
 * deduplicated, summed token counts. A figure is null when none of its categories was reported;
 * a missing category inside a reported figure counts as absent, not as 0 tokens of evidence, so the
 * caller should also show `recordsWithUnavailable` from the totals.
 */
export interface TokenHeadline {
  /** input + output */
  newWork: number | null;
  /** newWork + cacheCreation + cacheRead */
  totalProcessed: number | null;
  /** cacheRead / totalProcessed, in 0..1 */
  cacheReuseShare: number | null;
}

function sumKnown(values: readonly (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
}

export function tokenHeadline(tokens: TokenCounts): TokenHeadline {
  const newWork = sumKnown([tokens.input, tokens.output]);
  const totalProcessed = sumKnown([
    tokens.input,
    tokens.output,
    tokens.cacheCreation,
    tokens.cacheRead,
  ]);
  const cacheReuseShare =
    totalProcessed === null || totalProcessed === 0 || tokens.cacheRead === null
      ? null
      : tokens.cacheRead / totalProcessed;
  return { newWork, totalProcessed, cacheReuseShare };
}
