import { randomUUID } from 'node:crypto';
import { constants, type Dirent } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rename, rmdir, unlink } from 'node:fs/promises';
import { basename, join, sep } from 'node:path';
import { AGENTS_DIR, SKILL_FILE, SKILLS_DIR, SkillNameSchema } from '@acp/core';
import { skillError } from './errors.js';

/**
 * The only file-system access the Skills & Agents API has (ADR-0018 §1, §3 and its amendment).
 * Every write lands in exactly `<real root>/.claude/skills/<slug>/SKILL.md` or
 * `<real root>/.claude/agents/<slug>.md`:
 *
 * - the root is realpath'd once, and every level below it (`.claude`, `.claude/skills` or
 *   `.claude/agents`, a skill's `<slug>/`, and the file) is checked with `lstat`, so a symlink at any
 *   level is refused, never followed;
 * - existing folders must also realpath to themselves inside the root (a hard guard against a link
 *   swapped in somewhere we did not look);
 * - missing folders are made one level at a time with a plain `mkdir` (which never follows a link at
 *   its own path) and checked again afterwards;
 * - the file is read with `O_NOFOLLOW` and written through an exclusive temp file plus `rename`, so
 *   a reader never sees half a file and an existing link is replaced, not written through.
 */

/** One project file the app may write: a skill's SKILL.md or an agent definition. */
export interface FileTarget {
  /** The project's real root. */
  root: string;
  /** Absolute folders from `.claude` down to the one holding the file; each is checked or made. */
  folders: readonly string[];
  /** The folder holding the file (the last of `folders`). */
  dir: string;
  file: string;
  /** Repo-relative (to the project root) path of the file, for DTOs. */
  relFile: string;
  /** The git pathspec a commit covers: the skill's folder, or the agent file itself. */
  relScope: string;
  /**
   * `dir`: the target exists when its own folder does (a skill is its folder);
   * `file`: when the file does (an agent is one file in a shared folder).
   */
  identity: 'dir' | 'file';
}

function code(error: unknown): string | undefined {
  const c = (error as { code?: unknown } | null)?.code;
  return typeof c === 'string' ? c : undefined;
}

function inside(root: string, path: string): boolean {
  return path === root || path.startsWith(root + sep);
}

function checkedSlug(slug: string): string {
  // The slug is schema-checked by the caller; this keeps the path rule local and testable too.
  if (!SkillNameSchema.safeParse(slug).success) {
    throw skillError('invalid_request', 'The name is not a valid slug');
  }
  return slug;
}

/** `.claude`, then `.claude/<kind>`, as absolute folders. */
function baseFolders(root: string, relDir: string): string[] {
  const out: string[] = [];
  let current = root;
  for (const segment of relDir.split('/')) {
    current = join(current, segment);
    out.push(current);
  }
  return out;
}

export function skillTarget(root: string, slug: string): FileTarget {
  const name = checkedSlug(slug);
  const folders = [...baseFolders(root, SKILLS_DIR), join(root, ...SKILLS_DIR.split('/'), name)];
  const dir = folders[folders.length - 1] ?? root;
  return {
    root,
    folders,
    dir,
    file: join(dir, SKILL_FILE),
    relFile: `${SKILLS_DIR}/${name}/${SKILL_FILE}`,
    relScope: `${SKILLS_DIR}/${name}`,
    identity: 'dir',
  };
}

