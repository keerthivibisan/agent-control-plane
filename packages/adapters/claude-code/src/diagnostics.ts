import type { AdapterDiagnostics } from '@acp/core';

/**
 * Per-file problems and record counts (docs/provider-adapters.md §8). The core `Checkpoint` has no
 * error field, so file-level errors are surfaced here instead; the server exposes them in its
 * diagnostics endpoint. Paths are relative to the Claude data root, never absolute (security §2.5).
 */
export type FileIssueReason =
  /** realpath leaves `<claudeDir>/projects/` (symlink escape). */
  | 'outside-projects'
  /** A symlink inside `projects/` points at a file that is not the same allowlisted source. */
  | 'symlink-mismatch'
  | 'not-regular-file'
  /** Larger than the configured cap; skipped entirely. */
  | 'size-cap'
  | 'io-error'
  /** Subagent meta file that is not a JSON object. */
  | 'invalid-meta';

export interface FileIssue {
  path: string;
  reason: FileIssueReason;
  /** Error code or a short fixed explanation. Never file content. */
  detail: string | null;
}

export interface VersionRecordCounts {
  total: number;
  unrecognized: number;
}

/** The core `AdapterDiagnostics` (ADR-0011) plus per-version record counts. */
export interface ClaudeCodeDiagnostics extends AdapterDiagnostics {
  /**
   * Records of known types skipped on purpose, by record type, since the adapter was created (core
   * `AdapterDiagnostics.ignoredRecords`). They are also counted in `recordsByVersion.total`.
   */
  ignoredRecords: Record<string, number>;
  /** Problems found by the most recent poll or discovery scan. */
  fileIssues: FileIssue[];
  /** Records read since the adapter was created, by provider runtime version (`unknown` if none). */
  recordsByVersion: Record<string, VersionRecordCounts>;
  /** Unparseable or schema-invalid complete lines skipped since the adapter was created. */
  parseErrors: number;
}

export class DiagnosticsCollector {
  private issues = new Map<string, FileIssue>();
  private readonly versions = new Map<string, VersionRecordCounts>();
  private readonly ignored = new Map<string, number>();
  private parseErrorCount = 0;

  /** Starts a new scan; issues from the previous scan are dropped. */
  beginScan(): void {
    this.issues = new Map();
  }

  fileIssue(path: string, reason: FileIssueReason, detail: string | null = null): void {
    this.issues.set(path, { path, reason, detail });
  }

  record(version: string | null, unrecognized: boolean): void {
    const key = version ?? 'unknown';
    const counts = this.versions.get(key) ?? { total: 0, unrecognized: 0 };
    counts.total += 1;
    if (unrecognized) counts.unrecognized += 1;
    this.versions.set(key, counts);
  }

  /** A record of a known, deliberately ignored type (record-types.ts `IGNORED_RECORD_TYPES`). */
  ignoredRecord(recordType: string): void {
    this.ignored.set(recordType, (this.ignored.get(recordType) ?? 0) + 1);
  }

  parseError(): void {
    this.parseErrorCount += 1;
  }

  versionsSeen(): string[] {
    return [...this.versions.keys()].filter((v) => v !== 'unknown').sort();
  }

  snapshot(): ClaudeCodeDiagnostics {
    return {
      fileIssues: [...this.issues.values()].sort((a, b) => (a.path < b.path ? -1 : 1)),
      recordsByVersion: Object.fromEntries(
        [...this.versions.entries()]
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([k, v]) => [k, { ...v }]),
      ),
      parseErrors: this.parseErrorCount,
      ignoredRecords: Object.fromEntries(
        [...this.ignored.entries()].sort(([a], [b]) => (a < b ? -1 : 1)),
      ),
    };
  }
}

/** The error code of a Node system error (e.g. `EACCES`), or a fixed fallback. */
export function errorCode(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string') {
    return err.code;
  }
  return 'error';
}
