import { randomUUID } from 'node:crypto';
import { constants, type Dirent } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rename, rmdir, unlink } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { MAX_SKILL_BYTES, SKILL_FILE, SKILLS_DIR, SkillNameSchema } from '@acp/core';
import { skillError } from './errors.js';

/**
 * The only file-system access the Skills API has (ADR-0018 §1, §3). Every write lands in exactly
 * `<real project root>/.claude/skills/<slug>/SKILL.md`:
 *
 * - the root is realpath'd once, and every level below it (`.claude`, `.claude/skills`, `<slug>`,
 *   `SKILL.md`) is checked with `lstat`, so a symlink at any level is refused, never followed;
 * - existing folders must also realpath to themselves inside the root (a hard guard against a link
 *   swapped in somewhere we did not look);
 * - missing folders are made one level at a time with a plain `mkdir` (which never follows a link at
 *   its own path) and checked again afterwards;
 * - SKILL.md is read with `O_NOFOLLOW` and written through an exclusive temp file plus `rename`, so
 *   a reader never sees half a file and an existing link is replaced, not written through.
 */

const SKILLS_SEGMENTS = SKILLS_DIR.split('/');

export interface SkillPaths {
  /** The project's real root. */
  root: string;
  /** `<root>/.claude/skills`. */
  skillsDir: string;
  /** `<root>/.claude/skills/<slug>`. */
  dir: string;
  /** `<root>/.claude/skills/<slug>/SKILL.md`. */
  file: string;
  /** Repo-relative (to the project root) forms, for git pathspecs and DTOs. */
  relDir: string;
  relFile: string;
}

function code(error: unknown): string | undefined {
  const c = (error as { code?: unknown } | null)?.code;
  return typeof c === 'string' ? c : undefined;
}

export async function realRoot(rootPath: string): Promise<string> {
  try {
    const root = await realpath(rootPath);
    if (!(await lstat(root)).isDirectory()) throw new Error('not a folder');
    return root;
  } catch {
    throw skillError('not_found', 'The project folder does not exist or is not a folder');
  }
}

export function skillPaths(root: string, slug: string): SkillPaths {
  // The slug is schema-checked by the caller; this keeps the path rule local and testable too.
  if (!SkillNameSchema.safeParse(slug).success) {
    throw skillError('invalid_request', 'The skill name is not a valid slug');
  }
  const skillsDir = join(root, ...SKILLS_SEGMENTS);
  const dir = join(skillsDir, slug);
  return {
    root,
    skillsDir,
    dir,
    file: join(dir, SKILL_FILE),
    relDir: `${SKILLS_DIR}/${slug}`,
    relFile: `${SKILLS_DIR}/${slug}/${SKILL_FILE}`,
  };
}

function inside(root: string, path: string): boolean {
  return path === root || path.startsWith(root + sep);
}

/**
 * Checks each existing level from the root down to `levels`' last entry. Returns how many levels
 * exist (they are all real folders inside the root); a missing level stops the walk.
 */
async function checkFolders(root: string, levels: readonly string[]): Promise<number> {
  let existing = 0;
  for (const level of levels) {
    let stats;
    try {
      stats = await lstat(level);
    } catch (error) {
      if (code(error) === 'ENOENT') return existing;
      throw error;
    }
    if (stats.isSymbolicLink()) {
      throw skillError('unsafe_path', 'A folder on the skill path is a symbolic link');
    }
    if (!stats.isDirectory()) {
      throw skillError('unsafe_path', 'Something on the skill path is not a folder');
    }
    const real = await realpath(level);
    if (real !== level || !inside(root, real)) {
      throw skillError('unsafe_path', 'The skill path resolves outside the project folder');
    }
    existing++;
  }
  return existing;
}

/** `.claude`, `.claude/skills` and, when given, the skill folder: the levels checked for links. */
function levelsFor(root: string, dir?: string): string[] {
  const out: string[] = [];
  let current = root;
  for (const segment of SKILLS_SEGMENTS) {
    current = join(current, segment);
    out.push(current);
  }
  if (dir !== undefined) out.push(dir);
  return out;
}

/** Whether `.claude/skills` exists (as a real folder inside the root); refuses links. */
export async function skillsDirExists(root: string): Promise<boolean> {
  const levels = levelsFor(root);
  return (await checkFolders(root, levels)) === levels.length;
}

/** Whether `<slug>/` exists as a real folder; refuses links at any level. */
export async function skillDirExists(paths: SkillPaths): Promise<boolean> {
  const levels = levelsFor(paths.root, paths.dir);
  return (await checkFolders(paths.root, levels)) === levels.length;
}

/** Creates the missing folders down to `<slug>/`, one plain `mkdir` per level. */
export async function ensureSkillDir(paths: SkillPaths): Promise<void> {
  const levels = levelsFor(paths.root, paths.dir);
  const existing = await checkFolders(paths.root, levels);
  for (const level of levels.slice(existing)) {
    try {
      await mkdir(level, { mode: 0o755 });
    } catch (error) {
      // Made by someone else meanwhile: the re-check below decides whether it is acceptable.
      if (code(error) !== 'EEXIST') throw error;
    }
  }
  if ((await checkFolders(paths.root, levels)) !== levels.length) {
    throw skillError('unsafe_path', 'The skill folder could not be created');
  }
}

