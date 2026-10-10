import { constants } from 'node:fs';
import type { Dirent } from 'node:fs';
import { open, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { isPathInside } from '@acp/core';
import type { CandidateRoot, RegisteredRoot } from '@acp/core';
import { z } from 'zod';
import { classifyRelative, MAX_META_BYTES, SESSION_ID_RE, sameSource } from './allowlist.js';
import type { ClassifiedPath } from './allowlist.js';
import { errorCode } from './diagnostics.js';
import type { DiagnosticsCollector } from './diagnostics.js';
import { isAbsolutePathString } from './paths.js';
import { ENVELOPE_RECORD_TYPES } from './record-types.js';

/** The first-`cwd` peek reads at most this much of a transcript (§4.1). */
export const PEEK_BYTES = 64 * 1024;

/** `O_NOFOLLOW` where the platform has it: the path we open is already a realpath. */
export const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);

export interface SourceFile extends ClassifiedPath {
  /** Real path. Used as the checkpoint `sourcePath` and as event `source.path`. */
  path: string;
  /** Path relative to the Claude data root, for diagnostics only. */
  displayPath: string;
}

/**
 * Lists allowlisted source files under `<claudeDir>/projects/`. Only directories that can contain
 * allowlisted files are listed at all (`projects/`, `projects/<dir>/`, and
 * `projects/<dir>/<uuid>/subagents/`), so denied directories such as `memory/` or `tool-results/`
 * are never even enumerated. Each candidate is accepted only if its realpath stays inside
 * `projects/`, classifies as the same source before and after resolution, is a regular file, and
 * is within the size cap.
 */
export async function listSources(
  claudeDir: string,
  maxFileBytes: number,
  diagnostics: DiagnosticsCollector,
): Promise<SourceFile[]> {
  const logicalProjects = path.resolve(claudeDir, 'projects');
  let projects: string;
  try {
    projects = await realpath(logicalProjects);
  } catch (err) {
    if (errorCode(err) !== 'ENOENT') diagnostics.fileIssue('projects', 'io-error', errorCode(err));
    return [];
  }
  const display = (logical: string) => path.relative(path.resolve(claudeDir), logical);

  const candidates: string[] = [];
  for (const dir of await listDir(projects, 'projects', diagnostics)) {
    // Project directories must be real directories; a symlinked one is not traversed.
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(projects, dir.name);
    for (const entry of await listDir(dirPath, display(dirPath), diagnostics)) {
      if (isFileLike(entry) && entry.name.endsWith('.jsonl')) {
        candidates.push(path.join(dirPath, entry.name));
      } else if (entry.isDirectory() && SESSION_ID_RE.test(entry.name)) {
        const subagents = path.join(dirPath, entry.name, 'subagents');
        for (const sub of await listDir(subagents, display(subagents), diagnostics, true)) {
          if (isFileLike(sub)) candidates.push(path.join(subagents, sub.name));
        }
      }
    }
  }

  const accepted: SourceFile[] = [];
  for (const logical of candidates) {
    const logicalClass = classifyRelative(path.relative(projects, logical));
    if (logicalClass === null) continue; // not an allowlisted name: never opened
    const shown = display(path.join(logicalProjects, path.relative(projects, logical)));
    try {
      const real = await realpath(logical);
      if (!isPathInside(projects, real)) {
        diagnostics.fileIssue(shown, 'outside-projects');
        continue;
      }
      const realClass = classifyRelative(path.relative(projects, real));
      if (realClass === null || !sameSource(realClass, logicalClass)) {
        diagnostics.fileIssue(shown, 'symlink-mismatch');
        continue;
      }
      const st = await stat(real);
      if (!st.isFile()) {
        diagnostics.fileIssue(shown, 'not-regular-file');
        continue;
      }
      const cap = logicalClass.kind === 'subagent-meta' ? MAX_META_BYTES : maxFileBytes;
      if (st.size > cap) {
        diagnostics.fileIssue(shown, 'size-cap', `${st.size} > ${cap} bytes`);
        continue;
      }
      accepted.push({ ...logicalClass, path: real, displayPath: shown });
    } catch (err) {
      diagnostics.fileIssue(shown, 'io-error', errorCode(err));
    }
  }
  // Sorted, so batches come in a stable order: a transcript before its subagent files, and a
  // subagent transcript before its meta file.
  return accepted.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

async function listDir(
  dir: string,
  shown: string,
  diagnostics: DiagnosticsCollector,
  optional = false,
): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (!(optional && errorCode(err) === 'ENOENT')) {
      diagnostics.fileIssue(shown, 'io-error', errorCode(err));
    }
    return [];
  }
}

