import { NORMALIZED_EVENT_SCHEMA_VERSION, NormalizedEventSchema } from '@acp/core';
import type {
  CandidateRoot,
  Checkpoint,
  CheckpointStore,
  IngestionBatch,
  IsoTimestamp,
  NormalizedEvent,
  ObservationAdapter,
  ProviderCapabilities,
  RegisteredRoot,
} from '@acp/core';
import { DEFAULT_FIXTURES_DIR, DemoFixtureError, loadDemoSources } from './fixtures.js';
import type { DemoSource } from './fixtures.js';
import { isInsidePosix } from './paths.js';

/** Fixed default base time: every fixture offset `t` is relative to it. */
export const DEMO_BASE_TIME = '2026-10-10T08:00:00.000Z';
/** Written to `source.providerVersion` and reported in `providerVersionsSeen`. */
export const DEMO_PROVIDER_VERSION = 'demo';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DemoAdapterOptions {
  /** Time that fixture offsets are relative to. Default {@link DEMO_BASE_TIME}. */
  baseTime?: string | Date;
  /**
   * Clock for `observedAt` and for releasing records: a record is emitted only once
   * `baseTime + t <= now()`, so a server passing the real clock and a recent `baseTime` sees the
   * demo sessions progress. Default: a fixed clock one day after `baseTime` (everything released).
   */
  now?: () => Date;
  /** Directory of fixture JSON files. Default: the fixtures committed in this package. */
  fixturesDir?: string;
}

/** Thrown by the demo adapter's `normalizeHook` for a body that is not a JSON object. */
export class DemoHookError extends Error {
  override readonly name = 'DemoHookError';
}

/**
 * Deterministic adapter over committed fixtures (docs/provider-adapters.md §9, ADR-0007).
 * Tests and `ACP_MODE=demo` only. Every event has `provider: "demo"` and `source.channel: "demo"`.
 *
 * Checkpoints work like the real adapter's, with one difference: `byteOffset` and `sizeBytes`
 * count fixture records, not bytes.
 */
