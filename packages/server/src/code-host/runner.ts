import { execFile as nodeExecFile } from 'node:child_process';
import type { ExecFileFn } from '../workspace/index.js';

/**
 * How the server runs a code host's CLI (ADR-0025 §1, ADR-0013 as amended): `execFile` with an
 * argument array and no shell, a time limit, and no prompt ever (`GH_PROMPT_DISABLED=1`,
 * `GIT_TERMINAL_PROMPT=0`). The CLI's stderr is never kept, read or logged: it may quote a token,
 * a user or a path. Stdout is returned only to the caller that parses one known JSON shape or a
 * pull request URL from it; `gh --version` and `gh auth status` are judged by their exit code.
 */

export interface CliRunOptions {
  /** The project folder: the CLI finds the repository from it, like git. */
  cwd: string;
  timeoutMs: number;
  /** Stdout over this many bytes fails the call (no JSON reply this app reads is near it). */
  maxOutputBytes?: number;
}

export interface CliResult {
  /** The exit code; null when the process was killed (a timeout) or never started. */
  exitCode: number | null;
  stdout: string;
  timedOut: boolean;
  /** The executable is not on the PATH (`ENOENT`). */
  notFound: boolean;
}

/** Runs `<file> <args>`; never rejects for a non-zero exit (the caller maps it to a code). */
export type CliRunner = (
  file: string,
  args: readonly string[],
  options: CliRunOptions,
) => Promise<CliResult>;

export interface CliRunnerOptions {
  execFile?: ExecFileFn;
  /** Extra environment (tests put a fake `gh` first on the PATH). */
  env?: Readonly<Record<string, string>>;
}

const DEFAULT_MAX_OUTPUT = 1024 * 1024;

/** The environment for the CLI: the server's, minus `GIT_*`, plus no prompts, colour or pager. */
export function cliEnv(extra: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    // As for git (workspace/git.ts): a server started from a git hook must not redirect commands.
    if (!key.startsWith('GIT_')) env[key] = value;
  }
  return {
    ...env,
    GH_PROMPT_DISABLED: '1',
    GIT_TERMINAL_PROMPT: '0',
    GH_NO_UPDATE_NOTIFIER: '1',
    GH_NO_EXTENSION_UPDATE_NOTIFIER: '1',
    GH_SPINNER_DISABLED: '1',
    GH_PAGER: 'cat',
    NO_COLOR: '1',
    CLICOLOR: '0',
    LC_ALL: 'C',
    ...extra,
  };
}

export function createCliRunner(options: CliRunnerOptions = {}): CliRunner {
  const execFile: ExecFileFn =
    options.execFile ??
    ((file, args, opts, callback) => {
      nodeExecFile(file, args, opts, callback);
    });
  const env = cliEnv(options.env);
  return (file, args, { cwd, timeoutMs, maxOutputBytes }) =>
    new Promise<CliResult>((resolve) => {
      execFile(
        file,
        [...args],
        {
          cwd,
          env,
          maxBuffer: maxOutputBytes ?? DEFAULT_MAX_OUTPUT,
          timeout: timeoutMs,
          encoding: 'buffer',
          shell: false,
          windowsHide: true,
        },
        // `_stderr` is dropped here, unread: nothing the CLI says on stderr leaves this function.
        (error, stdout, _stderr) => {
          if (error === null) {
            resolve({
              exitCode: 0,
              stdout: stdout.toString('utf8'),
              timedOut: false,
              notFound: false,
            });
            return;
          }
          const overflow = error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
          const killed = (error as { killed?: boolean }).killed === true && !overflow;
          resolve({
            exitCode: typeof error.code === 'number' ? error.code : null,
            stdout: '',
            timedOut: killed || error.code === 'ETIMEDOUT',
            notFound: error.code === 'ENOENT',
          });
        },
      );
    });
}
