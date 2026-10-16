import {
  DEFAULT_AGENT_BUDGET_TOKENS,
  MAX_CONCURRENT_CHILD_AGENTS,
  MAX_DELEGATION_DEPTH,
  type ProjectAgentSetup,
} from '@acp/core';
import { DbError, type ProjectSetupInput, type WorkspaceRepositories } from '@acp/db';

/**
 * The project's agent setup (README §4.1 steps 2–4). Projects registered before migration 0003, or
 * through "Add an existing folder", have no `project_setup` row; the first board or setup call
 * creates one with the defaults below, so `GET /api/projects/:id/setup` always answers.
 */

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Candidate project keys for a project name: its letters in capitals (2–6), then the same with a
 * last letter varied, then two. `web-app` → `WEBAPP`, `WEBAPA`, ... Names without two letters
 * start from `PRJ`.
 */
export function projectKeyCandidates(name: string): string[] {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, '');
  const base = letters.length >= 2 ? letters.slice(0, 6) : 'PRJ';
  const out = [base];
  const stem1 = base.length >= 6 ? base.slice(0, 5) : base;
  for (const a of LETTERS) out.push(`${stem1}${a}`);
  const stem2 = base.slice(0, 4);
  for (const a of LETTERS) for (const b of LETTERS) out.push(`${stem2}${a}${b}`);
  return [...new Set(out)].filter((k) => k.length >= 2 && k.length <= 6);
}

export interface DefaultSetupOptions {
  /** Pre-approve the harness checks: on once a harness exists (README §4.1 step 3). */
  harnessExists: boolean;
}

export function defaultSetup(
  projectId: string,
  projectKey: string,
  options: DefaultSetupOptions,
): ProjectSetupInput {
  return {
    projectId,
    projectKey,
    planFirst: true,
    maxConcurrentHelpers: MAX_CONCURRENT_CHILD_AGENTS,
    maxDepth: MAX_DELEGATION_DEPTH,
    defaultBudgetTokensPerAgent: DEFAULT_AGENT_BUDGET_TOKENS,
    model: null,
    allowlist: { editInOwnWorktree: false, runHarnessChecks: options.harnessExists },
    contextFiles: [],
  };
}

/**
 * The project's setup, creating the default row when there is none. The key is the first free
 * candidate; a key taken in between (another writer) moves on to the next one.
 */
export function ensureSetup(
  repos: Pick<WorkspaceRepositories, 'projectSetup'>,
  project: { id: string; name: string },
  options: DefaultSetupOptions,
): ProjectAgentSetup {
  const existing = repos.projectSetup.get(project.id);
  if (existing !== undefined) return existing;
  for (const key of projectKeyCandidates(project.name)) {
    if (repos.projectSetup.getByProjectKey(key) !== undefined) continue;
    try {
      return repos.projectSetup.upsert(defaultSetup(project.id, key, options));
    } catch (error) {
      if (!(error instanceof DbError && error.code === 'conflict')) throw error;
      const raced = repos.projectSetup.get(project.id);
      if (raced !== undefined) return raced;
    }
  }
  throw new DbError('conflict', 'no free project key for this project');
}