export function createDemoAdapter(options: DemoAdapterOptions = {}): ObservationAdapter {
  const baseMs = new Date(options.baseTime ?? DEMO_BASE_TIME).getTime();
  if (Number.isNaN(baseMs)) throw new DemoFixtureError('baseTime is not a valid date');
  const now = options.now ?? (() => new Date(baseMs + DAY_MS));
  const fixturesDir = options.fixturesDir ?? DEFAULT_FIXTURES_DIR;

  let loaded: Promise<DemoSource[]> | undefined;
  const sources = (): Promise<DemoSource[]> => {
    loaded ??= loadDemoSources(fixturesDir).then((list) => {
      // Fail fast on an invalid fixture rather than in the middle of a poll.
      for (const s of list) s.records.forEach((_, i) => toEvent(s, i, DEMO_BASE_TIME));
      return list;
    });
    return loaded;
  };

  const occurredMs = (s: DemoSource, i: number): number => {
    const record = s.records[i];
    if (record === undefined) throw new DemoFixtureError(`${s.source}: no record ${i}`);
    return baseMs + record.t * 1000;
  };
  const releasedCount = (s: DemoSource, nowMs: number): number => {
    let n = 0;
    while (n < s.records.length && occurredMs(s, n) <= nowMs) n++;
    return n;
  };

  function toEvent(s: DemoSource, index: number, observedAt: IsoTimestamp): NormalizedEvent {
    const record = s.records[index];
    if (record === undefined) throw new DemoFixtureError(`${s.source}: no record ${index}`);
    const parsed = NormalizedEventSchema.safeParse({
      schemaVersion: NORMALIZED_EVENT_SCHEMA_VERSION,
      provider: 'demo',
      eventType: record.eventType,
      dedupKey: `demo:${s.providerSessionId}:${s.providerAgentId ?? 'main'}:${record.id}`,
      sourceEventId: record.id,
      providerSessionId: s.providerSessionId,
      providerAgentId: s.providerAgentId,
      occurredAt: new Date(baseMs + record.t * 1000).toISOString(),
      observedAt,
      provenance: 'observed',
      source: {
        channel: 'demo',
        providerVersion: DEMO_PROVIDER_VERSION,
        path: sourcePath(s),
        byteOffset: index,
        hookEvent: null,
      },
      payload: record.payload,
    });
    if (!parsed.success) {
      throw new DemoFixtureError(`${s.source} record ${record.id}: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  const insideAny = (cwd: string, roots: readonly RegisteredRoot[]): boolean =>
    roots.some((r) => isInsidePosix(cwd, r.rootPath));

  return {
    provider: 'demo',

    capabilities(): Promise<ProviderCapabilities> {
      return Promise.resolve({
        provider: 'demo',
        observation: {
          transcripts: true,
          lifecycleHooks: true,
          subagentRelationships: true,
          perTurnUsage: true,
          cumulativeSnapshots: true,
        },
        managedExecution: false,
        providerVersionsSeen: [DEMO_PROVIDER_VERSION],
        limitations: [
          'Demo data: sessions are replayed from deterministic fixtures, not observed from a real provider.',
        ],
      });
    },

    async discoverCandidates(roots: readonly RegisteredRoot[]): Promise<CandidateRoot[]> {
      const nowMs = now().getTime();
      const byCwd = new Map<string, { sessions: Set<string>; lastMs: number | null }>();
      for (const s of await sources()) {
        if (insideAny(s.cwd, roots)) continue;
        const entry = byCwd.get(s.cwd) ?? { sessions: new Set<string>(), lastMs: null };
        if (s.providerAgentId === null) entry.sessions.add(s.providerSessionId);
        const released = releasedCount(s, nowMs);
        if (released > 0) {
          const last = occurredMs(s, released - 1);
          entry.lastMs = entry.lastMs === null ? last : Math.max(entry.lastMs, last);
        }
        byCwd.set(s.cwd, entry);
      }
      return [...byCwd.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([cwd, e]) => ({
          provider: 'demo' as const,
          cwd,
          sessionCount: e.sessions.size,
          lastSeenAt: e.lastMs === null ? null : new Date(e.lastMs).toISOString(),
        }));
    },

    async *poll(
      roots: readonly RegisteredRoot[],
      checkpoints: CheckpointStore,
    ): AsyncIterable<IngestionBatch> {
      for (const s of await sources()) {
        if (!insideAny(s.cwd, roots)) continue;
        const current = now();
        const released = releasedCount(s, current.getTime());
        const previous = checkpoints.get(sourcePath(s));
        const valid =
          previous !== undefined &&
          previous.fileIdentity === fileIdentity(s) &&
          previous.headHash === s.contentHash &&
          previous.byteOffset <= s.records.length;
        const start = valid ? previous.byteOffset : 0;
        // Nothing new. An invalid (stale) checkpoint still gets a batch so the reset is committed.
        if (start >= released && (valid || previous === undefined)) continue;

        const observedAt = current.toISOString();
        const events: NormalizedEvent[] = [];
        for (let i = start; i < released; i++) events.push(toEvent(s, i, observedAt));
        const nextCheckpoint: Checkpoint = {
          sourcePath: sourcePath(s),
          fileIdentity: fileIdentity(s),
          sizeBytes: s.records.length,
          mtimeMs: 0,
          byteOffset: Math.max(start, released),
          headHash: s.contentHash,
          parseErrors: 0,
        };
        yield { sourcePath: sourcePath(s), events, nextCheckpoint };
      }
    },

    normalizeHook(body: unknown): NormalizedEvent[] {
      // The demo provider has no live hooks; accept any JSON object and ignore it.
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        throw new DemoHookError('hook body must be a JSON object');
      }
      return [];
    },
  };
}

function sourcePath(s: DemoSource): string {
  return `demo://${s.source}`;
}

function fileIdentity(s: DemoSource): string {
  return `demo:${s.source}`;
}
