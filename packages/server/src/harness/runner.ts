import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import {
  HarnessCheckSchema,
  type CheckRun,
  type CheckRunStatus,
  type HarnessCheck,
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

export interface CheckRunner {
  /** Runs `checks` in order and resolves with one `CheckRun` per check. Never rejects for a check. */
  run(input: RunChecksInput): Promise<CheckRun[]>;
}

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
        result = finished(base, 'skipped', null, 0, 'Not run: the checks were stopped.');
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

  async function runOne(
    check: HarnessCheck,
    root: string,
    env: Record<string, string>,
    base: Omit<CheckRun, 'status' | 'exitCode' | 'durationMs' | 'outputTail'>,
    signal: AbortSignal | undefined,
  ): Promise<CheckRun> {
    // Defence in depth: the manifest was validated when read, but the runner never trusts that.
    const valid = HarnessCheckSchema.safeParse(check);
    const argv0 = check.argv[0];
    if (!valid.success || argv0 === undefined || !BARE_COMMAND.test(argv0)) {
      return finished(base, 'error', null, 0, 'This check is not valid and was not run.');
    }
    const cwd = await resolveInside(root, check.cwd ?? '.');
    if (cwd === null || !(await isDirectory(cwd))) {
      return finished(
        base,
        'error',
        null,
        0,
        `The check's folder (${check.cwd ?? '.'}) does not exist inside the checkout.`,
      );
    }

    const started = performance.now();
    const tail = new OutputTail();
    let child: ChildProcess;
    try {
      child = spawn(argv0, check.argv.slice(1), {
        cwd,
        env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: posix,
        windowsHide: true,
      });
    } catch (error) {
      logger.log('warn', 'harness.check_spawn_failed', errorFields(error));
      return finished(base, 'error', null, 0, `The command '${argv0}' could not be started.`);
    }

    return new Promise<CheckRun>((resolve) => {
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
        let status: CheckRunStatus;
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
          notes.push(`Stopped after ${check.timeoutSec} s: the time limit was reached.`);
        } else if (stoppedBy === 'abort') {
          status = 'error';
          notes.push('Stopped before it finished: the checks were stopped.');
        } else if (code === 0) {
          status = 'passed';
          exitCode = 0;
        } else {
          status = 'failed';
          exitCode = code;
          if (code === null && sig !== null) notes.push(`The command was ended by signal ${sig}.`);
        }
        resolve({ ...base, status, exitCode, durationMs, outputTail: tail.finish(notes) });
      };

      const kill = (sig: NodeJS.Signals): void => {
        const pid = child.pid;
        try {
          // A negative pid signals the whole process group the check leads (detached above).
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
      timers.push(setTimeout(() => stop('timeout'), check.timeoutSec * 1000));
      if (signal !== undefined) {
        if (signal.aborted) stop('abort');
        else signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  return {
    run(input) {
      const next = queue.then(() => runAll(input));
      // The queue continues whatever happens to one call.
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

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
