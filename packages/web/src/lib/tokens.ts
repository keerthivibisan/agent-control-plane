import type { TokenCounts } from '@acp/core';

export type TokenCategory = keyof TokenCounts;

/** Categories are priced differently, so they are always shown separately and never summed. */
export const TOKEN_CATEGORIES: readonly { key: TokenCategory; label: string; short: string }[] = [
  { key: 'input', label: 'Input', short: 'in' },
  { key: 'output', label: 'Output', short: 'out' },
  { key: 'cacheCreation', label: 'Cache creation', short: 'cache w' },
  { key: 'cacheRead', label: 'Cache read', short: 'cache r' },
];
