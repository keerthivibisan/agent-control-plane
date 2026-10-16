import type { CheckRun } from '@acp/core';
import type { StreamNoticeDto } from '@acp/core/api';
import type { Repositories, WorkspaceRepositories } from '@acp/db';
import { isLiveAgentStatus } from '@acp/orchestrator';
import type { ControlService, ReviewGate } from '../control/service.js';
import { HttpError, notFound } from '../errors.js';
import { HarnessError, type CheckRunner, type MainChecks } from '../harness/index.js';
import { errorFields, type Logger } from '../logger.js';
import { harnessError } from './errors.js';
import type { ProjectHarness } from './harness.js';

/**
 * Harness checks on agents' changes (ADR-0017 §3–§4, README §4.2 step 6):
 *
 * - **When a ticket run enters review**, every helper with changes to review gets its checks run
 *   in its own worktree; **on demand** too (`POST /api/runs/:id/agents/:agentId/checks`).
 * - The manifest is read from the **project's checkout**, never the agent's worktree: an edited
 *   manifest is code under review and must not choose what runs (P4-C handoff).
 * - One shared runner for the whole server, so checks run one at a time across runs.
 * - Each result is stored (`check_runs`) as it finishes, and a notice is published.
 * - Stopping a run stops its running check and skips the rest.
 */

export interface CheckService {
  /** Runs the checks in one helper's worktree now and returns the stored results. */
  runForAgent(runId: string, agentRunId: string): Promise<CheckRun[]>;
  /** In the background: every helper of the run whose changes wait for review. */
  runOnReview(runId: string): void;
  /** "Run checks now" on the project's main branch (a temporary checkout). */
  runOnMain(projectId: string): Promise<CheckRun[]>;
  /** What the merge rule needs: failed required checks and whether checks are running. */
  gate(runId: string, agentRunId: string): ReviewGate;
  /** Stops the run's running check (the run was stopped). */
  abortRun(runId: string): void;
  /** Tests: resolves when no background check run is in flight. */
  idle(): Promise<void>;
  close(): Promise<void>;
}

export interface CheckServiceDeps {
  repos: Pick<Repositories, 'projects' | 'events'>;
  workspace: Pick<WorkspaceRepositories, 'checkRuns' | 'tickets'>;
  control: ControlService;
  runner: CheckRunner;
  mainChecks: MainChecks;
  harness: ProjectHarness;
  publish: (notice: StreamNoticeDto) => void;
  logger: Logger;
}

