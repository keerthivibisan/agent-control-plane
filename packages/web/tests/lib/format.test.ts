import { describe, expect, it } from 'vitest';
import { formatExactTime, formatRelative, idPrefix } from '../../src/lib/format';

const NOW = new Date('2026-10-10T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatRelative', () => {
  it('reads as words relative to the injected clock', () => {
    expect(formatRelative(ago(10_000), NOW)).toBe('just now');
    expect(formatRelative(ago(3 * MIN), NOW)).toBe('3 min ago');
    expect(formatRelative(ago(59 * MIN), NOW)).toBe('59 min ago');
    expect(formatRelative(ago(5 * HOUR), NOW)).toBe('5 h ago');
    expect(formatRelative(ago(1 * DAY + HOUR), NOW)).toBe('yesterday');
    expect(formatRelative(ago(4 * DAY), NOW)).toBe('4 days ago');
  });

  it('shows a date after a week, with the year only when it differs', () => {
    expect(formatRelative(ago(30 * DAY), NOW)).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
    expect(formatRelative('2024-03-01T12:00:00.000Z', NOW)).toMatch(/2024/);
  });

  it('never shows a negative age for a future time (clock skew)', () => {
    expect(formatRelative(new Date(NOW.getTime() + 5 * MIN).toISOString(), NOW)).toBe('just now');
  });

  it('returns unparseable input unchanged', () => {
    expect(formatRelative('nope', NOW)).toBe('nope');
    expect(formatExactTime('nope')).toBe('nope');
  });
});

describe('formatExactTime / idPrefix', () => {
  it('formats the full local time including the year', () => {
    expect(formatExactTime('2026-10-10T08:05:00.000Z')).toMatch(/2026/);
  });

  it('cuts ids to 8 characters', () => {
    expect(idPrefix('0123456789abcdef')).toBe('01234567');
    expect(idPrefix('abc')).toBe('abc');
  });
});
