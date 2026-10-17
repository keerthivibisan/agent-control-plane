import type { CheckRun } from '@acp/core';
import type { StreamNoticeDto } from '@acp/core/api';
import type { Repositories, ReviewLoopRepositories, WorkspaceRepositories } from '@acp/db';
import { isActiveAgentStatus, isLiveAgentStatus } from '@acp/orchestrator';
import { hasReviewableChange } from '../control/roles.js';
import type { ControlService, ReviewGate } from '../control/service.js';
import { HttpError, notFound } from '../errors.js';
import { HarnessError, type CheckRunner, type MainChecks } from '../harness/index.js';
import { errorFields, type Logger } from '../logger.js';
import type { WorkspaceManager } from '../workspace/index.js';
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
  /**
   * ADR-0021: runs the checks on one commit now and stores each result with it. `agentRunId` set:
   * the helper's sealed (or integrated) commit, in its own worktree, which must be at `commit`
   * with nothing unsealed. `agentRunId` null: the run's ticket branch tip, in a temporary detached
   * checkout. The manifest is still read from the owner's checkout.
   */
  runOnCommit(runId: string, agentRunId: string | null, commit: string): Promise<CheckRun[]>;
  /**
   * ADR-0021 merge gate: the required checks' latest results **on this commit** only. Results on
   * any other commit (an earlier seal, another round) never count.
   */
  gateForCommit(runId: string, agentRunId: string | null, commit: string): Promise<CommitGate>;
  /**
   * In the background: `runOnCommit`, then `onFinished` with the gate's verdict (also when the
   * checks could not run: then `requiredPassed` is false and `failed` names why in plain words).
   */
  startOnCommit(
    runId: string,
    agentRunId: string | null,
    commit: string,
    onFinished: (result: CommitChecksResult) => void,
  ): void;
  /** Tests: resolves when no background check run is in flight. */
  idle(): Promise<void>;
  close(): Promise<void>;
}

/** The merge gate for one commit (ADR-0021). */
export interface CommitGate {
  /** Every required check passed on this commit (true when the manifest has none). */
  passed: boolean;
  /** Names of required checks whose latest result on this commit is not a pass. */
  failedRequired: readonly string[];
  /** Names of required checks with no result on this commit yet. */
  missing: readonly string[];
  /** Checks are running on this commit right now. */
  running: boolean;
}

/** What `startOnCommit` reports, the shape the engine's `checksFinished` takes. */
export interface CommitChecksResult {
  commit: string;
  requiredPassed: boolean;
  failed: readonly string[];
}

export interface CheckServiceDeps {
  repos: Pick<Repositories, 'projects' | 'events'>;
  workspace: Pick<WorkspaceRepositories, 'checkRuns' | 'tickets'>;
  /** ADR-0021: check results stored with their commit. */
  reviewLoop: Pick<ReviewLoopRepositories, 'checkCommits'>;
  /** ADR-0021: temporary detached checkouts of the ticket branch tip. */
  checkouts: Pick<WorkspaceManager, 'checkoutCommit' | 'removeCheckout' | 'sealedHead'>;
  control: ControlService;
  runner: CheckRunner;
  mainChecks: MainChecks;
  harness: ProjectHarness;
  publish: (notice: StreamNoticeDto) => void;
  logger: Logger;
}