export function agentTarget(root: string, slug: string): FileTarget {
  const name = checkedSlug(slug);
  const folders = baseFolders(root, AGENTS_DIR);
  const dir = folders[folders.length - 1] ?? root;
  return {
    root,
    folders,
    dir,
    file: join(dir, `${name}.md`),
    relFile: `${AGENTS_DIR}/${name}.md`,
    relScope: `${AGENTS_DIR}/${name}.md`,
    identity: 'file',
  };
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

async function realOrSelf(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

/**
 * The owner's personal `~/.claude` (skills and agents) is never read or written (ADR-0018 §1,
 * AGENTS.md rule 4), not even for a project registered at the home folder or inside `~/.claude`,
 * where `<root>/.claude/skills` would be exactly those skills.
 */
export async function refusePersonalClaudeDir(root: string, homeDir: string): Promise<void> {
  const personal = [join(homeDir, '.claude'), join(await realOrSelf(homeDir), '.claude')];
  const real = await realOrSelf(personal[0] ?? '');
  const projectClaude = join(root, '.claude');
  if ([...personal, real].some((p) => inside(p, projectClaude))) {
    throw skillError(
      'unsafe_path',
      "This project's .claude folder is your personal Claude folder, which the app never opens",
    );
  }
}

/**
 * Checks each existing folder from the root down. Returns how many exist (they are all real
 * folders inside the root); a missing level stops the walk.
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
      throw skillError('unsafe_path', 'A folder on the path is a symbolic link');
    }
    if (!stats.isDirectory()) {
      throw skillError('unsafe_path', 'Something on the path is not a folder');
    }
    const real = await realpath(level);
    if (real !== level || !inside(root, real)) {
      throw skillError('unsafe_path', 'The path resolves outside the project folder');
    }
    existing++;
  }
  return existing;
}

async function foldersExist(target: FileTarget): Promise<boolean> {
  return (await checkFolders(target.root, target.folders)) === target.folders.length;
}

/** Whether the file exists; refuses a link (never followed) or something that is not a file. */
async function fileExists(target: FileTarget): Promise<boolean> {
  let stats;
  try {
    stats = await lstat(target.file);
  } catch (error) {
    if (code(error) === 'ENOENT') return false;
    throw error;
  }
  if (stats.isSymbolicLink()) {
    throw skillError('unsafe_path', `${basename(target.file)} is a symbolic link`);
  }
  if (!stats.isFile()) throw skillError('unsafe_path', `${basename(target.file)} is not a file`);
  return true;
}

/** Whether the skill (its folder) or the agent (its file) exists; refuses links at any level. */
export async function targetExists(target: FileTarget): Promise<boolean> {
  if (!(await foldersExist(target))) return false;
  return target.identity === 'dir' ? true : fileExists(target);
}

/** Creates the missing folders down to the file's folder, one plain `mkdir` per level. */
export async function ensureFolders(target: FileTarget): Promise<void> {
  const existing = await checkFolders(target.root, target.folders);
  for (const level of target.folders.slice(existing)) {
    try {
      await mkdir(level, { mode: 0o755 });
    } catch (error) {
      // Made by someone else meanwhile: the re-check below decides whether it is acceptable.
      if (code(error) !== 'EEXIST') throw error;
    }
  }
  if (!(await foldersExist(target))) {
    throw skillError('unsafe_path', 'The folder could not be created');
  }
}

async function listing(root: string, relDir: string): Promise<Dirent[] | null> {
  const levels = baseFolders(root, relDir);
  if ((await checkFolders(root, levels)) !== levels.length) return null;
  try {
    return await readdir(levels[levels.length - 1] ?? root, { withFileTypes: true });
  } catch (error) {
    if (code(error) === 'ENOENT') return null;
    throw error;
  }
}

export interface Listed {
  names: string[];
  /** Entries that are not a valid slug, or are links (never followed). */
  skipped: number;
}

/** Skill folder names under `.claude/skills`, real folders only (links are skipped). */
export async function listSkillFolders(root: string): Promise<Listed> {
  const entries = await listing(root, SKILLS_DIR);
  if (entries === null) return { names: [], skipped: 0 };
  const names: string[] = [];
  let skipped = 0;
  for (const entry of entries) {
    // `isDirectory()` is false for a symlink to a folder, so links are never listed or followed.
    if (entry.isDirectory() && SkillNameSchema.safeParse(entry.name).success)
      names.push(entry.name);
    else if (!entry.name.startsWith('.')) skipped++;
  }
  return { names: names.sort(), skipped };
}

/** Agent names from `.claude/agents/<name>.md`, regular files only (links are skipped). */
export async function listAgentFiles(root: string): Promise<Listed> {
  const entries = await listing(root, AGENTS_DIR);
  if (entries === null) return { names: [], skipped: 0 };
  const names: string[] = [];
  let skipped = 0;
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const stem = entry.name.endsWith('.md') ? entry.name.slice(0, -3) : null;
    // `isFile()` is false for a symlink, so a linked definition is never read.
    if (entry.isFile() && stem !== null && SkillNameSchema.safeParse(stem).success) {
      names.push(stem);
    } else {
      skipped++;
    }
  }
  return { names: names.sort(), skipped };
}

export type ReadResult =
  | { kind: 'missing' }
  | { kind: 'too-large'; sizeBytes: number }
  | { kind: 'not-text'; sizeBytes: number }
  | { kind: 'ok'; text: string; sizeBytes: number };

const UTF8 = new TextDecoder('utf-8', { fatal: true });

/** Reads the file without following a link, refusing anything over `maxBytes` or not UTF-8. */
export async function readTargetFile(target: FileTarget, maxBytes: number): Promise<ReadResult> {
  if (!(await foldersExist(target))) return { kind: 'missing' };
  let handle;
  try {
    handle = await open(target.file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    const c = code(error);
    if (c === 'ENOENT') return { kind: 'missing' };
    if (c === 'ELOOP') {
      throw skillError('unsafe_path', `${basename(target.file)} is a symbolic link`);
    }
    throw error;
  }
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) {
      throw skillError('unsafe_path', `${basename(target.file)} is not a regular file`);
    }
    if (stats.size > maxBytes) return { kind: 'too-large', sizeBytes: stats.size };
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
export function encodeText(text: string, maxBytes: number, what: string): Buffer {
  if (LONE_SURROGATE.test(text) || text.includes('\u0000')) {
    throw skillError('invalid_request', 'The text is not valid UTF-8 text');
  }
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length > maxBytes) {
    throw skillError('too_large', `${what} can be at most ${maxBytes / 1024} KiB`);
  }
  return bytes;
}

/** Writes the file atomically, making its folders first. */
export async function writeTargetFile(target: FileTarget, bytes: Buffer): Promise<void> {
  await ensureFolders(target);
  // Refuse a linked file even though rename would replace the link, not its target: a link there
  // was put by someone else, and the owner should see it rather than have it vanish.
  await fileExists(target);
  const temp = join(target.dir, `.${basename(target.file)}.${randomUUID()}.tmp`);
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
    await rename(temp, target.file);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

/**
 * Removes the file; for a skill, also its `<slug>/` folder when that is now empty (ADR-0018 §1).
 * Returns whether a file went.
 */
export async function removeTargetFile(target: FileTarget): Promise<boolean> {
  if (!(await foldersExist(target))) return false;
  if (!(await fileExists(target))) return false;
  await unlink(target.file);
  if (target.identity === 'dir') {
    try {
      await rmdir(target.dir);
    } catch (error) {
      // Other files the owner keeps next to SKILL.md stay; the app only removes an empty folder.
      if (code(error) !== 'ENOTEMPTY' && code(error) !== 'EEXIST') throw error;
    }
  }
  return true;
}
