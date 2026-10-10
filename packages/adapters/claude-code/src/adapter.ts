import path from 'node:path';
import type {
  CandidateRoot,
  CheckpointStore,
  IngestionBatch,
  IsoTimestamp,
  NormalizedEvent,
  ObservationAdapter,
  ProviderCapabilities,
  RegisteredRoot,
} from '@acp/core';
import { DEFAULT_MAX_FILE_BYTES } from './allowlist.js';
import { buildCapabilities } from './capabilities.js';
import { DiagnosticsCollector } from './diagnostics.js';
import type { ClaudeCodeDiagnostics } from './diagnostics.js';
import { normalizeHook } from './hooks.js';
import { TranscriptIngestor } from './ingestor.js';
import { DEFAULT_CHUNK_BYTES } from './reader.js';

export interface ClaudeCodeAdapterOptions {
  /** The Claude data root (`$CLAUDE_CONFIG_DIR`, else `~/.claude`). Only `projects/` is read. */
  claudeDir: string;
  /** Injected clock for `observedAt`; defaults to the system clock. */
  now?: () => Date;
  /** Per-transcript size cap; larger files are skipped and reported. Default 512 MiB. */
  maxFileBytes?: number;
  /** Read chunk size. Default 1 MiB. */
  chunkBytes?: number;
}

/** The core observation contract plus the per-file diagnostics the core `Checkpoint` cannot hold. */
export interface ClaudeCodeAdapter extends ObservationAdapter {
  readonly provider: 'claude-code';
  /** File problems from the latest scan, and record counts by runtime version since creation. */
  diagnostics(): ClaudeCodeDiagnostics;
}

function positiveInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}

/**
 * Builds the Claude Code observation adapter (provider-adapters §1-§8). The adapter only reads:
 * it never writes the database, the Claude data directory, or Claude Code settings.
 */
export function createClaudeCodeAdapter(options: ClaudeCodeAdapterOptions): ClaudeCodeAdapter {
  if (typeof options.claudeDir !== 'string' || !path.isAbsolute(options.claudeDir)) {
    throw new RangeError('claudeDir must be an absolute path');
  }
  const claudeDir = path.resolve(options.claudeDir);
  const diagnostics = new DiagnosticsCollector();
  const ingestor = new TranscriptIngestor({
    claudeDir,
    now: options.now ?? (() => new Date()),
    maxFileBytes: positiveInteger('maxFileBytes', options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES),
    chunkBytes: positiveInteger('chunkBytes', options.chunkBytes ?? DEFAULT_CHUNK_BYTES),
    diagnostics,
  });

  return {
    provider: 'claude-code',
    capabilities: (): Promise<ProviderCapabilities> =>
      Promise.resolve(buildCapabilities(diagnostics.versionsSeen())),
    discoverCandidates: (roots: readonly RegisteredRoot[]): Promise<CandidateRoot[]> =>
      ingestor.discoverCandidates(roots),
    poll: (
      roots: readonly RegisteredRoot[],
      checkpoints: CheckpointStore,
    ): AsyncIterable<IngestionBatch> => ingestor.poll(roots, checkpoints),
    normalizeHook: (body: unknown, receivedAt: IsoTimestamp): NormalizedEvent[] =>
      normalizeHook(body, receivedAt, { claudeDir }),
    diagnostics: () => diagnostics.snapshot(),
  };
}
