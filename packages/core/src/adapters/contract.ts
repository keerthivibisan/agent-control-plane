import type { ProviderId } from '../domain/provider.js';
import type { IsoTimestamp } from '../domain/time.js';
import type { NormalizedEvent } from '../events/normalized-event.js';

/**
 * Internal provider adapter contract (docs/provider-adapters.md §1). This is not a provider API.
 * Phase 1 defines observation mode only; managed execution is added in Phase 3 by ADR.
 */

export interface ProviderCapabilities {
  provider: ProviderId;
  observation: {
    transcripts: boolean;
    lifecycleHooks: boolean;
    subagentRelationships: boolean;
    perTurnUsage: boolean;
    cumulativeSnapshots: boolean;
  };
  /** Always `false` in Phase 1. */
  managedExecution: false;
  /** Provider runtime versions seen in ingested records. */
  providerVersionsSeen: string[];
  /** Human-readable known gaps, shown in the UI verbatim. */
  limitations: string[];
}

/** A project root the user registered. `rootPath` is already realpath-normalized by the server. */
export interface RegisteredRoot {
  projectId: string;
  rootPath: string;
}

/** A working directory seen in provider data that is not inside any registered root. */
export interface CandidateRoot {
  provider: ProviderId;
  cwd: string;
  sessionCount: number;
  lastSeenAt: IsoTimestamp | null;
}

/** Restart-safe position within one source file (docs/domain-model.md, IngestionCheckpoint). */
export interface Checkpoint {
  sourcePath: string;
  /** `${dev}:${ino}`, used to detect file replacement. */
  fileIdentity: string;
  sizeBytes: number;
  mtimeMs: number;
  /** Offset just after the last fully consumed newline. */
  byteOffset: number;
  /** sha256 hex of the first <= 4 KiB, used to detect rewrites. */
  headHash: string;
  parseErrors: number;
}

export interface CheckpointStore {
  get(sourcePath: string): Checkpoint | undefined;
}

/** Events read from one source file, committed atomically with `nextCheckpoint` by the pipeline. */
export interface IngestionBatch {
  sourcePath: string;
  events: NormalizedEvent[];
  nextCheckpoint: Checkpoint;
}

export interface ObservationAdapter {
  readonly provider: ProviderId;
  capabilities(): Promise<ProviderCapabilities>;
  /** Peeks at the first `cwd` of each allowlisted source only; reads no content. */
  discoverCandidates(roots: readonly RegisteredRoot[]): Promise<CandidateRoot[]>;
  /** Yields batches of new complete records from allowlisted sources inside registered roots. */
  poll(
    roots: readonly RegisteredRoot[],
    checkpoints: CheckpointStore,
  ): AsyncIterable<IngestionBatch>;
  /** Normalizes one hook delivery; throws on invalid input. Returns [] for ignored hook events. */
  normalizeHook(body: unknown, receivedAt: IsoTimestamp): NormalizedEvent[];
}
