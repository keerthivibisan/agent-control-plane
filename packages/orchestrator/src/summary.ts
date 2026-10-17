import { redact } from '@acp/core';

/** Max length of an approval summary or activity line shown in the panel (ADR-0013 §4). */
export const SUMMARY_MAX_CHARS = 200;

/** Redacts secrets and caps the length; summaries come from tool targets, which may hold anything. */
export function cleanSummary(text: string, fallback: string): string {
  const flat = redact(text).replace(/\s+/g, ' ').trim();
  const value = flat.length > 0 ? flat : fallback;
  return value.length <= SUMMARY_MAX_CHARS ? value : `${value.slice(0, SUMMARY_MAX_CHARS - 1)}…`;
}
