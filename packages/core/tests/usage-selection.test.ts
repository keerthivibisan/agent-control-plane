import { describe, expect, it } from 'vitest';
import {
  groupObservationsByMessage,
  selectUsage,
  SYNTHETIC_MODEL,
  UsageObservationGroupError,
} from '../src/index.js';
import { at, key, obs, tokens } from './helpers/builders.js';

describe('selectUsage (usage-accounting §5.1, A1)', () => {
  it('scenario 1: duplicate lines with growing output give one record with max output', () => {
    const selection = selectUsage([
      obs({ eventId: 1, occurredAt: at(0), tokens: tokens(1) }),
      obs({ eventId: 2, occurredAt: at(1), tokens: tokens(57) }),
      obs({ eventId: 3, occurredAt: at(2), tokens: tokens(412) }),
    ]);
    expect(selection).toEqual({
      provider: 'claude-code',
      messageId: 'msg_1',
      selectedEventId: 3,
      requestId: 'req_1',
      model: 'model-a',
      tokens: tokens(412),
      observationCount: 3,
      conflict: false,
    });
  });

  it('takes every category from the one selected observation, never mixing lines', () => {
    const selection = selectUsage([
      obs({ eventId: 1, tokens: { input: 5, output: 10, cacheCreation: null, cacheRead: 7 } }),
      obs({ eventId: 2, tokens: { input: null, output: 20, cacheCreation: 9, cacheRead: null } }),
    ]);
    expect(selection?.tokens).toEqual({
      input: null,
      output: 20,
      cacheCreation: 9,
      cacheRead: null,
    });
    expect(selection?.selectedEventId).toBe(2);
  });

  it('breaks equal outputs by earliest occurredAt, then by lowest event id', () => {
    const later = obs({ eventId: 1, occurredAt: at(5), tokens: tokens(50) });
    const earlier = obs({ eventId: 9, occurredAt: at(1), tokens: tokens(50) });
    expect(selectUsage([later, earlier])?.selectedEventId).toBe(9);

    const sameTimeA = obs({ eventId: 4, occurredAt: at(1), tokens: tokens(50) });
    const sameTimeB = obs({ eventId: 2, occurredAt: at(1), tokens: tokens(50) });
    expect(selectUsage([sameTimeA, sameTimeB])?.selectedEventId).toBe(2);
  });

  it('compares timestamps as instants, not strings', () => {
    // Same instant written with and without milliseconds: event id decides, not the string form.
    const withMs = obs({ eventId: 7, occurredAt: '2026-10-10T08:00:00.000Z', tokens: tokens(5) });
    const withoutMs = obs({ eventId: 3, occurredAt: '2026-10-10T08:00:00Z', tokens: tokens(5) });
    expect(selectUsage([withMs, withoutMs])?.selectedEventId).toBe(3);
  });

  it('sorts a null occurredAt after any known time on an output tie', () => {
    const undated = obs({ eventId: 1, occurredAt: null, tokens: tokens(50) });
    const dated = obs({ eventId: 2, occurredAt: at(30), tokens: tokens(50) });
    expect(selectUsage([undated, dated])?.selectedEventId).toBe(2);
  });

  it('ranks a null output below any reported output, including 0', () => {
    const selection = selectUsage([
      obs({ eventId: 1, tokens: tokens(null) }),
      obs({ eventId: 2, tokens: tokens(0) }),
    ]);
    expect(selection?.selectedEventId).toBe(2);
    expect(selection?.tokens.output).toBe(0);
  });

  it('keeps output null (unavailable) when every observation lacks it', () => {
    const selection = selectUsage([
      obs({ eventId: 2, occurredAt: at(2), tokens: tokens(null) }),
      obs({ eventId: 1, occurredAt: at(1), tokens: tokens(null) }),
    ]);
    expect(selection?.tokens.output).toBeNull();
    expect(selection?.selectedEventId).toBe(1);
  });

  it('flags conflicting cache counts but keeps the selected values', () => {
    const selection = selectUsage([
      obs({ eventId: 1, tokens: tokens(10, { cacheRead: 20_000 }) }),
      obs({ eventId: 2, tokens: tokens(30, { cacheRead: 19_500 }) }),
    ]);
    expect(selection?.conflict).toBe(true);
    expect(selection?.tokens.cacheRead).toBe(19_500);
  });

  it('does not treat a missing (null) category as a conflict', () => {
    const selection = selectUsage([
      obs({ eventId: 1, tokens: tokens(10, { cacheCreation: null }) }),
      obs({ eventId: 2, tokens: tokens(30, { cacheCreation: 500 }) }),
    ]);
    expect(selection?.conflict).toBe(false);
  });

  it('does not treat growing output as a conflict', () => {
    const selection = selectUsage([
      obs({ eventId: 1, tokens: tokens(10) }),
      obs({ eventId: 2, tokens: tokens(30) }),
    ]);
    expect(selection?.conflict).toBe(false);
  });

  it('excludes the <synthetic> model and returns null when only synthetic observations exist', () => {
    expect(selectUsage([obs({ eventId: 1, model: SYNTHETIC_MODEL, tokens: tokens(0) })])).toBe(
      null,
    );
    const selection = selectUsage([
      obs({ eventId: 1, model: SYNTHETIC_MODEL, tokens: tokens(999) }),
      obs({ eventId: 2, model: 'model-a', tokens: tokens(5) }),
    ]);
    expect(selection?.selectedEventId).toBe(2);
    expect(selection?.observationCount).toBe(1);
  });

  it('returns null for no observations', () => {
    expect(selectUsage([])).toBeNull();
  });

  it('rejects observations from different messages', () => {
    expect(() =>
      selectUsage([obs({ eventId: 1 }), obs({ eventId: 2, messageId: 'msg_2' })]),
    ).toThrow(UsageObservationGroupError);
  });

  it('treats the same message id from different providers as different messages', () => {
    const demo = obs({ eventId: 2, session: { ...key('sess-a'), provider: 'demo' } });
    expect(() => selectUsage([obs({ eventId: 1 }), demo])).toThrow(UsageObservationGroupError);
  });
});

describe('groupObservationsByMessage', () => {
  it('groups by (provider, messageId) across sessions', () => {
    const groups = groupObservationsByMessage([
      obs({ eventId: 1, messageId: 'msg_1', session: key('sess-a') }),
      obs({ eventId: 2, messageId: 'msg_1', session: key('sess-b') }),
      obs({ eventId: 3, messageId: 'msg_2', session: key('sess-a') }),
    ]);
    expect([...groups.values()].map((g) => g.map((o) => o.eventId))).toEqual([[1, 2], [3]]);
  });
});