export function createCheckService(deps: CheckServiceDeps): CheckService {
  const { logger } = deps;
  /** Agents whose checks are running, and projects whose main-branch checks are. */
  const running = new Set<string>();
  const mainRunning = new Set<string>();
  const controllers = new Map<string, AbortController>();
  const tasks = new Set<Promise<void>>();
  let closed = false;

  function controllerFor(runId: string): AbortController {
    let c = controllers.get(runId);
    if (c === undefined || c.signal.aborted) {
      c = new AbortController();
      controllers.set(runId, c);
    }
    return c;
  }

  function store(result: CheckRun): CheckRun {
    const { id: _runnerId, ...input } = result;
    return deps.workspace.checkRuns.insert(input);
  }

  function publish(projectId: string, runId: string): void {
    const ticketId = deps.control.peek(runId)?.run.ticketId ?? null;
    deps.publish({
      kind: 'tickets-changed',
      lastEventId: deps.repos.events.maxId() ?? 0,
      sessionIds: [],
      projectIds: [projectId],
      runIds: [runId],
      ...(ticketId !== null && { ticketIds: [ticketId] }),
    });
  }

  async function runForAgent(runId: string, agentRunId: string): Promise<CheckRun[]> {
    if (closed) throw new HttpError(409, 'run_not_active', 'The server is shutting down.');
    const ws = await deps.control.agentWorkspace(runId, agentRunId);
    const state = deps.control.peek(runId);
    const agent = state?.agents.find((a) => a.id === agentRunId);
    if (state === undefined || agent === undefined) {
      throw notFound(`Agent ${agentRunId} not found in run ${runId}`);
    }
    if (agent.kind !== 'worker') {
      throw new HttpError(409, 'not_a_helper', "Checks run on helper agents' changes only");
    }
    if (isLiveAgentStatus(agent.status)) {
      throw new HttpError(
        409,
        'agent_working',
        'The agent is still working; check it once it stops',
      );
    }
    if (ws === undefined) {
      throw new HttpError(409, 'no_workspace', 'This agent has no copy of the project to check');
    }
    if (running.has(agentRunId)) {
      throw new HttpError(409, 'checks_running', 'The checks are already running for this agent');
    }
    const project = deps.repos.projects.getById(state.run.projectId);
    if (project === undefined) throw notFound(`Project ${state.run.projectId} not found`);
    running.add(agentRunId);
    try {
      const harness = await deps.harness.read(project);
      const manifest = harness?.manifest ?? null;
      if (manifest === null) return [];
      const stored: CheckRun[] = [];
      await deps.runner.run({
        // The project folder inside the worktree: manifest paths are relative to it.
        root: ws.cwd,
        checks: manifest.checks,
        projectId: project.id,
        runId,
        agentRunId,
        signal: controllerFor(runId).signal,
        onResult: (result) => {
          try {
            stored.push(store(result));
          } catch (error) {
            logger.log('error', 'check result not stored', { runId, ...errorFields(error) });
          }
          publish(project.id, runId);
        },
      });
      logger.log('info', 'checks finished', {
        runId,
        agentRunId,
        checks: stored.length,
        failed: stored.filter((r) => r.status !== 'passed').length,
      });
      return stored;
    } finally {
      running.delete(agentRunId);
    }
  }

  return {
    runForAgent,

    runOnReview(runId) {
      const state = deps.control.peek(runId);
      if (state === undefined || closed) return;
      const workers = state.agents.filter((a) => a.kind === 'worker' && a.review === 'pending');
      const task = (async () => {
        for (const worker of workers) {
          if (closed || controllerFor(runId).signal.aborted) return;
          try {
            await runForAgent(runId, worker.id);
          } catch (error) {
            // An agent without a worktree has nothing to check; others are logged by code.
            const code = error instanceof HttpError ? error.code : errorFields(error).errorName;
            if (code !== 'no_workspace') {
              logger.log('warn', 'review checks not run', { runId, agentRunId: worker.id, code });
            }
          }
        }
      })();
      tasks.add(task);
      void task.finally(() => tasks.delete(task));
    },

    async runOnMain(projectId) {
      const project = deps.repos.projects.getById(projectId);
      if (project === undefined) throw notFound(`Project ${projectId} not found`);
      if (mainRunning.has(projectId)) {
        throw new HttpError(409, 'checks_running', 'The checks are already running on main');
      }
      mainRunning.add(projectId);
      try {
        const result = await deps.mainChecks.run({ projectRoot: project.rootPath, projectId });
        const stored = result.results.map(store);
        logger.log('info', 'main checks finished', { projectId, checks: stored.length });
        return stored;
      } catch (error) {
        if (error instanceof HarnessError) throw harnessError(error);
        throw error;
      } finally {
        mainRunning.delete(projectId);
      }
    },

    gate(_runId, agentRunId) {
      const latest = deps.workspace.checkRuns.latestForAgentRun(agentRunId);
      // Fail closed: a required check that did not pass (failed, timed out, errored or skipped
      // because the run was stopped) blocks a plain merge.
      const failedRequired = latest
        .filter((r) => r.required && r.status !== 'passed')
        .map((r) => r.name);
      return { failedRequired, running: running.has(agentRunId) };
    },

    abortRun(runId) {
      controllers.get(runId)?.abort();
      controllers.delete(runId);
    },

    async idle() {
      while (tasks.size > 0) await Promise.allSettled([...tasks]);
    },

    async close() {
      closed = true;
      for (const c of controllers.values()) c.abort();
      controllers.clear();
      while (tasks.size > 0) await Promise.allSettled([...tasks]);
    },
  };
}
