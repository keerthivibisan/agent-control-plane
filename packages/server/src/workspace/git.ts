import { execFile as nodeExecFile } from 'node:child_process';
import { GitCommandError } from './errors.js';

/**
 * The only process the workspace manager starts is `git`, through `execFile` with an argument
 * array and no shell (ADR-0013 §1). Ids, paths and commit messages are separate arguments, so no
 * text from the chat, the model or a file is ever parsed by a shell.
 */

export interface GitRunOptions {
  cwd: string;
  /**
   * Cut stdout at this many bytes instead of failing (used for review diffs). Without it, output
   * over the hard limit is an error.
   */
  maxOutputBytes?: number;
}

export interface GitResult {
  stdout: string;
  truncated: boolean;
}

/** Runs `git <args>`; rejects with `GitCommandError` on a non-zero exit. */
export type GitRunner = (args: readonly string[], options: GitRunOptions) => Promise<GitResult>;

export interface ExecFileOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  maxBuffer: number;
  timeout: number;
  encoding: 'buffer';
  shell: false;
  windowsHide: true;
}

type ExecFileCallback = (
  error: (Error & { code?: string | number | null }) | null,
  stdout: Buffer,
  stderr: Buffer,
) => void;

/** The subset of `child_process.execFile` used here; injectable so tests can assert its calls. */
export type ExecFileFn = (
  file: string,
  args: string[],
  options: ExecFileOptions,
  callback: ExecFileCallback,
) => void;

const defaultExecFile: ExecFileFn = (file, args, options, callback) => {
  nodeExecFile(file, args, options, callback);
};

/** Large enough for any manifest; a review diff uses `maxOutputBytes` instead. */
const HARD_OUTPUT_LIMIT = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;

export interface GitRunnerOptions {
  execFile?: ExecFileFn;
  /**
   * Extra environment for git (tests isolate from the global git config with
   * `GIT_CONFIG_GLOBAL`). Inherited `GIT_*` variables are always dropped first, so a server
   * started from inside a git hook cannot redirect commands to another repository.
   */
  env?: Readonly<Record<string, string>>;
  timeoutMs?: number;
}

export function createGitRunner(options: GitRunnerOptions = {}): GitRunner {
  const execFile = options.execFile ?? defaultExecFile;
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_')) env[key] = value;
  }
  Object.assign(env, {
    // Never wait for credentials or an editor; nothing here should need either.
    GIT_TERMINAL_PROMPT: '0',
    // `git status` in the owner's project must not take the index lock behind their back.
    GIT_OPTIONAL_LOCKS: '0',
    LC_ALL: 'C',
    ...options.env,
  });
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return (args, { cwd, maxOutputBytes }) =>
    new Promise<GitResult>((resolve, reject) => {
      const limit = maxOutputBytes ?? HARD_OUTPUT_LIMIT;
      execFile(
        'git',
        [...args],
        {
          cwd,
          env,
          maxBuffer: limit,
          timeout,
          encoding: 'buffer',
          shell: false,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (error === null) {
            resolve({ stdout: stdout.toString('utf8'), truncated: false });
            return;
          }
          if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' && maxOutputBytes !== undefined) {
            resolve({ stdout: cutAtLine(stdout, maxOutputBytes), truncated: true });
            return;
          }
          reject(
            new GitCommandError(
              subcommandOf(args),
              typeof error.code === 'number' ? error.code : null,
              stderr.toString('utf8'),
            ),
          );
        },
      );
    });
}

/** Cuts at the last complete line within the cap, so a truncated diff never ends mid-character. */
function cutAtLine(buffer: Buffer, maxBytes: number): string {
  const head = buffer.subarray(0, maxBytes);
  const lastNewline = head.lastIndexOf(0x0a);
  return head.subarray(0, lastNewline === -1 ? 0 : lastNewline + 1).toString('utf8');
}

/** The git subcommand, skipping leading `-c key=value` options; for error messages only. */
export function subcommandOf(args: readonly string[]): string {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-c') {
      i++;
      continue;
    }
    if (arg !== undefined && !arg.startsWith('-')) return arg;
  }
  return 'unknown';
}
