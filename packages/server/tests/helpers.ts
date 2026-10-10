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
import { createLogger, silentLogger, type Logger } from '../src/logger.js';
import { createNotifier } from '../src/notifier.js';
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
export function setupPipeline(
  dbPath = join(tempDir(), 'acp.sqlite'),
  logger: Logger = silentLogger,
) {
  const db: AcpDatabase = openDatabase(dbPath);
  cleanups.push(() => db.close());
  const repos = createRepositories(db);
  const queries = createQueries(db);
  const notices: StreamNoticeDto[] = [];
  const notifier = createNotifier();
  const publish = (n: StreamNoticeDto) => {
    notices.push(n);
    notifier.publish(n);
  };
  const pipeline = createPipeline({
    db,
    repos,
    logger,
    now: () => new Date(at(3600)),
    publish,
  });
  return { db, dbPath, repos, queries, pipeline, notices, notifier, publish };
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

export const API_NOW = new Date('2026-10-10T08:05:00.000Z');

/** A real `createLogger` whose JSON lines are kept in memory, so tests can assert what was logged. */
export function captureLogger() {
  const lines: string[] = [];
  const logger = createLogger(
    (line) => lines.push(line),
    () => API_NOW,
  );
  const records = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  return { logger, lines, records };
}

/** The full app over a temp database, with the demo adapter available but nothing ingested yet. */
export async function setupApp(
  options: {
    ingestDemo?: boolean;
    normalizeRoot?: (p: string) => Promise<string>;
    hookAdapter?: ObservationAdapter;
    /** Extra adapters reported by the services (diagnostics, capabilities) and polled. */
    extraAdapters?: ObservationAdapter[];
    /** Used by the pipeline, scheduler, error handler and hook receiver. */
    logger?: Logger;
  } = {},
) {
  const logger = options.logger ?? silentLogger;
  const { createApp } = await import('../src/app.js');
  const { loadConfig } = await import('../src/config.js');
  const { createServices } = await import('../src/services/index.js');
  const { createScheduler } = await import('../src/scheduler.js');
  const { createDemoAdapter } = await import('@acp/adapter-demo');

  const base = setupPipeline(undefined, logger);
  const config = loadConfig(
    { ACP_MODE: 'demo', ACP_DATA_DIR: tempDir() },
    { homeDir: '/home/tester' },
  );
  const adapter = createDemoAdapter();
  const adapters = [adapter, ...(options.extraAdapters ?? [])];
  const polls: number[] = [];
  const hookState = { receivedAny: false };
  // Never started: tests drive it with pollNow() when they need its counters.
  const scheduler = createScheduler({
    adapters,
    repos: base.repos,
    pipeline: base.pipeline,
    logger,
    now: () => API_NOW,
    intervalMs: 60_000,
  });
  const services = createServices({
    db: base.db,
    repos: base.repos,
    queries: base.queries,
    adapters,
    ingestionStats: () => ({ pipeline: base.pipeline.counters(), scheduler: scheduler.stats() }),
    now: () => API_NOW,
    thresholds: config.statusThresholds,
    mode: 'demo',
    version: '0.0.0',
    hookReceiverUrl: `http://127.0.0.1:${config.port}/api/hooks/claude-code`,
    hookState,
    claudeDir: config.claudeDir,
    normalizeRoot: options.normalizeRoot ?? ((p) => Promise.resolve(p)),
    publish: base.publish,
    requestPoll: () => void polls.push(1),
  });
  const notifier = base.notifier;
  const hookToken = 'a'.repeat(64);
  const hookAdapter = options.hookAdapter;
  const app = createApp({
    config,
    logger,
    services,
    stream: { repos: base.repos, notifier, heartbeatMs: 20 },
    hooks: {
      token: hookToken,
      adapter: hookAdapter,
      pipeline: base.pipeline,
      hookState,
      requestPoll: () => void polls.push(1),
      logger,
      now: () => API_NOW,
    },
  });

  if (options.ingestDemo !== false) {
    base.repos.projects.insert({ name: 'demo-api', rootPath: '/home/user/demo-api' });
    base.repos.projects.insert({ name: 'demo-web', rootPath: '/home/user/demo-web' });
    const roots = base.repos.projects
      .list()
      .map((p) => ({ projectId: p.id, rootPath: p.rootPath }));
    for (const b of await collect(adapter, roots, base.repos.checkpoints))
      base.pipeline.ingestBatch(b);
    base.notices.length = 0;
  }
  return { ...base, app, config, adapter, polls, hookState, services, hookToken, scheduler };
}
