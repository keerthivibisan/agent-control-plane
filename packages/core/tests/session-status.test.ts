import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SESSION_STATUS_THRESHOLDS,
  deriveSessionStatus,
  SessionStatusSchema,
} from '../src/index.js';

const NOW = new Date('2026-10-10T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe('deriveSessionStatus (A4)', () => {
  it('uses the documented default thresholds', () => {
    expect(DEFAULT_SESSION_STATUS_THRESHOLDS).toEqual({
      activeWindowMs: 120_000,
      staleAfterMs: 1_800_000,
    });
  });

  it.each([
    [0, 'active'],
    [120_000, 'active'],
    [120_001, 'idle'],
    [1_800_000, 'idle'],
    [1_800_001, 'stale'],
    [30 * 24 * 3_600_000, 'stale'],
  ] as const)('evidence %i ms old is %s', (age, expected) => {
    expect(deriveSessionStatus({ lastEventAt: ago(age), endedAt: null }, NOW)).toBe(expected);
  });

  it('honours custom thresholds', () => {
    const thresholds = { activeWindowMs: 1_000, staleAfterMs: 5_000 };
    const status = (age: number) =>
      deriveSessionStatus({ lastEventAt: ago(age), endedAt: null }, NOW, thresholds);
    expect([status(1_000), status(1_001), status(5_000), status(5_001)]).toEqual([
      'active',
      'idle',
      'idle',
      'stale',
    ]);
  });

  it('is ended when an end was observed and nothing happened after it', () => {
    expect(deriveSessionStatus({ lastEventAt: ago(60_000), endedAt: ago(60_000) }, NOW)).toBe(
      'ended',
    );
    expect(deriveSessionStatus({ lastEventAt: ago(90_000), endedAt: ago(60_000) }, NOW)).toBe(
      'ended',
    );
    // An end seen without any other timestamped evidence is still an observed end.
    expect(deriveSessionStatus({ lastEventAt: null, endedAt: ago(5_000) }, NOW)).toBe('ended');
  });

  it('stays ended however old the end is (ended is evidence, not a timeout)', () => {
    expect(deriveSessionStatus({ lastEventAt: ago(1e9), endedAt: ago(1e9) }, NOW)).toBe('ended');
  });

  it('becomes active again on activity after an observed end (resume)', () => {
    expect(deriveSessionStatus({ lastEventAt: ago(10_000), endedAt: ago(600_000) }, NOW)).toBe(
      'active',
    );
    expect(deriveSessionStatus({ lastEventAt: ago(600_000), endedAt: ago(700_000) }, NOW)).toBe(
      'idle',
    );
  });

  it('gives unknown when there is no evidence', () => {
    expect(deriveSessionStatus({ lastEventAt: null, endedAt: null }, NOW)).toBe('unknown');
    expect(deriveSessionStatus({ lastEventAt: 'not-a-time', endedAt: null }, NOW)).toBe('unknown');
  });

  it('treats evidence dated in the future (clock skew) as active', () => {
    expect(deriveSessionStatus({ lastEventAt: ago(-60_000), endedAt: null }, NOW)).toBe('active');
  });

  it('never yields completed and always yields a valid status', () => {
    const samples = [null, ago(0), ago(200_000), ago(3_600_000)];
    for (const lastEventAt of samples) {
      for (const endedAt of samples) {
        const status = deriveSessionStatus({ lastEventAt, endedAt }, NOW);
        expect(SessionStatusSchema.options).toContain(status);
        expect(status).not.toBe('completed');
      }
    }
  });

  it('rejects invalid thresholds and dates', () => {
    const evidence = { lastEventAt: ago(0), endedAt: null };
    expect(() =>
      deriveSessionStatus(evidence, NOW, { activeWindowMs: 10, staleAfterMs: 5 }),
    ).toThrow(RangeError);
    expect(() =>
      deriveSessionStatus(evidence, NOW, { activeWindowMs: -1, staleAfterMs: 5 }),
    ).toThrow(RangeError);
    expect(() =>
      deriveSessionStatus(evidence, NOW, { activeWindowMs: 1, staleAfterMs: Number.NaN }),
    ).toThrow(RangeError);
    expect(() => deriveSessionStatus(evidence, new Date(Number.NaN))).toThrow(RangeError);
  });
});
