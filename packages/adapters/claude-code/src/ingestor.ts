import type {
  CandidateRoot,
  CheckpointStore,
  IngestionBatch,
  NormalizedEvent,
  RegisteredRoot,
} from '@acp/core';
import { errorCode } from './diagnostics.js';
import type { DiagnosticsCollector } from './diagnostics.js';
import { insideAnyRoot, listSources, peekFirstCwd, toCandidates } from './discovery.js';
import type { PeekResult, SourceFile } from './discovery.js';
import { FileTooLargeError, readIncrement } from './reader.js';
import { freshFileState, normalizeLine, replayLine } from './records.js';
import type { FileState } from './records.js';

export interface IngestorOptions {
  claudeDir: string;
  now: () => Date;
  maxFileBytes: number;
  chunkBytes: number;
  diagnostics: DiagnosticsCollector;
}

/** Per-file state cached between polls, valid only for the checkpoint position it was saved at. */
interface CachedState {
  fileIdentity: string;
  byteOffset: number;
  state: FileState;
}

/**
 * Discovery and polling over the allowlisted Claude Code files (docs/provider-adapters.md §4).
 * Holds only in-memory caches; the pipeline owns checkpoints.
 */
export class TranscriptIngestor {
  private readonly peeks = new Map<string, PeekResult>();
  private readonly states = new Map<string, CachedState>();

  constructor(private readonly options: IngestorOptions) {}

  async discoverCandidates(roots: readonly RegisteredRoot[]): Promise<CandidateRoot[]> {
    const d = this.options.diagnostics;
    d.beginScan();
    const sources = await listSources(this.options.claudeDir, this.options.maxFileBytes, d);
    const peeks: PeekResult[] = [];
    for (const src of sources) {
      if (src.kind !== 'transcript') continue;
      const peek = await this.peek(src);
      if (peek !== null) peeks.push(peek);
    }
    return toCandidates(peeks, roots);
  }

  async *poll(
    roots: readonly RegisteredRoot[],
    checkpoints: CheckpointStore,
  ): AsyncGenerator<IngestionBatch> {
    const d = this.options.diagnostics;
    d.beginScan();
    const sources = await listSources(this.options.claudeDir, this.options.maxFileBytes, d);
    for (const src of await this.eligible(sources, roots)) {
      try {
        if (src.kind === 'subagent-meta') continue; // subagent metadata: added with task C5
        yield* this.readTranscript(src, checkpoints);
      } catch (err) {
        if (err instanceof FileTooLargeError) {
          d.fileIssue(src.displayPath, 'size-cap', `${err.sizeBytes} > ${err.capBytes} bytes`);
        } else {
          d.fileIssue(src.displayPath, 'io-error', errorCode(err));
        }
      }
    }
  }

  /**
   * A top-level transcript is eligible when its first `cwd` is inside a registered root. Subagent
   * files are eligible when their own first `cwd` is, or when the parent transcript is: subagents
   * inherit the parent's project (docs/domain-model.md, Session) and may run in a worktree.
   */
  private async eligible(
    sources: SourceFile[],
    roots: readonly RegisteredRoot[],
  ): Promise<SourceFile[]> {
    const sessionKey = (s: SourceFile) => `${s.projectDir}/${s.sessionId}`;
    const eligibleSessions = new Set<string>();
    const eligibleAgents = new Set<string>();
    const inside = async (src: SourceFile) => {
      const cwd = (await this.peek(src))?.cwd ?? null;
      return cwd !== null && insideAnyRoot(cwd, roots);
    };
    for (const src of sources) {
      if (src.kind === 'transcript' && (await inside(src))) eligibleSessions.add(sessionKey(src));
    }
    const result: SourceFile[] = [];
    for (const src of sources) {
      const agentKey = `${sessionKey(src)}/${src.agentId ?? ''}`;
      let ok: boolean;
      if (src.kind === 'transcript') ok = eligibleSessions.has(sessionKey(src));
      else if (src.kind === 'subagent-transcript') {
        ok = eligibleSessions.has(sessionKey(src)) || (await inside(src));
        if (ok) eligibleAgents.add(agentKey);
      } else ok = eligibleSessions.has(sessionKey(src)) || eligibleAgents.has(agentKey);
      if (ok) result.push(src);
    }
    return result;
  }

  /** First-`cwd` peek, cached until the file is replaced or (while no cwd was found) grows. */
  private async peek(src: SourceFile): Promise<PeekResult | null> {
    if (src.kind === 'subagent-meta') return null;
    const cached = this.peeks.get(src.path);
    try {
      if (cached !== undefined && cached.cwd !== null) {
        // The first cwd never changes while the head is intact; the reader detects rewrites.
        return cached;
      }
      const peek = await peekFirstCwd(src.path);
      this.peeks.set(src.path, peek);
      return peek;
    } catch (err) {
      this.options.diagnostics.fileIssue(src.displayPath, 'io-error', errorCode(err));
      return null;
    }
  }

  private async *readTranscript(
    src: SourceFile,
    checkpoints: CheckpointStore,
  ): AsyncGenerator<IngestionBatch> {
    const d = this.options.diagnostics;
    const checkpoint = checkpoints.get(src.path);
    const cached = this.states.get(src.path);
    const cacheValid =
      checkpoint !== undefined &&
      cached !== undefined &&
      cached.fileIdentity === checkpoint.fileIdentity &&
      cached.byteOffset === checkpoint.byteOffset;
    let state = cacheValid ? { ...cached.state } : freshFileState();
    // Without valid cached state, rebuild it from the lines before the checkpoint (restart).
    const replayBefore = cacheValid
      ? undefined
      : (line: Parameters<typeof replayLine>[0]) => replayLine(line, state);

    let readerErrors = checkpoint?.parseErrors ?? 0;
    let schemaErrors = 0;
    for await (const batch of readIncrement(src.path, checkpoint, {
      maxFileBytes: this.options.maxFileBytes,
      chunkBytes: this.options.chunkBytes,
      ...(replayBefore !== undefined ? { replayBefore } : {}),
    })) {
      if (batch.reset) {
        state = freshFileState();
        readerErrors = 0;
        this.peeks.delete(src.path);
      }
      const ctx = {
        sessionId: src.sessionId,
        agentId: src.agentId,
        sourcePath: src.path,
        observedAt: this.options.now().toISOString(),
      };
      const events: NormalizedEvent[] = [];
      for (const line of batch.lines) {
        const result = normalizeLine(line, ctx, state);
        if (!result.ok) {
          schemaErrors += 1;
          d.parseError();
          continue;
        }
        d.record(result.version, result.unrecognized);
        events.push(...result.events);
      }
      for (let i = readerErrors; i < batch.nextCheckpoint.parseErrors; i++) d.parseError();
      readerErrors = batch.nextCheckpoint.parseErrors;

      const nextCheckpoint = {
        ...batch.nextCheckpoint,
        parseErrors: batch.nextCheckpoint.parseErrors + schemaErrors,
      };
      this.states.set(src.path, {
        fileIdentity: nextCheckpoint.fileIdentity,
        byteOffset: nextCheckpoint.byteOffset,
        state: { ...state },
      });
      yield { sourcePath: src.path, events, nextCheckpoint };
    }
  }
}
