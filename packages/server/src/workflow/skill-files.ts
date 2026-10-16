import { lstat, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SKILL_FILE, SKILLS_DIR, SkillNameSchema, isPathInside } from '@acp/core';

/**
 * Path rules for reading a project's skills, `<root>/.claude/skills/<name>/SKILL.md` (ADR-0018 §3):
 * the root is `realpath`ed; `.claude`, `.claude/skills`, a skill folder and its SKILL.md must be
 * real entries, never symlinks; the skills folder must resolve inside the root; and the owner's
 * personal `~/.claude` is never used, even for a project registered at the home directory
 * (AGENTS.md rule 4).
 *
 * This duplicates the rules of R-D's skills module (`src/skills/**`), which is not on main yet;
 * once it is, the Workflow listing and the skills plugin should call it instead.
 */

export interface SkillPathOptions {
  /** The owner's home directory; injected so tests never look at the real one. */
  homeDir?: string;
}

export function isMissing(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** `realpath`, or null when the path does not exist. */
export async function resolvedOrNull(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/** Whether `path` is a real directory (not a symlink to one); false when it does not exist. */
export async function isRealDirectory(path: string): Promise<boolean> {
  try {
    const stat = await lstat(path);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

export async function isRealFile(path: string): Promise<boolean> {
  try {
    const stat = await lstat(path);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

/**
 * The project's real skills folder, or null when there is none or a rule refuses it (a symlinked
 * segment, outside the root, or inside the owner's `~/.claude`).
 */
export async function projectSkillsDir(
  rootPath: string,
  options: SkillPathOptions = {},
): Promise<string | null> {
  const root = await resolvedOrNull(rootPath);
  if (root === null) return null;
  // Walk `.claude` then `.claude/skills` with lstat, so a symlinked segment is never followed.
  let dir = root;
  for (const segment of SKILLS_DIR.split('/')) {
    dir = join(dir, segment);
    if (!(await isRealDirectory(dir))) return null;
  }
  const real = await resolvedOrNull(dir);
  if (real === null || !isPathInside(root, real)) return null;
  const personal = await resolvedOrNull(join(options.homeDir ?? homedir(), '.claude'));
  if (personal !== null && isPathInside(personal, real)) return null;
  return real;
}

/**
 * A skill's SKILL.md inside a real skills folder, or null when the name is not a skill name, the
 * folder or the file is missing, or either is a symlink.
 */
export async function skillFileIn(skillsDir: string, name: string): Promise<string | null> {
  if (!SkillNameSchema.safeParse(name).success) return null;
  const folder = join(skillsDir, name);
  if (!(await isRealDirectory(folder))) return null;
  const file = join(folder, SKILL_FILE);
  return (await isRealFile(file)) ? file : null;
}
