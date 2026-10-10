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

/** A source file the adapter could not (fully) read. Paths are relative to the provider data root. */
export interface AdapterFileIssue {
  path: string;
  /** Short machine reason, e.g. `size-cap`, `invalid-meta`, `outside-projects`. */
  reason: string;
  /** Error code or a short fixed explanation. Never file content. */
  detail: string | null;
}

/**
 * What the adapter knows about its own reading that `Checkpoint` cannot hold (coordinator decision
 * 2026-10-10: `diagnostics()` on the adapter rather than an error field on checkpoints).
 * Counts are since the adapter was created; file issues are from the most recent scan.
 */
export interface AdapterDiagnostics {
  fileIssues: AdapterFileIssue[];
  /**
   * Records of types the adapter knows and deliberately skips because they carry nothing the
   * control plane uses, by record type. Unknown types are `record.unrecognized` events instead.
   */
  ignoredRecords: Record<string, number>;
  /** Unparseable or schema-invalid complete lines skipped. */
  parseErrors: number;
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
  diagnostics(): AdapterDiagnostics;
}
