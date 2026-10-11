import { realpath } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { WorkspaceRow } from '@acp/db';
import { SAFE_GIT_CONFIG, type GitRunner, type Workspace } from '../workspace/index.js';

/**
 * Turns a stored workspace row back into the manager's `Workspace`. The row has the worktree path,
 * branch and base; the repository root and the agent's cwd are derived from the project root again
 * (the manager re-validates every field before it touches anything). Workspaces created by this
 * process are kept in memory and never need this.
 */
export async function workspaceFromRow(
  row: WorkspaceRow,
  projectRoot: string | null,
  git: GitRunner,
): Promise<Workspace> {
  let repoRoot = projectRoot ?? row.worktreePath;
  let subdir = '';
  if (projectRoot !== null) {
    try {
      const project = await realpath(projectRoot);
      const top = (
        await git([...SAFE_GIT_CONFIG, 'rev-parse', '--show-toplevel'], { cwd: project })
      ).stdout.trim();
      repoRoot = await realpath(top);
      const rel = relative(repoRoot, project);
      if (rel !== '' && !rel.startsWith('..') && !rel.split(sep).includes('..')) subdir = rel;
    } catch {
      // The project folder is gone or no longer a repository: discard still works on the path.
    }
  }
  return {
    runId: row.runId,
    agentId: row.agentRunId,
    repoRoot,
    path: row.worktreePath,
    cwd: subdir === '' ? row.worktreePath : join(row.worktreePath, subdir),
    branch: row.branch,
    baseBranch: row.baseBranch,
    baseCommit: row.baseCommit ?? '',
  };
}
