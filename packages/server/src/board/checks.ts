import {
  checkRunWasInterrupted,
  type CheckRun,
  type HarnessCheck,
  type Project,
  type SetupRun,
  type WorkflowProgram,
} from '@acp/core';
import type { StreamNoticeDto } from '@acp/core/api';
import type {
  HarnessRepositories,
  Repositories,
  ReviewLoopRepositories,
  WorkspaceRepositories,
} from '@acp/db';
import { isActiveAgentStatus, isLiveAgentStatus, programOf } from '@acp/orchestrator';
import { hasReviewableChange } from '../control/roles.js';
import type { ControlService, ReviewGate } from '../control/service.js';
import { HttpError, notFound } from '../errors.js';
import {
  ChecksShutdown,
  HarnessError,
  MAIN_SPEC,
  branchSpec,
  checksNotRun,
  checksToGate,
  checksToRun,
  mergeSpec,
  setupFailureNote,
  type CheckRunner,
  type CheckSpec,
  type MainChecks,
} from '../harness/index.js';
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
 * - Stopping a run stops its running check and skips the rest. Stopping the app does too, but
 *   stores them as `interrupted` (no result), so the merge gates run them again (WG-F3).
 * - ADR-0027: each result is stored with where it ran (`place`) and the Checks block that ran it;
 *   what runs and what gates at each place is a `CheckSpec` (harness/blocks.ts). The setup steps
 *   run in every new editing agent's worktree before it starts (`setupWorktree`) and in every
 *   fresh check checkout (the ticket branch tip, main) before its checks; each step is stored
 *   (`setup_runs`). A checkout whose setup did not pass records its checks as not run.
 */

export interface CheckService {
  /** Runs the checks in one helper's worktree now and returns the stored results. */
  runForAgent(runId: string, agentRunId: string): Promise<CheckRun[]>;
  /** In the background: every helper of the run whose changes wait for review. */
  runOnReview(runId: string): void;
  /** "Run checks now" on the project's main branch (a temporary checkout): setup, then checks. */
  runOnMain(projectId: string): Promise<CheckRun[]>;
  /** ADR-0027: setup runs before "Run checks now" on main, newest first. */
  mainSetupHistory(projectId: string, limit?: number): SetupRun[];
  /**
   * ADR-0027 §1: runs the project's setup steps (from the owner's checkout) in a new editing
   * agent's worktree before it starts, storing each step. Never throws for a step.
   */
  setupWorktree(input: WorktreeSetupInput): Promise<WorktreeSetup>;
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
  runOnCommit(
    runId: string,
    agentRunId: string | null,
    commit: string,
    spec?: CheckSpec,
    options?: CommitChecksOptions,
  ): Promise<CheckRun[]>;
  /**
   * ADR-0021 merge gate: the required checks' latest results **on this commit** only. Results on
   * any other commit (an earlier seal, another round) never count.
   */
  gateForCommit(
    runId: string,
    agentRunId: string | null,
    commit: string,
    spec?: CheckSpec,
  ): Promise<CommitGate>;
  /**
   * In the background: `runOnCommit`, then `onFinished` with the gate's verdict (also when the
   * checks could not run: then `requiredPassed` is false and `failed` names why in plain words).
   */
  startOnCommit(
    runId: string,
    agentRunId: string | null,
    commit: string,
    onFinished: (result: CommitChecksResult) => void,
    spec?: CheckSpec,
    options?: CommitChecksOptions,
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
  /** ADR-0027: the latest result of each gated check on the commit (for failure details). */
  results?: readonly CheckRun[];
}

export interface CommitChecksOptions {
  /** Checks whose latest result on this commit already passed are not run again. */
  skipPassed?: boolean;
}

export interface WorktreeSetupInput {
  runId: string;
  agentRunId: string;
  projectId: string;
  /** The agent's project folder inside its worktree (manifest paths are relative to it). */
  cwd: string;
  /** The commit the new worktree is at. */
  commit: string | null;
}

/** What the worktree's setup came to (ADR-0027 §1). */
export type WorktreeSetup =
  | {
      ok: true;
      /** The project has a valid harness file (the agent's brief then lists setup and checks). */
      hasHarness: boolean;
      /** The setup steps that ran, by name, in order. */
      ran: readonly string[];
      /** The harness file's checks, as declared, for the brief. */
      checks: readonly HarnessCheck[];
    }
  | {
      ok: false;
      reason: string;
      /** The end of the failed step's output (redacted). */ outputTail?: string;
    };

export interface CheckServiceDeps {
  repos: Pick<Repositories, 'projects' | 'events'>;
  workspace: Pick<WorkspaceRepositories, 'checkRuns' | 'tickets' | 'projectSetup'>;
  /** ADR-0027: setup runs (migration 0010). */
  harnessRepos: HarnessRepositories;
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