/** A full commit id, as git prints it. */
const FULL_COMMIT = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

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
    // ADR-0019: the tester's change is reviewed and checked like a helper's.
    if (!hasReviewableChange(agent.kind)) {
      throw new HttpError(409, 'not_a_helper', "Checks run on helper agents' changes only");
    }
    if (state.integration !== undefined && !isActiveAgentStatus(agent.status)) {
      // ADR-0021: a loop run's change is checked on its sealed commit, stored with that commit.
      const commit = agent.change?.headCommit ?? null;
      if (commit === null) {
        throw new HttpError(
          409,
          'not_sealed',
          'This change is not sealed yet; check it once it is',
        );
      }
      return runOnCommit(runId, agentRunId, commit);
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

  /** The key of one commit's checks in `running`: a helper's change or the run's ticket tip. */
  const commitKey = (runId: string, agentRunId: string | null, commit: string) =>
    `${agentRunId ?? `tip:${runId}`}@${commit}`;

  async function runOnCommit(
    runId: string,
    agentRunId: string | null,
    commit: string,
  ): Promise<CheckRun[]> {
    if (closed) throw new HttpError(409, 'run_not_active', 'The server is shutting down.');
    if (!FULL_COMMIT.test(commit)) throw new HttpError(400, 'invalid_request', 'Not a commit id');
    const state = deps.control.peek(runId);
    if (state === undefined) throw notFound(`Run ${runId} not found`);
    const project = deps.repos.projects.getById(state.run.projectId);
    if (project === undefined) throw notFound(`Project ${state.run.projectId} not found`);
    const key = commitKey(runId, agentRunId, commit);
    if (running.has(key)) {
      throw new HttpError(409, 'checks_running', 'The checks are already running on this commit');
    }
    running.add(key);
    // Also blocks the legacy gate's "running" for this agent while its commit is checked.
    if (agentRunId !== null) running.add(agentRunId);
    let checkout: Awaited<ReturnType<typeof deps.checkouts.checkoutCommit>> | undefined;
    try {
      let root: string;
      if (agentRunId === null) {
        checkout = await deps.checkouts.checkoutCommit(project.rootPath, runId, commit);
        root = checkout.cwd;
      } else {
        const ws = await deps.control.agentWorkspace(runId, agentRunId);
        if (ws === undefined) {
          throw new HttpError(
            409,
            'no_workspace',
            'This agent has no copy of the project to check',
          );
        }
        // Results are stored for `commit`, so they must have run on exactly that commit.
        if ((await deps.checkouts.sealedHead(ws)) !== commit) {
          throw new HttpError(
            409,
            'commit_changed',
            "The helper's copy is no longer at the commit to check",
          );
        }
        root = ws.cwd;
      }
      // From the owner's checkout, never the commit under check (P4-C handoff).
      const manifest = (await deps.harness.read(project))?.manifest ?? null;
      if (manifest === null) return [];
      const stored: CheckRun[] = [];
      await deps.runner.run({
        root,
        checks: manifest.checks,
        projectId: project.id,
        runId,
        agentRunId,
        signal: controllerFor(runId).signal,
        onResult: (result) => {
          try {
            const { id: _runnerId, ...input } = result;
            stored.push(deps.reviewLoop.checkCommits.insert({ ...input, commit }));
          } catch (error) {
            logger.log('error', 'check result not stored', { runId, ...errorFields(error) });
          }
          publish(project.id, runId);
        },
      });
      logger.log('info', 'commit checks finished', {
        runId,
        agentRunId,
        target: agentRunId === null ? 'ticket-tip' : 'change',
        checks: stored.length,
        failed: stored.filter((r) => r.status !== 'passed').length,
      });
      return stored;
    } finally {
      running.delete(key);
      if (agentRunId !== null) running.delete(agentRunId);
      if (checkout !== undefined) {
        await deps.checkouts.removeCheckout(checkout).catch((error: unknown) => {
          logger.log('warn', 'check checkout removal failed', { runId, ...errorFields(error) });
        });
      }
    }
  }

  async function gateForCommit(
    runId: string,
    agentRunId: string | null,
    commit: string,
  ): Promise<CommitGate> {
    const state = deps.control.peek(runId);
    const project =
      state === undefined ? undefined : deps.repos.projects.getById(state.run.projectId);
    const manifest =
      project === undefined ? null : ((await deps.harness.read(project))?.manifest ?? null);
    const required = (manifest?.checks ?? []).filter((c) => c.required);
    const latest = new Map(
      deps.reviewLoop.checkCommits
        .latestForCommit(runId, agentRunId, commit)
        .map((r) => [r.checkId, r]),
    );
    const missing: string[] = [];
    const failedRequired: string[] = [];
    for (const check of required) {
      const result = latest.get(check.id);
      if (result === undefined) missing.push(check.name);
      // Fail closed: failed, timed out, errored or skipped are not a pass.
      else if (result.status !== 'passed') failedRequired.push(check.name);
    }
    return {
      passed: missing.length === 0 && failedRequired.length === 0,
      failedRequired,
      missing,
      running: running.has(commitKey(runId, agentRunId, commit)),
    };
  }

  return {
    runForAgent,
    runOnCommit,
    gateForCommit,

    startOnCommit(runId, agentRunId, commit, onFinished) {
      if (closed) return;
      const task = (async () => {
        let result: CommitChecksResult;
        try {
          await runOnCommit(runId, agentRunId, commit);
          const gate = await gateForCommit(runId, agentRunId, commit);
          result = {
            commit,
            requiredPassed: gate.passed,
            failed: [...gate.failedRequired, ...gate.missing],
          };
        } catch (error) {
          const code = error instanceof HttpError ? error.code : errorFields(error).errorName;
          logger.log('warn', 'commit checks not run', { runId, agentRunId, code });
          // Never a pass by default: the checks did not run, so the gate stays closed.
          result = { commit, requiredPassed: false, failed: ['The checks could not run'] };
        }
        if (closed) return;
        try {
          onFinished(result);
        } catch (error) {
          logger.log('error', 'commit checks callback failed', { runId, ...errorFields(error) });
        }
      })();
      tasks.add(task);
      void task.finally(() => tasks.delete(task));
    },

    runOnReview(runId) {
      const state = deps.control.peek(runId);
      if (state === undefined || closed) return;
      const workers = state.agents.filter(
        (a) => hasReviewableChange(a.kind) && a.review === 'pending',
      );
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
