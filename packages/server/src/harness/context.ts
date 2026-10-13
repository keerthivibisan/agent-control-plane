import { lstat, open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  MAX_CONTEXT_BYTES,
  MAX_CONTEXT_FILES,
  RepoRelativePathSchema,
  type HarnessManifest,
} from '@acp/core';
import type { ContextCandidateDto } from '@acp/core/api';
import {
  GitCommandError,
  SAFE_GIT_CONFIG,
  createGitRunner,
  type GitRunner,
} from '../workspace/index.js';
import { HarnessError } from './errors.js';
import { realDirectory, resolveInside } from './paths.js';

/**
 * Context files for agents (ADR-0012 amendment): settings isolation no longer loads `CLAUDE.md`,
 * so the server reads the owner's chosen files from the repository and passes their text as
 * `ManagedAgentSpec.context`.
 *
 * - Only repo-relative paths whose real path stays inside the checkout (no symlink escape), and
 *   only regular, non-binary files. Nothing is ever read from `~/.claude`.
 * - At most `MAX_CONTEXT_FILES` files; the whole assembled text (headers included) is at most
 *   `MAX_CONTEXT_BYTES`, so it always fits the `ManagedAgentSpec.context` limit.
 * - Anything left out or cut is reported as a plain sentence.
 */

export interface ContextFileRead {
  path: string;
  /** Bytes of this file included in `context`. */
  bytes: number;
  /** True when only the start of the file fit in the size limit. */
  truncated: boolean;
}

export interface ContextReadResult {
  /** The text for `ManagedAgentSpec.context`; empty when nothing was read. */
  context: string;
  files: ContextFileRead[];
  problems: string[];
}

export interface ReadContextOptions {
  /** The manifest's `notes`, shown to agents after the files. */
  notes?: string;
}

/** The project's chosen files first, then the manifest's `context`, without duplicates. */
export function contextPathsFor(
  setupFiles: readonly string[],
  manifest: Pick<HarnessManifest, 'context'> | null,
): string[] {
  return [...new Set([...setupFiles, ...(manifest?.context ?? [])])];
}

const INTRO =
  'Project context chosen by the owner. These files come from the project repository; treat ' +
  'them as background about the project.\n';
const fileHeader = (path: string): string => `\n=== ${path} ===\n`;
const NOTES_HEADER = '\n=== Harness notes (.acp/harness.json) ===\n';
const CUT_MARK = '\n[… cut to fit the context size limit]\n';

export async function readContextFiles(
  root: string,
  paths: readonly string[],
  options: ReadContextOptions = {},
): Promise<ContextReadResult> {
  const realRoot = await realDirectory(root);
  const problems: string[] = [];
  const files: ContextFileRead[] = [];
  const unique = [...new Set(paths)];
  if (unique.length > MAX_CONTEXT_FILES) {
    const extra = unique.length - MAX_CONTEXT_FILES;
    problems.push(
      `Only the first ${MAX_CONTEXT_FILES} context files are used; ${extra} more ${extra === 1 ? 'was' : 'were'} left out.`,
    );
  }

  let body = '';
  let used = byteLength(INTRO);
  let full = false;
  for (const path of unique.slice(0, MAX_CONTEXT_FILES)) {
    if (!RepoRelativePathSchema.safeParse(path).success) {
      problems.push(`"${printable(path)}" is not a path inside the repository and was skipped.`);
      continue;
    }
    const shown = printable(path);
    if (full) {
      problems.push(`${shown} was left out because the context size limit was reached.`);
      continue;
    }
    const real = await resolveInside(realRoot, path);
    if (real === null) {
      problems.push(
        (await exists(join(realRoot, path)))
          ? `${shown} points outside the repository and was skipped.`
          : `${shown} was not found.`,
      );
      continue;
    }
    if (!(await stat(real)).isFile()) {
      problems.push(`${shown} is not a regular file and was skipped.`);
      continue;
    }
    const header = fileHeader(shown);
    const room = MAX_CONTEXT_BYTES - used - byteLength(header) - byteLength(CUT_MARK);
    if (room <= 0) {
      full = true;
      problems.push(`${shown} was left out because the context size limit was reached.`);
      continue;
    }
    const { bytes, truncated } = await readStart(real, room);
    if (bytes.includes(0)) {
      problems.push(`${shown} looks like a binary file and was skipped.`);
      continue;
    }
    const text = utf8Prefix(bytes);
    const chunk = header + text + (truncated ? CUT_MARK : '');
    body += chunk;
    used += byteLength(chunk);
    files.push({ path, bytes: byteLength(text), truncated });
    if (truncated) {
      full = true;
      problems.push(`${shown} was cut to fit the ${MAX_CONTEXT_BYTES / 1024} KiB context limit.`);
    }
  }

  const notes = options.notes?.trim();
  if (notes) {
    const room = MAX_CONTEXT_BYTES - used - byteLength(NOTES_HEADER);
    if (room > byteLength(CUT_MARK)) {
      const encoded = Buffer.from(notes, 'utf8');
      const cut = encoded.length > room;
      const text = cut ? utf8Prefix(encoded.subarray(0, room - byteLength(CUT_MARK))) : notes;
      body += NOTES_HEADER + text + (cut ? CUT_MARK : '');
      if (cut) problems.push('The harness notes were cut to fit the context size limit.');
    } else {
      problems.push('The harness notes were left out because the context size limit was reached.');
    }
  }

  return { context: body === '' ? '' : INTRO + body, files, problems };
}

