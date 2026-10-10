// Synthetic test data. Ids and paths are fake; nothing here comes from real provider data.
import { join } from 'node:path';
import type { EventOf, SessionKey, TokenCounts } from '@acp/core';
import { afterEach } from 'vitest';
import {
  createRepositories,
  openDatabase,
  type AcpDatabase,
  type Repositories,
  type SessionUpsertInput,
} from '../src/index.js';
import { fixedClock, tempDir } from './helpers.js';

export interface TestStore {
  db: AcpDatabase;
  repos: Repositories;
}

const open: AcpDatabase[] = [];
afterEach(() => {
  for (const db of open.splice(0)) db.close();
});

/** A migrated temp-file database with repositories, closed after the test. */
export function setupStore(): TestStore {
  const db = openDatabase(join(tempDir(), 'acp.sqlite'));
  open.push(db);
  let n = 0;
  const repos = createRepositories(db, {
    now: fixedClock('2026-10-10T12:00:00.000Z'),
    // Deterministic, sortable ids keep assertions readable.
    newId: () => `id-${String(++n).padStart(4, '0')}`,
  });
  return { db, repos };
}

export const T0 = '2026-10-10T08:00:00.000Z';

/** `T0` plus `minutes`. */
export function at(minutes: number): string {
  return new Date(Date.parse(T0) + minutes * 60_000).toISOString();
}

export function key(providerSessionId: string, providerAgentId: string | null = null): SessionKey {
  return { provider: 'claude-code', providerSessionId, providerAgentId };
}

export function sessionInput(
  k: SessionKey,
  overrides: Partial<SessionUpsertInput> = {},
): SessionUpsertInput {
  return { key: k, origin: 'external', firstSeenAt: T0, lastObservedAt: T0, ...overrides };
}

const source = {
  channel: 'transcript',
  providerVersion: '2.1.263',
  path: '/home/user/.claude/projects/-home-user-project/sess-1.jsonl',
  byteOffset: 0,
  hookEvent: null,
} as const;

function envelope(dedupKey: string, k: SessionKey, occurredAt: string | null) {
  return {
    schemaVersion: 1 as const,
    provider: k.provider,
    dedupKey,
    sourceEventId: null,
    providerSessionId: k.providerSessionId,
    providerAgentId: k.providerAgentId,
    occurredAt,
    observedAt: '2026-10-10T09:00:00.000Z',
    provenance: 'observed' as const,
    source,
  };
}

export function usageEvent(
  dedupKey: string,
  k: SessionKey,
  messageId: string,
  tokens: TokenCounts,
  occurredAt: string | null = T0,
  model: string | null = 'claude-opus-4-1',
): EventOf<'usage.reported'> {
  return {
    ...envelope(dedupKey, k, occurredAt),
    eventType: 'usage.reported',
    payload: { kind: 'per-turn', messageId, requestId: null, model, tokens },
  };
}

export function endedEvent(
  dedupKey: string,
  k: SessionKey,
  occurredAt: string | null = T0,
): EventOf<'session.ended'> {
  return {
    ...envelope(dedupKey, k, occurredAt),
    eventType: 'session.ended',
    payload: { reason: 'prompt_input_exit' },
  };
}

export function snapshotEvent(
  dedupKey: string,
  k: SessionKey,
  occurredAt: string | null,
  cost: number | null,
): EventOf<'usage.snapshot'> {
  return {
    ...envelope(dedupKey, k, occurredAt),
    eventType: 'usage.snapshot',
    payload: {
      kind: 'cumulative-snapshot',
      scope: 'unknown',
      byModel: { 'claude-opus-4-1': { input: 10, output: 20, cacheCreation: null, cacheRead: 5 } },
      reportedCostUsd: cost,
    },
  };
}

export const tokens = (
  input: number | null,
  output: number | null,
  cacheCreation: number | null = null,
  cacheRead: number | null = null,
): TokenCounts => ({ input, output, cacheCreation, cacheRead });
