import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import {
  HarnessCheckSchema,
  HarnessSetupStepSchema,
  type CheckRun,
  type CheckRunStatus,
  type HarnessCheck,
  type HarnessSetupStep,
  type SetupRun,
} from '@acp/core';
import { managedAgentEnv } from '../control/env.js';
import { errorFields, silentLogger, type Logger } from '../logger.js';
import { OutputTail } from './output.js';
import { realDirectory, resolveInside } from './paths.js';

/**
 * Runs a project's harness checks (ADR-0017 §3, the third allowed process kind after `git` and the
 * SDK's `claude`).
 *
 * - `argv[0]` is a bare command name (`^[a-z0-9][a-z0-9._-]*$`) resolved through `PATH`, started
 *   with the argument array and **no shell**: nothing in the manifest is ever parsed as shell text.
 *   The process is started with `child_process.spawn(file, args, { shell: false })`, the primitive
 *   under `execFile`: `execFile` buffers all output (a chatty test suite could hit its buffer cap
 *   and be killed) and cannot start a process group, so a timeout could not stop grandchildren
 *   such as test workers. Argument handling is identical.
 * - `cwd` is the check's folder, resolved through symlinks, inside the given checkout (an agent's
 *   worktree or the temporary main checkout), never anywhere else.
 * - Each check has its own timeout. On timeout the whole process group gets SIGTERM, then SIGKILL.
 * - One check at a time: a runner serialises every `run` call, across runs and projects.
 * - The environment is the server's without `ACP_*` and `GIT_*` (same filter as managed agents).
 * - Only the last 16 KiB of output is kept, redacted (`OutputTail`).
 *
 * Setup steps (ADR-0027 §1) run with exactly the same policy and through the same queue: in order,
 * the first that does not pass stops the rest, and a step that declares `network: true` is
 * refused (never started) unless the project's "Setup may use the network" switch is on.
 */

/** The spawn options the runner uses; tests assert `shell: false`. */
export interface CheckSpawnOptions {
  cwd: string;
  env: Record<string, string>;
  shell: false;
  stdio: ['ignore', 'pipe', 'pipe'];
  /** Own process group (POSIX), so a timeout can stop the check's child processes too. */
  detached: boolean;
  windowsHide: true;
}

export type CheckSpawnFn = (
  file: string,
  args: string[],
  options: CheckSpawnOptions,
) => ChildProcess;

export interface CheckRunnerDeps {
  spawn?: CheckSpawnFn;
  /** Source environment before filtering; defaults to `process.env`. */
  env?: Readonly<Record<string, string | undefined>>;
  now?: () => Date;
  newId?: () => string;
  /** Time between SIGTERM and SIGKILL after a timeout or stop (default 5 s). */
  killGraceMs?: number;
  logger?: Logger;
}

export interface RunChecksInput {
  /** Absolute path of the checkout the checks run in (worktree root; manifest paths are relative). */
  root: string;
  checks: readonly HarnessCheck[];
  projectId: string;
  /** The orchestration run, or null for "Run checks now" on the main branch. */
  runId: string | null;
  /** The agent whose worktree this is, or null for the main branch. */
  agentRunId: string | null;
  /** Stops the current check and skips the rest (e.g. the run was cancelled). */
  signal?: AbortSignal;
  /** Called as each check finishes, for live progress. */
  onResult?: (result: CheckRun) => void;
}

export interface RunSetupInput {
  /** Absolute path of the worktree or checkout to prepare (manifest paths are relative to it). */
  root: string;
  steps: readonly HarnessSetupStep[];
  /** ADR-0027 §2: the project's `setupNetwork` switch; off refuses a step with `network: true`. */
  networkAllowed: boolean;
  projectId: string;
  runId: string | null;
  agentRunId: string | null;
  /** The commit the worktree or checkout is at, recorded with each step. */
  commit: string | null;
  signal?: AbortSignal;
  onResult?: (result: SetupRun) => void;
}

