import { describe, expect, it } from 'vitest';
import {
  attributeUsage,
  buildUsageRecord,
  directUsageBySession,
  sessionKeysEqual,
  sessionKeyToString,
  SYNTHETIC_MODEL,
  UsageObservationGroupError,
} from '../src/index.js';
import { at, key, obs, tokens } from './helpers/builders.js';

const clear = (session: ReturnType<typeof key>) => ({ session, ambiguous: false });
const tied = (session: ReturnType<typeof key>) => ({ session, ambiguous: true });

describe('attributeUsage (usage-accounting §5.2, A2)', () => {
  it('attributes a strictly later fork copy to the original session, unambiguously', () => {
    const original = obs({ eventId: 9, session: key('sess-original'), occurredAt: at(1) });
    // The fork file is ingested first (lower event id) but carries a later time.
    const forkCopy = obs({ eventId: 1, session: key('sess-fork'), occurredAt: at(4) });
    expect(attributeUsage([forkCopy, original])).toEqual(clear(key('sess-original')));
  });

  it('sorts null timestamps last', () => {
    const undated = obs({ eventId: 1, session: key('sess-a'), occurredAt: null });
    const dated = obs({ eventId: 2, session: key('sess-z'), occurredAt: at(59) });
    expect(attributeUsage([undated, dated])).toEqual(clear(key('sess-z')));
  });

  it('falls back to the lexical session key when every timestamp is null, flagged ambiguous', () => {
    const b = obs({ eventId: 1, session: key('sess-b'), occurredAt: null });
    const a = obs({ eventId: 2, session: key('sess-a'), occurredAt: null });
    expect(attributeUsage([b, a])).toEqual(tied(key('sess-a')));
  });

  it('breaks a timestamp tie by lexical canonical session key, not by ingestion order', () => {
    const b = obs({ eventId: 1, session: key('sess-b'), occurredAt: at(3) });
    const a = obs({ eventId: 2, session: key('sess-a'), occurredAt: at(3) });
    expect(attributeUsage([b, a])).toEqual(tied(key('sess-a')));
    expect(attributeUsage([a, b])).toEqual(tied(key('sess-a')));
  });

  it('distinguishes a subagent from its top-level session in the tie-break', () => {
    const sub = obs({ eventId: 1, session: key('sess-a', 'agent1'), occurredAt: at(3) });
    const top = obs({ eventId: 2, session: key('sess-a'), occurredAt: at(3) });
    // '["claude-code","sess-a","agent1"]' < '["claude-code","sess-a",null]' because '"' < 'n'.
    expect(attributeUsage([top, sub])).toEqual(tied(key('sess-a', 'agent1')));
  });

  it('ignores synthetic observations and returns null when nothing else remains', () => {
    const synthetic = obs({ eventId: 1, session: key('sess-a'), model: SYNTHETIC_MODEL });
    const real = obs({ eventId: 2, session: key('sess-b'), occurredAt: at(9) });
    expect(attributeUsage([synthetic, real])).toEqual(clear(key('sess-b')));
    expect(attributeUsage([synthetic])).toBeNull();
    expect(attributeUsage([])).toBeNull();
  });

  it('rejects observations from different messages', () => {
    expect(() =>
      attributeUsage([obs({ eventId: 1 }), obs({ eventId: 2, messageId: 'msg_other' })]),
    ).toThrow(UsageObservationGroupError);
  });
});

describe('attribution ambiguity (usage-accounting §5.2 tie amendment, A9)', () => {
  it('fork copy with the identical timestamp: ambiguous, deterministic, counted once', () => {
    // Fork copies keep the original line's timestamp (1,715 of 1,715 locally).
    const group = [
      obs({ eventId: 1, session: key('sess-original'), occurredAt: at(2), tokens: tokens(5) }),
      obs({ eventId: 2, session: key('sess-original'), occurredAt: at(2), tokens: tokens(40) }),
      obs({ eventId: 7, session: key('sess-fork'), occurredAt: at(2), tokens: tokens(40) }),
    ];
    const record = buildUsageRecord(group);
    expect(record?.attributionAmbiguous).toBe(true);
    // Lexical tie-break: '…"sess-fork"…' < '…"sess-original"…'.
    expect(record?.session).toEqual(key('sess-fork'));
    expect(buildUsageRecord([...group].reverse())).toEqual(record);

    const direct = directUsageBySession(record === null ? [] : [record]);
    expect(direct.size).toBe(1);
    expect([...direct.values()][0]?.tokens.output).toBe(40);
  });

  it('a later sighting in another session does not make an earliest-time tie go away', () => {
    expect(
      attributeUsage([
        obs({ eventId: 1, session: key('sess-a'), occurredAt: at(2) }),
        obs({ eventId: 2, session: key('sess-b'), occurredAt: at(2) }),
        obs({ eventId: 3, session: key('sess-c'), occurredAt: at(9) }),
      ]),
    ).toEqual(tied(key('sess-a')));
  });

  it('a tie on a later time does not matter when one session is strictly earliest', () => {
    for (const order of [
      [1, 2, 3],
      [3, 2, 1],
      [2, 3, 1],
    ]) {
      const all = [
        obs({ eventId: 1, session: key('sess-z'), occurredAt: at(1) }),
        obs({ eventId: 2, session: key('sess-a'), occurredAt: at(5) }),
        obs({ eventId: 3, session: key('sess-b'), occurredAt: at(5) }),
      ];
      const shuffled = order.map((id) => all[id - 1]).filter((o) => o !== undefined);
      expect(attributeUsage(shuffled)).toEqual(clear(key('sess-z')));
    }
  });

  it('same-session ties (streaming lines) are not ambiguous', () => {
    expect(
      attributeUsage([
        obs({ eventId: 1, session: key('sess-a'), occurredAt: at(2) }),
        obs({ eventId: 2, session: key('sess-a'), occurredAt: at(2) }),
      ]),
    ).toEqual(clear(key('sess-a')));
    expect(attributeUsage([obs({ eventId: 1, session: key('sess-a'), occurredAt: null })])).toEqual(
      clear(key('sess-a')),
    );
  });

  it('compares instants, so differently formatted equal times still tie', () => {
    expect(
      attributeUsage([
        obs({ eventId: 1, session: key('sess-b'), occurredAt: '2026-10-10T08:00:00.000Z' }),
        obs({ eventId: 2, session: key('sess-a'), occurredAt: '2026-10-10T08:00:00Z' }),
      ]),
    ).toEqual(tied(key('sess-a')));
  });

  it('ignores synthetic observations when deciding ambiguity', () => {
    expect(
      attributeUsage([
        obs({ eventId: 1, session: key('sess-a'), occurredAt: at(2), model: SYNTHETIC_MODEL }),
        obs({ eventId: 2, session: key('sess-b'), occurredAt: at(2) }),
      ]),
    ).toEqual(clear(key('sess-b')));
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
    expect(record?.attributionAmbiguous).toBe(false);
  });

  it('creates no record for a synthetic-only message', () => {
    expect(buildUsageRecord([obs({ eventId: 1, model: SYNTHETIC_MODEL })])).toBeNull();
  });
});
