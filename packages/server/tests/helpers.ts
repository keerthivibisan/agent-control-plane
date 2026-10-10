import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import type {
  Checkpoint,
  IngestionBatch,
  NormalizedEvent,
  ObservationAdapter,
  RegisteredRoot,
  TokenCounts,
} from '@acp/core';
import type { StreamNoticeDto } from '@acp/core/api';
import { createQueries, createRepositories, openDatabase, type AcpDatabase } from '@acp/db';
import { silentLogger } from '../src/logger.js';
import { createPipeline } from '../src/pipeline/ingest.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'acp-server-test-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export const T0 = '2026-10-10T08:00:00.000Z';
export const at = (seconds: number): string =>
  new Date(Date.parse(T0) + seconds * 1000).toISOString();

/** A temp-file database with repositories and a pipeline whose notices are collected. */
export function setupPipeline(dbPath = join(tempDir(), 'acp.sqlite')) {
  const db: AcpDatabase = openDatabase(dbPath);
  cleanups.push(() => db.close());
  const repos = createRepositories(db);
  const queries = createQueries(db);
  const notices: StreamNoticeDto[] = [];
  const pipeline = createPipeline({
    db,
    repos,
    logger: silentLogger,
    now: () => new Date(at(3600)),
    publish: (n) => notices.push(n),
  });
  return { db, dbPath, repos, queries, pipeline, notices };
}

export type TestEnvelope = {
  dedupKey: string;
  sessionId?: string | null;
  agentId?: string | null;
  occurredAt?: string | null;
  channel?: NormalizedEvent['source']['channel'];
};

export function envelope(e: TestEnvelope) {
  return {
    schemaVersion: 1 as const,
    provider: 'claude-code' as const,
    dedupKey: e.dedupKey,
    sourceEventId: null,
    providerSessionId: e.sessionId === undefined ? 'sess-1' : e.sessionId,
    providerAgentId: e.agentId ?? null,
    occurredAt: e.occurredAt === undefined ? T0 : e.occurredAt,
    observedAt: at(10),
    provenance: 'observed' as const,
    source: {
      channel: e.channel ?? ('transcript' as const),
      providerVersion: '2.1.263',
      path: null,
      byteOffset: null,
      hookEvent: null,
    },
  };
}

export const tokens = (
  input: number | null,
  output: number | null,
  cacheCreation: number | null = 0,
  cacheRead: number | null = 0,
): TokenCounts => ({ input, output, cacheCreation, cacheRead });

export function usage(
  e: TestEnvelope,
  messageId: string,
  t: TokenCounts,
  model: string | null = 'claude-test',
): NormalizedEvent {
  return {
    ...envelope(e),
    eventType: 'usage.reported',
    payload: { kind: 'per-turn', messageId, requestId: null, model, tokens: t },
  };
}

export function observed(e: TestEnvelope, cwd: string | null): NormalizedEvent {
  return {
    ...envelope(e),
    eventType: 'session.observed',
    payload: { cwd, gitBranch: null, entrypoint: null },
  };
}

export function toolCalled(e: TestEnvelope, toolUseId: string, toolName: string): NormalizedEvent {
  return {
    ...envelope(e),
    eventType: 'tool.called',
    payload: { toolUseId, toolName, messageId: null },
  };
}

export function spawned(
  e: TestEnvelope,
  p: { agentId: string; toolUseId: string | null; depth: number | null },
): NormalizedEvent {
  return {
    ...envelope(e),
    eventType: 'subagent.spawned',
    payload: {
      parentProviderSessionId: e.sessionId ?? 'sess-1',
      agentId: p.agentId,
      agentType: 'Explore',
      description: null,
      spawnToolUseId: p.toolUseId,
      spawnDepth: p.depth,
      model: null,
    },
  };
}

export function checkpoint(sourcePath: string, byteOffset = 1): Checkpoint {
  return {
    sourcePath,
    fileIdentity: '1:1',
    sizeBytes: byteOffset,
    mtimeMs: 0,
    byteOffset,
    headHash: 'h',
    parseErrors: 0,
  };
}

export function batch(
  sourcePath: string,
  events: NormalizedEvent[],
  offset?: number,
): IngestionBatch {
  return { sourcePath, events, nextCheckpoint: checkpoint(sourcePath, offset ?? events.length) };
}

/** Drains an adapter's poll into batches. */
export async function collect(
  adapter: ObservationAdapter,
  roots: readonly RegisteredRoot[],
  store: { get(path: string): Checkpoint | undefined },
): Promise<IngestionBatch[]> {
  const out: IngestionBatch[] = [];
  for await (const b of adapter.poll(roots, store)) out.push(b);
  return out;
}
