import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ManagedExecutionAdapter } from '@acp/core';
import {
  CSRF_HEADER,
  CsrfTokenDtoSchema,
  RunDetailDtoSchema,
  type ProjectDto,
  type RunDetailDto,
} from '@acp/core/api';
import { openDatabase } from '@acp/db';
import { startServer, type RunningServer, type StartOptions } from '../../../src/bootstrap.js';
import { loadConfig } from '../../../src/config.js';
import type { Logger } from '../../../src/logger.js';
import { createGitRunner } from '../../../src/workspace/index.js';

/*
 * P3-F verification harness. Deliberately free of vitest imports so the Playwright entry script
 * (`e2e-server.ts`) can use it under plain Node too. It starts the real server composition
 * (`startServer`) on 127.0.0.1 with a temp data dir, a throwaway `git init` repository registered
 * as a project, and an injected managed adapter, so the Agent SDK and the real `claude` binary are
 * never started. Git never sees the owner's config or this checkout's repository.
 */

export const GIT_ENV: Readonly<Record<string, string>> = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};

export function makeTempDir(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  return { ...env, ...GIT_ENV, LC_ALL: 'C' };
}

/** Test-side git (argument arrays, no shell), for arranging and inspecting the throwaway repo. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=Test Owner', '-c', 'user.email=owner@example.invalid', ...args],
    { cwd, env: gitEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

/** A synthetic repo on `main` with one commit. */
export function makeRepo(
  files: Record<string, string> = { 'README.md': 'hello\n', 'src/app.ts': 'export {};\n' },
): string {
  const repo = makeTempDir('acp-p3f-repo-');
  git(repo, 'init', '--quiet', '-b', 'main');
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  git(repo, 'add', '--all');
  git(repo, 'commit', '--quiet', '-m', 'initial');
  return repo;
}

/** A file's content on a ref of the repo, or null when it is not there. */
export function showFile(repo: string, ref: string, path: string): string | null {
  try {
    return git(repo, 'show', `${ref}:${path}`);
  } catch {
    return null;
  }
}

export interface BootOptions {
  mode: 'demo' | 'live';
  dataDir: string;
  adapter: ManagedExecutionAdapter;
  logger: Logger;
  port?: number;
  staticDir?: string;
  /** Live mode only: an (empty) temp Claude dir, never the real ~/.claude. */
  claudeDir?: string;
  control?: StartOptions['control'];
  board?: StartOptions['board'];
}

export interface Booted {
  server: RunningServer;
  base: string;
  csrf: string;
  get(path: string): Promise<{ status: number; body: unknown }>;
  post(path: string, body?: unknown): Promise<{ status: number; body: unknown }>;
}

export async function boot(options: BootOptions): Promise<Booted> {
  if (options.mode === 'live' && options.claudeDir === undefined) {
    throw new Error('live mode needs a temp claudeDir');
  }
  const config = loadConfig({
    ACP_MODE: options.mode,
    ACP_DATA_DIR: options.dataDir,
    ACP_PORT: String(options.port ?? 7441),
    // Live mode polls only this temp dir; demo mode never reads a Claude dir.
    ACP_CLAUDE_DIR: options.claudeDir ?? join(options.dataDir, 'no-claude-dir'),
    ACP_POLL_INTERVAL_MS: '1000',
  });
  const server = await startServer({
    config,
    port: options.port ?? 0,
    logger: options.logger,
    managedAdapter: options.adapter,
    git: createGitRunner({ env: GIT_ENV }),
    ...(options.staticDir !== undefined && { staticDir: options.staticDir }),
    ...(options.control !== undefined && { control: options.control }),
    ...(options.board !== undefined && { board: options.board }),
  });
  const base = `http://127.0.0.1:${server.port}`;
  const read = async (res: Response) => ({
    status: res.status,
    body: res.status === 204 ? null : await res.json(),
  });
  const get = async (path: string) => read(await fetch(`${base}${path}`));
  const token = await get('/api/control/token');
  const csrf = token.status === 200 ? CsrfTokenDtoSchema.parse(token.body).token : '';
  const post = async (path: string, body?: unknown) =>
    read(
      await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [CSRF_HEADER]: csrf },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      }),
    );
  return { server, base, csrf, get, post };
}

/** Registers the throwaway repo as a project through the public route (or finds it). */
export async function registerProject(b: Booted, name: string, rootPath: string) {
  const res = await b.post('/api/projects', { name, rootPath });
  if (res.status === 201) return res.body as ProjectDto;
  const list = (await b.get('/api/projects')).body as ProjectDto[];
  const found = list.find((p) => p.rootPath === rootPath);
  if (found === undefined) throw new Error(`project registration failed: ${res.status}`);
  return found;
}

/** Polls until `check` returns a value (not undefined), or fails after `timeoutMs`. */
export async function waitFor<T>(
  check: () => Promise<T | undefined> | T | undefined,
  what: string,
  timeoutMs = 5_000,
): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Every row of every table, as one string (content-minimization assertions). */
export function dumpDatabase(path: string): string {
  const db = openDatabase(path);
  try {
    const tables = db.connection
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .pluck()
      .all() as string[];
    return tables
      .map((t) => `${t}: ${JSON.stringify(db.connection.prepare(`SELECT * FROM "${t}"`).all())}`)
      .join('\n');
  } finally {
    db.close();
  }
}

/** Polls `GET /api/runs/:id` until `ready(run)` holds. */
export async function waitForRun(
  b: Booted,
  runId: string,
  ready: (run: RunDetailDto) => boolean,
  what: string,
): Promise<RunDetailDto> {
  return waitFor(async () => {
    const run = RunDetailDtoSchema.parse((await b.get(`/api/runs/${runId}`)).body);
    return ready(run) ? run : undefined;
  }, what);
}