  function store(result: CheckRun, spec?: CheckSpec): CheckRun {
    const { id: _runnerId, ...input } = result;
    return deps.workspace.checkRuns.insert(
      spec === undefined ? input : { ...input, place: spec.place, blockNodeId: spec.blockNodeId },
    );
  }

  function storeSetup(result: SetupRun): void {
    const { id: _runnerId, ...input } = result;
    try {
      deps.harnessRepos.setupRuns.insert(input);
    } catch (error) {
      logger.log('error', 'setup result not stored', {
        runId: result.runId,
        ...errorFields(error),
      });
    }
  }

  /** ADR-0027 §2: the owner's switch for network setup steps (off when never set). */
  function networkAllowed(projectId: string): boolean {
    return deps.workspace.projectSetup.get(projectId)?.setupNetwork === true;
  }

  /** The default spec of a commit's checks: the merge block for a change, the branch for a tip. */
  function defaultSpec(runId: string, agentRunId: string | null): CheckSpec {
    const state = deps.control.peek(runId);
    let program: WorkflowProgram | null;
    try {
      program = state === undefined ? null : programOf(state);
    } catch {
      // A stored graph the validator now refuses: the old defaults (every required check).
      program = null;
    }
    return agentRunId === null ? branchSpec(program) : mergeSpec(program);
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
    specIn?: CheckSpec,
    options: CommitChecksOptions = {},
  ): Promise<CheckRun[]> {
    const spec = specIn ?? defaultSpec(runId, agentRunId);
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
      let checks = checksToRun(manifest, spec);
      if (options.skipPassed === true) {
        const passed = new Set(
          deps.reviewLoop.checkCommits
            .latestForCommit(runId, agentRunId, commit)
            .filter((r) => r.status === 'passed')
            .map((r) => r.checkId),
        );
        checks = checks.filter((c) => !passed.has(c.id));
      }
      if (checks.length === 0) return [];
      const stored: CheckRun[] = [];
      const keep = (result: CheckRun): void => {
        try {
          const { id: _runnerId, ...input } = result;
          stored.push(
            deps.reviewLoop.checkCommits.insert({
              ...input,
              commit,
              place: spec.place,
              blockNodeId: spec.blockNodeId,
            }),
          );
        } catch (error) {
          logger.log('error', 'check result not stored', { runId, ...errorFields(error) });
        }
        publish(project.id, runId);
      };
      const signal = controllerFor(runId).signal;
      // ADR-0027 §1: a fresh checkout (the ticket branch tip) is set up before its checks; an
      // agent's worktree was set up when the agent started.
      if (checkout !== undefined) {
        const failed = await setupIn(project, checkout.cwd, runId, null, commit, signal);
        if (failed !== null) {
          const notRun = checksNotRun({ checks, projectId: project.id, runId, agentRunId }, failed);
          for (const r of notRun) keep(r);
          logger.log('info', 'commit checks not run: setup failed', { runId, agentRunId });
          return stored;
        }
      }
      await deps.runner.run({
        root,
        checks,
        projectId: project.id,
        runId,
        agentRunId,
        signal,
        onResult: keep,
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
    specIn?: CheckSpec,
  ): Promise<CommitGate> {
    return (await gateDetails(runId, agentRunId, commit, specIn)).gate;
  }

  /** The gate, and the latest result of each gated check on the commit (failure details). */
  async function gateDetails(
    runId: string,
    agentRunId: string | null,
    commit: string,
    specIn?: CheckSpec,
  ): Promise<{ gate: CommitGate; results: CheckRun[] }> {
    const spec = specIn ?? defaultSpec(runId, agentRunId);
    const state = deps.control.peek(runId);
    const project =
      state === undefined ? undefined : deps.repos.projects.getById(state.run.projectId);
    const manifest =
      project === undefined ? null : ((await deps.harness.read(project))?.manifest ?? null);
    const required = manifest === null ? [] : checksToGate(manifest, spec);
    const latest = new Map(
      deps.reviewLoop.checkCommits
        .latestForCommit(runId, agentRunId, commit)
        .map((r) => [r.checkId, r]),
    );
    const missing: string[] = [];
    const failedRequired: string[] = [];
    for (const check of required) {
      const result = latest.get(check.id);
      // WG-F3: a check the app's shutdown stopped has no result on this commit, like one that
      // never ran, so the merge starts the checks again instead of refusing it as failed.
      if (result === undefined || checkRunWasInterrupted(result)) missing.push(check.name);
      // Fail closed: failed, timed out, errored or skipped are not a pass.
      else if (result.status !== 'passed') failedRequired.push(check.name);
    }
    return {
      gate: {
        passed: missing.length === 0 && failedRequired.length === 0,
        failedRequired,
        missing,
        running: running.has(commitKey(runId, agentRunId, commit)),
      },
      results: required.flatMap((c) => {
        const r = latest.get(c.id);
        return r === undefined ? [] : [r];
      }),
    };
  }

  /**
   * Runs the project's setup steps in `root`, storing each; null when they all passed (or there
   * are none), else the first step that did not.
   */
  async function setupIn(
    project: Project,
    root: string,
    runId: string | null,
    agentRunId: string | null,
    commit: string | null,
    signal: AbortSignal | undefined,
  ): Promise<SetupRun | null> {
    const manifest = (await deps.harness.read(project))?.manifest ?? null;
    const steps = manifest?.setup ?? [];
    if (steps.length === 0) return null;
    const results = await deps.runner.runSetup({
      root,
      steps,
      networkAllowed: networkAllowed(project.id),
      projectId: project.id,
      runId,
      agentRunId,
      commit,
      ...(signal !== undefined && { signal }),
      onResult: (r) => {
        storeSetup(r);
        if (runId !== null) publish(project.id, runId);
      },
    });
    const failed = results.find((r) => r.status !== 'passed');
    return failed ?? null;
  }

  return {
    runForAgent,
    runOnCommit,
    gateForCommit,

    async setupWorktree(input) {
      const project = deps.repos.projects.getById(input.projectId);
      if (project === undefined) return { ok: false, reason: 'The project is gone.' };
      let manifest = null;
      try {
        manifest = (await deps.harness.read(project))?.manifest ?? null;
      } catch (error) {
        logger.log('warn', 'harness unreadable for setup', errorFields(error));
      }
      if (manifest === null) return { ok: true, hasHarness: false, ran: [], checks: [] };
      const failed = await setupIn(
        project,
        input.cwd,
        input.runId,
        input.agentRunId,
        input.commit,
        controllerFor(input.runId).signal,
      );
      if (failed !== null) {
        logger.log('info', 'worktree setup did not pass', {
          runId: input.runId,
          agentRunId: input.agentRunId,
        });
        return { ok: false, reason: setupFailureNote(failed), outputTail: failed.outputTail };
      }
      return {
        ok: true,
        hasHarness: true,
        ran: (manifest.setup ?? []).map((s) => s.name),
        checks: manifest.checks,
      };
    },

    mainSetupHistory(projectId, limit = 50) {
      if (deps.repos.projects.getById(projectId) === undefined) {
        throw notFound(`Project ${projectId} not found`);
      }
      return deps.harnessRepos.setupRuns.listForProjectMain(projectId, { limit });
    },

    startOnCommit(runId, agentRunId, commit, onFinished, spec, options) {
      if (closed) return;
      const task = (async () => {
        let result: CommitChecksResult;
        try {
          await runOnCommit(runId, agentRunId, commit, spec, options);
          const { gate, results } = await gateDetails(runId, agentRunId, commit, spec);
          result = {
            commit,
            requiredPassed: gate.passed,
            failed: [...gate.failedRequired, ...gate.missing],
            // Failure details only (ADR-0027 §5: what a change block sends back).
            ...(!gate.passed && { results }),
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
        const result = await deps.mainChecks.run({
          projectRoot: project.rootPath,
          projectId,
          setupNetwork: networkAllowed(projectId),
          onSetupResult: storeSetup,
        });
        const stored = result.results.map((r) => store(r, MAIN_SPEC));
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
      // Fail closed: a required check that did not pass (failed, timed out, errored, skipped
      // because the run was stopped, or interrupted by a shutdown) blocks a plain merge. This
      // legacy gate (runs from before ADR-0021) has no "not run yet" state to start them again;
      // the owner runs the checks again from the ticket page, or merges anyway.
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
      // The reason marks what the checks stop with as `interrupted`, not failed (WG-F3).
      for (const c of controllers.values()) c.abort(new ChecksShutdown());
      controllers.clear();
      while (tasks.size > 0) await Promise.allSettled([...tasks]);
    },
  };
}