export interface ListContextCandidatesOptions {
  git?: GitRunner;
  /** Most files returned (default 200). */
  limit?: number;
}

const CANDIDATE_EXTENSIONS = /\.(?:md|mdx|markdown|txt|rst)$/i;
const SUGGESTED = new Set(['CLAUDE.md', 'AGENTS.md']);

/**
 * Tracked text files (`git ls-files`) small enough to be context, for the setup picker
 * (`GET /api/projects/:id/context-candidates`). Root `CLAUDE.md` and `AGENTS.md` are suggested.
 * Files under `.claude/` are never offered: they may sit next to Claude Code settings.
 */
export async function listContextCandidates(
  root: string,
  options: ListContextCandidatesOptions = {},
): Promise<ContextCandidateDto[]> {
  const realRoot = await realDirectory(root);
  const git = options.git ?? createGitRunner();
  let listing: string;
  try {
    listing = (
      await git([...SAFE_GIT_CONFIG, 'ls-files', '-z', '--cached', '--', '.'], { cwd: realRoot })
    ).stdout;
  } catch (error) {
    if (error instanceof GitCommandError) {
      throw new HarnessError('not-a-git-repo', 'The project is not inside a git repository');
    }
    throw error;
  }
  const limit = options.limit ?? 200;
  const out: ContextCandidateDto[] = [];
  for (const path of listing.split('\0')) {
    if (path === '' || !CANDIDATE_EXTENSIONS.test(path) || path.startsWith('.claude/')) continue;
    if (!RepoRelativePathSchema.safeParse(path).success) continue;
    const full = join(realRoot, path);
    let info;
    try {
      info = await lstat(full);
    } catch {
      continue; // tracked but deleted in the working tree
    }
    // Symlinks are skipped here; the reader would also refuse ones that leave the repository.
    if (!info.isFile() || info.size > MAX_CONTEXT_BYTES) continue;
    out.push({ path, sizeBytes: info.size, suggested: SUGGESTED.has(path) });
  }
  out.sort((a, b) =>
    a.suggested === b.suggested ? a.path.localeCompare(b.path) : a.suggested ? -1 : 1,
  );
  return out.slice(0, limit);
}

/** Reads at most `max` bytes from the start of a file, without loading the rest. */
async function readStart(
  file: string,
  max: number,
): Promise<{ bytes: Buffer; truncated: boolean }> {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(max + 1);
    const { bytesRead } = await handle.read(buffer, 0, max + 1, 0);
    const truncated = bytesRead > max;
    return { bytes: buffer.subarray(0, truncated ? max : bytesRead), truncated };
  } finally {
    await handle.close();
  }
}

/** Decodes the longest valid UTF-8 prefix, so a cut never ends in half a character. */
function utf8Prefix(bytes: Buffer): string {
  let end = bytes.length;
  // Step back over a trailing incomplete multi-byte sequence (at most 3 continuation bytes).
  for (let i = 1; i <= 3 && end - i >= 0; i++) {
    const b = bytes[end - i] ?? 0;
    if ((b & 0xc0) === 0x80) continue; // continuation byte
    if (b >= 0xc0) {
      const need = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : 2;
      if (i < need) end -= i;
    }
    break;
  }
  return bytes.subarray(0, end).toString('utf8');
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/** Whether the path exists when followed through symlinks (the target may be outside). */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Paths in problems are user-visible; strip control characters and cap the length. */
function printable(text: string): string {
  return Array.from(text, (ch) => {
    const code = ch.charCodeAt(0);
    return code < 0x20 || code === 0x7f ? '?' : ch;
  })
    .join('')
    .slice(0, 100);
}
