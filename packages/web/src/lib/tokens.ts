import type { TokenCounts } from '@acp/core';

export type TokenCategory = keyof TokenCounts;

/**
 * Categories are priced differently, so they are always shown separately and never summed.
 * @deprecated Labels for new UI come from `TOKEN_TYPES` in ./copy (DESIGN.md wording). Kept until
 * phase 2 moves the existing screens over.
 */
export const TOKEN_CATEGORIES: readonly { key: TokenCategory; label: string; short: string }[] = [
  { key: 'input', label: 'Input', short: 'in' },
  { key: 'output', label: 'Output', short: 'out' },
  { key: 'cacheCreation', label: 'Cache creation', short: 'cache w' },
  { key: 'cacheRead', label: 'Cache read', short: 'cache r' },
];

/**
 * One color per token type, defined once in index.css (`--color-token-*`, light and dark). Use the
 * CSS value for SVG/Recharts strokes and the class names for HTML swatches.
 */
export const TOKEN_TYPE_COLOR: Readonly<Record<TokenCategory, { css: string; bg: string }>> = {
  input: { css: 'var(--color-token-input)', bg: 'bg-token-input' },
  output: { css: 'var(--color-token-output)', bg: 'bg-token-output' },
  cacheCreation: { css: 'var(--color-token-cache-write)', bg: 'bg-token-cache-write' },
  cacheRead: { css: 'var(--color-token-cache-read)', bg: 'bg-token-cache-read' },
};