function isFileLike(entry: Dirent): boolean {
  return entry.isFile() || entry.isSymbolicLink();
}

export interface PeekResult {
  cwd: string | null;
  /** `${dev}:${ino}` of the peeked file. */
  fileIdentity: string;
  sizeBytes: number;
  mtimeMs: number;
}

/**
 * Reads at most {@link PEEK_BYTES} and returns the `cwd` of the first complete line whose record
 * type carries envelope fields. Reads no other field and copies no content.
 */
export async function peekFirstCwd(file: string): Promise<PeekResult> {
  const fh = await open(file, OPEN_FLAGS);
  try {
    const st = await fh.stat();
    const length = Math.min(PEEK_BYTES, st.size);
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, 0);
    const head = buf.subarray(0, bytesRead);
    const end = head.lastIndexOf(0x0a);
    let cwd: string | null = null;
    if (end !== -1) {
      for (const line of head.subarray(0, end).toString('utf8').split('\n')) {
        cwd = cwdOf(line);
        if (cwd !== null) break;
      }
    }
    return { cwd, fileIdentity: `${st.dev}:${st.ino}`, sizeBytes: st.size, mtimeMs: st.mtimeMs };
  } finally {
    await fh.close();
  }
}

const RecordTypeSchema = z.looseObject({ type: z.string() });
const EnvelopeCwdSchema = z.looseObject({ cwd: z.string() });

function cwdOf(line: string): string | null {
  if (line.trim() === '') return null;
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return null;
  }
  // Check the type first: fields of non-envelope records (e.g. `bridge-session`) are never read.
  const typed = RecordTypeSchema.safeParse(record);
  if (!typed.success || !ENVELOPE_RECORD_TYPES.has(typed.data.type)) return null;
  const envelope = EnvelopeCwdSchema.safeParse(record);
  return envelope.success && isAbsolutePathString(envelope.data.cwd) ? envelope.data.cwd : null;
}

/** True when `cwd` is inside any registered root (segment-wise). */
export function insideAnyRoot(cwd: string, roots: readonly RegisteredRoot[]): boolean {
  return roots.some((r) => isPathInside(r.rootPath, cwd));
}

/** Groups first `cwd`s that are outside every registered root into candidate roots. */
export function toCandidates(
  peeks: ReadonlyArray<{ cwd: string | null; mtimeMs: number }>,
  roots: readonly RegisteredRoot[],
): CandidateRoot[] {
  const byCwd = new Map<string, { count: number; lastMs: number }>();
  for (const p of peeks) {
    if (p.cwd === null || insideAnyRoot(p.cwd, roots)) continue;
    const entry = byCwd.get(p.cwd) ?? { count: 0, lastMs: 0 };
    entry.count += 1;
    entry.lastMs = Math.max(entry.lastMs, p.mtimeMs);
    byCwd.set(p.cwd, entry);
  }
  return [...byCwd.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([cwd, e]) => ({
      provider: 'claude-code' as const,
      cwd,
      sessionCount: e.count,
      // File modification time: the last time the provider wrote to any of these sessions.
      lastSeenAt: e.lastMs > 0 ? new Date(e.lastMs).toISOString() : null,
    }));
}
