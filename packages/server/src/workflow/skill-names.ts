import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { SkillNameSchema, type SkillName } from '@acp/core';
import { HttpError } from '../errors.js';
import { listAgentFiles, realRoot, refusePersonalClaudeDir } from '../skills/paths.js';
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

/**
 * The names of a project's agent files, `<root>/.claude/agents/<name>.md` (ADR-0018 amendment), for
 * the workflow graph's agent-file pickers and the validator's `missing-agent-file` warning. A
 * directory listing with the Skills & Agents path rules (`skills/paths.ts`): links are never
 * followed and the owner's personal `~/.claude` is never opened. A project whose folder is gone,
 * or that a rule refuses, has none.
 */
export async function listProjectAgentNames(
  rootPath: string,
  options: SkillListingOptions = {},
): Promise<SkillName[]> {
  try {
    const root = await realRoot(rootPath);
    await refusePersonalClaudeDir(root, options.homeDir ?? homedir());
    const { names } = await listAgentFiles(root);
    return names.flatMap((n) => {
      const name = SkillNameSchema.safeParse(n);
      return name.success ? [name.data] : [];
    });
  } catch (error) {
    if (error instanceof HttpError) return [];
    throw error;
  }
}
