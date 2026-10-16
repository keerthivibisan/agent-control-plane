import { readdir } from 'node:fs/promises';
import { SkillNameSchema, type SkillName } from '@acp/core';
import { projectSkillsDir, skillFileIn, type SkillPathOptions } from './skill-files.js';

/**
 * The names of a project's skills, `<root>/.claude/skills/<name>/SKILL.md` (ADR-0018), for the
 * Workflow page's skill pickers. A directory listing only: no SKILL.md is opened. The path rules
 * are in `skill-files.ts`. A project without skills, or whose folder is gone, has none.
 */

export type SkillListingOptions = SkillPathOptions;

export async function listProjectSkillNames(
  rootPath: string,
  options: SkillListingOptions = {},
): Promise<SkillName[]> {
  const dir = await projectSkillsDir(rootPath, options);
  if (dir === null) return [];
  const names: SkillName[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    // A Dirent describes the entry itself: a symlinked folder is not `isDirectory()`.
    if (!entry.isDirectory()) continue;
    const name = SkillNameSchema.safeParse(entry.name);
    if (!name.success) continue;
    if ((await skillFileIn(dir, entry.name)) !== null) names.push(name.data);
  }
  return names.sort();
}
