import { lstat, readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SKILL_FILE, SKILLS_DIR, SkillNameSchema, isPathInside, type SkillName } from '@acp/core';

/**
 * The names of a project's skills, `<root>/.claude/skills/<name>/SKILL.md` (ADR-0018), for the
 * Workflow page's skill pickers. A directory listing only: no SKILL.md is opened.
 *
 * This duplicates the path rules of R-D's skills module (`src/skills/**`), which had not landed
 * when R-G was written; once it has, this should call it instead.
 *
 * Path rules (ADR-0018 §3): the root is `realpath`ed; `.claude`, `.claude/skills`, a skill folder
 * and its SKILL.md must be real entries, never symlinks; the skills folder must resolve inside the
 * root; and the owner's personal `~/.claude` is never listed, even for a project registered at the
 * home directory (AGENTS.md rule 4). A project without skills, or whose folder is gone, has none.
 */

export interface SkillListingOptions {
  /** The owner's home directory; injected so tests never look at the real one. */
  homeDir?: string;
}

function isMissing(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** `realpath`, or null when the path does not exist. */
async function resolved(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/** Whether `path` is a real directory (not a symlink to one); false when it does not exist. */
async function isRealDirectory(path: string): Promise<boolean> {
  try {
    const stat = await lstat(path);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function isRealFile(path: string): Promise<boolean> {
  try {
    const stat = await lstat(path);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

export async function listProjectSkillNames(
  rootPath: string,
  options: SkillListingOptions = {},
): Promise<SkillName[]> {
  const root = await resolved(rootPath);
  if (root === null) return [];

  // Walk `.claude` then `.claude/skills` with lstat, so a symlinked segment is never followed.
  let dir = root;
  for (const segment of SKILLS_DIR.split('/')) {
    dir = join(dir, segment);
    if (!(await isRealDirectory(dir))) return [];
  }
  const real = await resolved(dir);
  if (real === null || !isPathInside(root, real)) return [];
  const personal = await resolved(join(options.homeDir ?? homedir(), '.claude'));
  if (personal !== null && isPathInside(personal, real)) return [];

  const names: SkillName[] = [];
  for (const entry of await readdir(real, { withFileTypes: true })) {
    // A Dirent describes the entry itself: a symlinked folder is not `isDirectory()`.
    if (!entry.isDirectory()) continue;
    const name = SkillNameSchema.safeParse(entry.name);
    if (!name.success) continue;
    if (await isRealFile(join(real, entry.name, SKILL_FILE))) names.push(name.data);
  }
  return names.sort();
}