export interface CheckRunner {
  /** Runs `checks` in order and resolves with one `CheckRun` per check. Never rejects for a check. */
  run(input: RunChecksInput): Promise<CheckRun[]>;
  /**
   * ADR-0027 §1: runs the setup steps in order until one does not pass (failed, timed out,
   * errored, refused, interrupted) and resolves with one `SetupRun` per step that was tried.
   * Never rejects for a step.
   */
  runSetup(input: RunSetupInput): Promise<SetupRun[]>;
}

/** The plain reason a network step was not run (ADR-0027 §2). */
export const NETWORK_REFUSED_NOTE =
  'Not run: this step uses the network, and the project setting "Setup may use the network" is off.';

/**
 * The abort reason the check service passes when the app shuts down (WG-F3). Checks it stops are
 * stored as `interrupted`, not as a result: the merge gates run them again after the restart. Any
 * other abort (the run was stopped) keeps its results, `error` and `skipped`, which block.
 */
export class ChecksShutdown extends Error {
  constructor() {
    super('The app is shutting down');
    this.name = 'ChecksShutdown';
  }
}

const byShutdown = (signal: AbortSignal | undefined): boolean =>
  signal?.reason instanceof ChecksShutdown;

const DEFAULT_KILL_GRACE_MS = 5000;
const BARE_COMMAND = /^[a-z0-9][a-z0-9._-]*$/;

const defaultSpawn: CheckSpawnFn = (file, args, options) => nodeSpawn(file, args, options);

