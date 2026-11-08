import { describe, expect, it } from 'vitest';
import {
  AgentMessageMetaDtoSchema,
  MAX_OUTBOX_ENTRIES,
  RunDetailDtoSchema,
} from '../src/api/index.js';

/** ADR-0033 §7: the outbox is metadata only; the schema has no place for the text. */
const entry = {
  id: 'm-1',
  from: 'engine',
  to: 'lead-1',
  kind: 'notice',
  state: 'held',
  createdAt: '2026-11-07T10:00:00.000Z',
  deliveredAt: null,
  length: 42,
  sha256: 'a'.repeat(64),
} as const;

describe('AgentMessageMetaDtoSchema', () => {
  it('holds exactly the metadata fields', () => {
    expect(Object.keys(AgentMessageMetaDtoSchema.shape).sort()).toEqual(
      ['createdAt', 'deliveredAt', 'from', 'id', 'kind', 'length', 'sha256', 'state', 'to'].sort(),
    );
    expect(AgentMessageMetaDtoSchema.safeParse(entry).success).toBe(true);
  });

  it('refuses a text field, a bad hash and unknown kinds or states', () => {
    expect(AgentMessageMetaDtoSchema.safeParse({ ...entry, text: 'hello' }).success).toBe(false);
    expect(AgentMessageMetaDtoSchema.safeParse({ ...entry, sha256: 'A'.repeat(64) }).success).toBe(
      false,
    );
    expect(AgentMessageMetaDtoSchema.safeParse({ ...entry, kind: 'chat' }).success).toBe(false);
    expect(AgentMessageMetaDtoSchema.safeParse({ ...entry, state: 'sent' }).success).toBe(false);
  });

  it('the run detail carries at most MAX_OUTBOX_ENTRIES, optionally', () => {
    const outbox = RunDetailDtoSchema.shape.outbox;
    expect(outbox.safeParse(undefined).success).toBe(true);
    expect(outbox.safeParse(Array.from({ length: MAX_OUTBOX_ENTRIES }, () => entry)).success).toBe(
      true,
    );
    expect(
      outbox.safeParse(Array.from({ length: MAX_OUTBOX_ENTRIES + 1 }, () => entry)).success,
    ).toBe(false);
  });
});