/** The skill folder names under `.claude/skills`, real folders only (links are skipped). */
export async function listSkillFolders(
  root: string,
): Promise<{ names: string[]; skipped: number }> {
  if (!(await skillsDirExists(root))) return { names: [], skipped: 0 };
  let entries: Dirent[];
  try {
    entries = await readdir(join(root, ...SKILLS_SEGMENTS), { withFileTypes: true });
  } catch (error) {
    if (code(error) === 'ENOENT') return { names: [], skipped: 0 };
    throw error;
  }
  const names: string[] = [];
  let skipped = 0;
  for (const entry of entries) {
    // `isDirectory()` is false for a symlink to a folder, so links are never listed or followed.
    if (entry.isDirectory() && SkillNameSchema.safeParse(entry.name).success)
      names.push(entry.name);
    else if (!entry.name.startsWith('.')) skipped++;
  }
  names.sort();
  return { names, skipped };
}

export type ReadResult =
  | { kind: 'missing' }
  | { kind: 'too-large'; sizeBytes: number }
  | { kind: 'not-text'; sizeBytes: number }
  | { kind: 'ok'; text: string; sizeBytes: number };

const UTF8 = new TextDecoder('utf-8', { fatal: true });

/** Reads SKILL.md without following a link, refusing anything over the cap or not UTF-8 text. */
export async function readSkillFile(paths: SkillPaths): Promise<ReadResult> {
  if (!(await skillDirExists(paths))) return { kind: 'missing' };
  let handle;
  try {
    handle = await open(paths.file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    const c = code(error);
    if (c === 'ENOENT') return { kind: 'missing' };
    if (c === 'ELOOP') throw skillError('unsafe_path', 'SKILL.md is a symbolic link');
    throw error;
  }
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw skillError('unsafe_path', 'SKILL.md is not a regular file');
    if (stats.size > MAX_SKILL_BYTES) return { kind: 'too-large', sizeBytes: stats.size };
    const buffer = Buffer.alloc(stats.size);
    let read = 0;
    while (read < stats.size) {
      const { bytesRead } = await handle.read(buffer, read, stats.size - read, read);
      if (bytesRead === 0) break;
      read += bytesRead;
    }
    const bytes = buffer.subarray(0, read);
    try {
      const text = UTF8.decode(bytes);
      if (text.includes('\u0000')) return { kind: 'not-text', sizeBytes: read };
      return { kind: 'ok', text, sizeBytes: read };
    } catch {
      return { kind: 'not-text', sizeBytes: read };
    }
  } finally {
    await handle.close();
  }
}

/** Lone surrogates cannot be encoded as UTF-8; Buffer would silently replace them. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Checks the text is writable UTF-8 within the cap; returns its bytes. */
export function encodeSkillText(text: string): Buffer {
  if (LONE_SURROGATE.test(text) || text.includes('\u0000')) {
    throw skillError('invalid_request', 'The skill text is not valid UTF-8 text');
  }
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length > MAX_SKILL_BYTES) {
    throw skillError('too_large', `SKILL.md can be at most ${MAX_SKILL_BYTES / 1024} KiB`);
  }
  return bytes;
}

/** Writes SKILL.md atomically. The folder must already exist (`ensureSkillDir`). */
export async function writeSkillFile(paths: SkillPaths, bytes: Buffer): Promise<void> {
  // Refuse a linked SKILL.md even though rename would replace the link, not its target: a link
  // there was put by someone else, and the owner should see it rather than have it vanish.
  try {
    if ((await lstat(paths.file)).isSymbolicLink()) {
      throw skillError('unsafe_path', 'SKILL.md is a symbolic link');
    }
  } catch (error) {
    if (code(error) !== 'ENOENT') throw error;
  }
  const temp = join(paths.dir, `.${SKILL_FILE}.${randomUUID()}.tmp`);
  const handle = await open(temp, 'wx', 0o644);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await unlink(temp).catch(() => undefined);
    throw error;
  }
  await handle.close();
  try {
    await rename(temp, paths.file);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

/** Removes SKILL.md, then the `<slug>/` folder if it is now empty. Returns whether a file went. */
export async function removeSkillFile(paths: SkillPaths): Promise<boolean> {
  if (!(await skillDirExists(paths))) return false;
  try {
    if ((await lstat(paths.file)).isSymbolicLink()) {
      throw skillError('unsafe_path', 'SKILL.md is a symbolic link');
    }
  } catch (error) {
    if (code(error) === 'ENOENT') return false;
    throw error;
  }
  await unlink(paths.file);
  try {
    await rmdir(paths.dir);
  } catch (error) {
    // Other files the owner keeps next to SKILL.md stay; the app only ever removes an empty folder.
    if (code(error) !== 'ENOTEMPTY' && code(error) !== 'EEXIST') throw error;
  }
  return true;
}
