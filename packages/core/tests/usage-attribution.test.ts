import { describe, expect, it } from 'vitest';
import {
  attributeUsage,
  buildUsageRecord,
  sessionKeysEqual,
  sessionKeyToString,
  SYNTHETIC_MODEL,
  UsageObservationGroupError,
} from '../src/index.js';
import { at, key, obs, tokens } from './helpers/builders.js';

describe('attributeUsage (usage-accounting §5.2, A2)', () => {
  it('attributes a fork copy to the original session that saw the message first', () => {
    const original = obs({ eventId: 9, session: key('sess-original'), occurredAt: at(1) });
    // The fork file is ingested first (lower event id) but carries the copied, later-or-equal time.
    const forkCopy = obs({ eventId: 1, session: key('sess-fork'), occurredAt: at(4) });
    expect(attributeUsage([forkCopy, original])).toEqual(key('sess-original'));
  });

  it('sorts null timestamps last', () => {
    const undated = obs({ eventId: 1, session: key('sess-a'), occurredAt: null });
    const dated = obs({ eventId: 2, session: key('sess-z'), occurredAt: at(59) });
    expect(attributeUsage([undated, dated])).toEqual(key('sess-z'));
  });

  it('falls back to the lexical session key when every timestamp is null', () => {
    const b = obs({ eventId: 1, session: key('sess-b'), occurredAt: null });
    const a = obs({ eventId: 2, session: key('sess-a'), occurredAt: null });
    expect(attributeUsage([b, a])).toEqual(key('sess-a'));
  });

  it('breaks a timestamp tie by lexical canonical session key, not by ingestion order', () => {
    const b = obs({ eventId: 1, session: key('sess-b'), occurredAt: at(3) });
    const a = obs({ eventId: 2, session: key('sess-a'), occurredAt: at(3) });
    expect(attributeUsage([b, a])).toEqual(key('sess-a'));
    expect(attributeUsage([a, b])).toEqual(key('sess-a'));
  });

  it('distinguishes a subagent from its top-level session in the tie-break', () => {
    const sub = obs({ eventId: 1, session: key('sess-a', 'agent1'), occurredAt: at(3) });
    const top = obs({ eventId: 2, session: key('sess-a'), occurredAt: at(3) });
    // '["claude-code","sess-a","agent1"]' < '["claude-code","sess-a",null]' because '"' < 'n'.
    expect(attributeUsage([top, sub])).toEqual(key('sess-a', 'agent1'));
  });

  it('ignores synthetic observations and returns null when nothing else remains', () => {
    const synthetic = obs({ eventId: 1, session: key('sess-a'), model: SYNTHETIC_MODEL });
    const real = obs({ eventId: 2, session: key('sess-b'), occurredAt: at(9) });
    expect(attributeUsage([synthetic, real])).toEqual(key('sess-b'));
    expect(attributeUsage([synthetic])).toBeNull();
    expect(attributeUsage([])).toBeNull();
  });

  it('rejects observations from different messages', () => {
    expect(() =>
      attributeUsage([obs({ eventId: 1 }), obs({ eventId: 2, messageId: 'msg_other' })]),
    ).toThrow(UsageObservationGroupError);
  });
});

describe('sessionKeyToString', () => {
  it('is injective even when ids contain separator characters', () => {
    const a = key('a:b', 'c');
    const b = key('a', 'b:c');
    expect(sessionKeyToString(a)).not.toBe(sessionKeyToString(b));
    expect(sessionKeyToString(key('s', null))).not.toBe(sessionKeyToString(key('s', 'null')));
  });

  it('is stable for equal keys', () => {
    expect(sessionKeyToString(key('s', 'x'))).toBe(sessionKeyToString({ ...key('s', 'x') }));
    expect(sessionKeysEqual(key('s', 'x'), key('s', 'x'))).toBe(true);
    expect(sessionKeysEqual(key('s', 'x'), key('s', null))).toBe(false);
  });
});

describe('buildUsageRecord', () => {
  it('combines selection and attribution, which may come from different observations', () => {
    const record = buildUsageRecord([
      obs({ eventId: 1, session: key('sess-original'), occurredAt: at(1), tokens: tokens(5) }),
      obs({ eventId: 2, session: key('sess-fork'), occurredAt: at(8), tokens: tokens(80) }),
    ]);
    expect(record?.selectedEventId).toBe(2);
    expect(record?.tokens.output).toBe(80);
    expect(record?.session).toEqual(key('sess-original'));
  });

  it('creates no record for a synthetic-only message', () => {
    expect(buildUsageRecord([obs({ eventId: 1, model: SYNTHETIC_MODEL })])).toBeNull();
  });
});
