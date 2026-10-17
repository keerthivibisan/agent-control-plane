import type { HarnessStatus, Project, ProjectApprovals } from '@acp/core';
import type { Repositories, WorkspaceRepositories } from '@acp/db';
import type { AgentSetup } from '../control/service.js';
import type { AllowlistContext } from '../control/allowlist.js';
import {
  HarnessError,
  contextPathsFor,
  readContextFiles,
  readHarness,
  type HarnessReadResult,
} from '../harness/index.js';
import { errorFields, type Logger } from '../logger.js';

/**
 * A project's harness as the server uses it (ADR-0017 §2). Status is read from the **project's
 * checkout** on demand and kept in memory for a few seconds (README §6.5: not stored). What the
 * agents get (context files) and what the allowlist may pre-approve (check commands) are always
 * read fresh from the project's checkout, never from an agent's worktree.
 */

const CACHE_MS = 10_000;

export interface ProjectHarness {
  /** Status for the board and settings; `fresh` skips the cache. Never throws. */
  status(project: Project, options?: { fresh?: boolean }): Promise<HarnessStatus>;
  /** A fresh read of the manifest; null when the project folder itself can't be read. */
  read(project: Project): Promise<HarnessReadResult | null>;
  /** Context files and model for a run's agents (ADR-0012 amendment). */
  agentSetup(projectId: string): Promise<AgentSetup>;
  /**
   * The allowlist and the checks it may pre-approve; null when nothing may run unasked. With a
   * run's `policy` (ADR-0021) the policy decides: manual asks for everything (null); otherwise the
   * checks are read for the exact-check rule. Without one, the legacy project allowlist applies.
   */
  allowlist(projectId: string, policy?: ProjectApprovals): Promise<AllowlistContext | null>;
}

export interface ProjectHarnessDeps {
  repos: Pick<Repositories, 'projects'>;
  workspace: Pick<WorkspaceRepositories, 'projectSetup'>;
  now: () => Date;
  logger: Logger;
}

export function createProjectHarness(deps: ProjectHarnessDeps): ProjectHarness {
  const cache = new Map<string, { at: number; rootPath: string; status: HarnessStatus }>();

  async function read(project: Project): Promise<HarnessReadResult | null> {
    try {
      const result = await readHarness(project.rootPath, { now: deps.now });
      cache.set(project.id, {
        at: deps.now().getTime(),
        rootPath: project.rootPath,
        status: result.status,
      });
      return result;
    } catch (error) {
      if (error instanceof HarnessError) return null;
      throw error;
    }
  }

  function unreadable(): HarnessStatus {
    return {
      state: 'none',
      checkedAt: deps.now().toISOString(),
      problems: ["The project folder can't be read, so its harness was not checked."],
      checks: [],
    };
  }

  return {
    async status(project, options = {}) {
      const hit = cache.get(project.id);
      const age = hit === undefined ? Infinity : deps.now().getTime() - hit.at;
      if (options.fresh !== true && hit?.rootPath === project.rootPath && age < CACHE_MS) {
        return hit.status;
      }
      try {
        return (await read(project))?.status ?? unreadable();
      } catch (error) {
        deps.logger.log('warn', 'harness status unavailable', errorFields(error));
        return unreadable();
      }
    },

    read,

    async agentSetup(projectId) {
      const project = deps.repos.projects.getById(projectId);
      if (project === undefined) return { context: '', model: null };
      const setup = deps.workspace.projectSetup.get(projectId);
      const manifest = (await read(project))?.manifest ?? null;
      const paths = contextPathsFor(setup?.contextFiles ?? [], manifest);
      const notes = manifest?.notes;
      if (paths.length === 0 && (notes === undefined || notes.trim() === '')) {
        return { context: '', model: setup?.model ?? null };
      }
      const result = await readContextFiles(
        project.rootPath,
        paths,
        notes === undefined ? {} : { notes },
      );
      if (result.problems.length > 0) {
        // Plain sentences about the owner's own files; only the count is logged.
        deps.logger.log('warn', 'context files partly read', {
          projectId,
          problems: result.problems.length,
        });
      }
      return { context: result.context, model: setup?.model ?? null };
    },

    async allowlist(projectId, policy) {
      const project = deps.repos.projects.getById(projectId);
      if (policy !== undefined) {
        if (project === undefined || policy.mode === 'manual') return null;
        // From the owner's checkout, never an agent's worktree (P4-C handoff).
        const manifest = (await read(project))?.manifest ?? null;
        return { policy, checks: manifest?.checks ?? [] };
      }
      const setup = deps.workspace.projectSetup.get(projectId);
      if (project === undefined || setup === undefined) return null;
      const { editInOwnWorktree, runHarnessChecks } = setup.allowlist;
      if (!editInOwnWorktree && !runHarnessChecks) return null;
      const manifest = runHarnessChecks ? ((await read(project))?.manifest ?? null) : null;
      return { allowlist: setup.allowlist, checks: manifest?.checks ?? [] };
    },
  };
}