export function createCheckRunner(deps: CheckRunnerDeps = {}): CheckRunner {
  const spawn = deps.spawn ?? defaultSpawn;
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? randomUUID;
  const killGraceMs = deps.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const logger = deps.logger ?? silentLogger;
  const posix = process.platform !== 'win32';
  let queue: Promise<unknown> = Promise.resolve();

  async function runAll(input: RunChecksInput): Promise<CheckRun[]> {
    const results: CheckRun[] = [];
    let root: string | null = null;
    let rootProblem: string | null = null;
    try {
      root = await realDirectory(input.root);
    } catch {
      rootProblem = 'The checkout to run the checks in does not exist.';
    }
    const env = managedAgentEnv(deps.env ?? process.env);
    for (const check of input.checks) {
      const startedAt = now().toISOString();
      const base = {
        id: newId(),
        runId: input.runId,
        agentRunId: input.agentRunId,
        projectId: input.projectId,
        checkId: check.id,
        name: check.name,
        required: check.required,
        startedAt,
      };
      let result: CheckRun;
      if (input.signal?.aborted === true) {
        result = byShutdown(input.signal)
          ? finished(base, 'interrupted', null, 0, 'Not run: the app stopped. It runs again.')
          : finished(base, 'skipped', null, 0, 'Not run: the run was stopped.');
      } else if (root === null) {
        result = finished(base, 'error', null, 0, rootProblem ?? 'No checkout.');
      } else {
        result = await runOne(check, root, env, base, input.signal);
      }
      results.push(result);
      input.onResult?.(result);
    }
    return results;
  }

  type Outcome = Pick<CheckRun, 'exitCode' | 'durationMs' | 'outputTail'> & {
    status: 'passed' | 'failed' | 'timed-out' | 'error' | 'interrupted';
  };

  const done = (
    status: Outcome['status'],
    exitCode: number | null,
    durationMs: number,
    note: string,
  ): Outcome => ({ status, exitCode, durationMs, outputTail: new OutputTail().finish([note]) });

  /** One command with the ADR-0017 §3 policy (checks and setup steps alike). */
  async function runCommand(
    spec: { argv: readonly string[]; cwd?: string | undefined; timeoutSec: number },
    root: string,
    env: Record<string, string>,
    signal: AbortSignal | undefined,
    what: string,
  ): Promise<Outcome> {
    const argv0 = spec.argv[0];
    if (argv0 === undefined || !BARE_COMMAND.test(argv0)) {
      return done('error', null, 0, `This ${what} is not valid and was not run.`);
    }
    const cwd = await resolveInside(root, spec.cwd ?? '.');
    if (cwd === null || !(await isDirectory(cwd))) {
      return done(
        'error',
        null,
        0,
        `The ${what}'s folder (${spec.cwd ?? '.'}) does not exist inside the checkout.`,
      );
    }

    const started = performance.now();
    const tail = new OutputTail();
    let child: ChildProcess;
    try {
      child = spawn(argv0, spec.argv.slice(1), {
        cwd,
        env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: posix,
        windowsHide: true,
      });
    } catch (error) {
      logger.log('warn', 'harness.check_spawn_failed', errorFields(error));
      return done('error', null, 0, `The command '${argv0}' could not be started.`);
    }

    return new Promise<Outcome>((resolve) => {
      let settled = false;
      let stoppedBy: 'timeout' | 'abort' | null = null;
      let spawnError: (Error & { code?: unknown }) | null = null;
      const timers: NodeJS.Timeout[] = [];

      const settle = (code: number | null, sig: NodeJS.Signals | null): void => {
        if (settled) return;
        settled = true;
        for (const t of timers) clearTimeout(t);
        signal?.removeEventListener('abort', onAbort);
        child.stdout?.destroy();
        child.stderr?.destroy();
        const durationMs = Math.max(0, Math.round(performance.now() - started));
        const notes: string[] = [];
        let status: Outcome['status'];
        let exitCode: number | null = null;
        if (spawnError !== null) {
          status = 'error';
          notes.push(
            spawnError.code === 'ENOENT'
              ? `The command '${argv0}' was not found on PATH.`
              : `The command '${argv0}' could not be started.`,
          );
        } else if (stoppedBy === 'timeout') {
          status = 'timed-out';
          notes.push(`Stopped after ${spec.timeoutSec} s: the time limit was reached.`);
        } else if (stoppedBy === 'abort' && byShutdown(signal)) {
          status = 'interrupted';
          notes.push('Stopped when the app stopped, so there is no result. It runs again.');
        } else if (stoppedBy === 'abort') {
          status = 'error';
          notes.push('Stopped before it finished: the run was stopped.');
        } else if (code === 0) {
          status = 'passed';
          exitCode = 0;
        } else {
          status = 'failed';
          exitCode = code;
          if (code === null && sig !== null) notes.push(`The command was ended by signal ${sig}.`);
        }
        resolve({ status, exitCode, durationMs, outputTail: tail.finish(notes) });
      };

      const kill = (sig: NodeJS.Signals): void => {
        const pid = child.pid;
        try {
          // A negative pid signals the whole process group the command leads (detached above).
          if (posix && pid !== undefined) process.kill(-pid, sig);
          else child.kill(sig);
        } catch {
          // Already gone.
        }
      };
      const stop = (why: 'timeout' | 'abort'): void => {
        if (settled || stoppedBy !== null) return;
        stoppedBy = why;
        kill('SIGTERM');
        timers.push(
          setTimeout(() => {
            kill('SIGKILL');
            // If something still holds the pipes open, give up waiting for them.
            timers.push(setTimeout(() => settle(null, 'SIGKILL'), killGraceMs));
          }, killGraceMs),
        );
      };
      const onAbort = (): void => stop('abort');

      child.stdout?.on('data', (chunk: Buffer) => tail.push(chunk));
      child.stderr?.on('data', (chunk: Buffer) => tail.push(chunk));
      child.on('error', (error: Error & { code?: unknown }) => {
        // Only a failed start reaches here before exit; later errors (a failed kill) are ignored.
        if (child.pid === undefined) {
          spawnError = error;
          settle(null, null);
        }
      });
      child.on('close', (code, sig) => settle(code, sig));
      timers.push(setTimeout(() => stop('timeout'), spec.timeoutSec * 1000));
      if (signal !== undefined) {
        if (signal.aborted) stop('abort');
        else signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  async function runOne(
    check: HarnessCheck,
    root: string,
    env: Record<string, string>,
    base: Omit<CheckRun, 'status' | 'exitCode' | 'durationMs' | 'outputTail'>,
    signal: AbortSignal | undefined,
  ): Promise<CheckRun> {
    // Defence in depth: the manifest was validated when read, but the runner never trusts that.
    if (!HarnessCheckSchema.safeParse(check).success) {
      return finished(base, 'error', null, 0, 'This check is not valid and was not run.');
    }
    return { ...base, ...(await runCommand(check, root, env, signal, 'check')) };
  }

  async function setupAll(input: RunSetupInput): Promise<SetupRun[]> {
    const results: SetupRun[] = [];
    let root: string | null;
    try {
      root = await realDirectory(input.root);
    } catch {
      root = null;
    }
    const env = managedAgentEnv(deps.env ?? process.env);
    for (const step of input.steps) {
      const base = {
        id: newId(),
        projectId: input.projectId,
        runId: input.runId,
        agentRunId: input.agentRunId,
        stepId: step.id,
        name: step.name,
        startedAt: now().toISOString(),
        commit: input.commit,
      };
      let outcome: Omit<SetupRun, keyof typeof base>;
      if (input.signal?.aborted === true) {
        outcome = byShutdown(input.signal)
          ? done('interrupted', null, 0, 'Not run: the app stopped.')
          : done('error', null, 0, 'Not run: the run was stopped.');
      } else if (root === null) {
        outcome = done('error', null, 0, 'The checkout to prepare does not exist.');
      } else if (!HarnessSetupStepSchema.safeParse(step).success) {
        outcome = done('error', null, 0, 'This setup step is not valid and was not run.');
      } else if (step.network === true && !input.networkAllowed) {
        // ADR-0027 §2: never started, so nothing reached the network.
        outcome = {
          status: 'refused',
          exitCode: null,
          durationMs: 0,
          outputTail: new OutputTail().finish([NETWORK_REFUSED_NOTE]),
        };
      } else {
        outcome = await runCommand(step, root, env, input.signal, 'setup step');
      }
      const result: SetupRun = { ...base, ...outcome };
      results.push(result);
      input.onResult?.(result);
      // The first step that does not pass stops the setup (ADR-0027 §1).
      if (result.status !== 'passed') break;
    }
    return results;
  }

  return {
    run(input) {
      const next = queue.then(() => runAll(input));
      // The queue continues whatever happens to one call.
      queue = next.catch(() => undefined);
      return next;
    },
    runSetup(input) {
      // The same queue as checks: one command at a time across runs and projects.
      const next = queue.then(() => setupAll(input));
      queue = next.catch(() => undefined);
      return next;
    },
  };
}

function finished(
  base: Omit<CheckRun, 'status' | 'exitCode' | 'durationMs' | 'outputTail'>,
  status: CheckRunStatus,
  exitCode: number | null,
  durationMs: number,
  note: string,
): CheckRun {
  return { ...base, status, exitCode, durationMs, outputTail: new OutputTail().finish([note]) };
}

/**
 * ADR-0027 §1: the checks of a checkout whose setup did not pass, recorded as not run (`skipped`,
 * which never counts as a pass) with a plain note saying why. When the app stopped during the
 * setup they are `interrupted` instead (WG-F3: no result, so the merge gates run them again).
 */
export function checksNotRun(
  input: Pick<RunChecksInput, 'checks' | 'projectId' | 'runId' | 'agentRunId'>,
  failedStep: Pick<SetupRun, 'name' | 'status' | 'exitCode'>,
  now: () => Date = () => new Date(),
  newId: () => string = randomUUID,
): CheckRun[] {
  const status = failedStep.status === 'interrupted' ? 'interrupted' : 'skipped';
  const note = `Not run: ${setupFailureNote(failedStep)}`;
  return input.checks.map((check) =>
    finished(
      {
        id: newId(),
        runId: input.runId,
        agentRunId: input.agentRunId,
        projectId: input.projectId,
        checkId: check.id,
        name: check.name,
        required: check.required,
        startedAt: now().toISOString(),
      },
      status,
      null,
      0,
      note,
    ),
  );
}

/** The plain sentence for a setup step that did not pass (the ticket, the lead, skipped checks). */
export function setupFailureNote(failed: Pick<SetupRun, 'name' | 'status' | 'exitCode'>): string {
  const how =
    failed.status === 'refused'
      ? 'was not run: it uses the network, and "Setup may use the network" is off'
      : failed.status === 'timed-out'
        ? 'timed out'
        : failed.status === 'failed'
          ? `failed${failed.exitCode === null ? '' : ` (exit ${failed.exitCode})`}`
          : failed.status === 'interrupted'
            ? 'was interrupted'
            : 'could not run';
  return `Setup step '${failed.name}' ${how}.`;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
