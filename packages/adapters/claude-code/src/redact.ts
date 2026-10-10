import { redact } from '@acp/core';

/**
 * Redacts secrets with the core rules (docs/security.md §2.4), collapses whitespace and control
 * characters, trims, and caps the length in code points (never splitting a surrogate pair). Used
 * for the only free-text fields the adapter emits: session titles and subagent descriptions.
 * Returns null when nothing is left.
 */
export function cleanFreeText(text: string, maxLength: number): string | null {
  const cleaned = redact(text)
    .replace(/[\p{Cc}\s]+/gu, ' ')
    .trim();
  if (cleaned.length === 0) return null;
  const codePoints = Array.from(cleaned);
  return codePoints.length <= maxLength
    ? cleaned
    : codePoints.slice(0, maxLength).join('').trimEnd();
}
