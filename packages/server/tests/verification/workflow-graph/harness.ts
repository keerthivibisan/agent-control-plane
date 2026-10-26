import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ManagedExecutionAdapter } from '@acp/core';
import { CSRF_HEADER, CsrfTokenDtoSchema, ErrorDtoSchema } from '@acp/core/api';
import { startServer, type RunningServer } from '../../../src/bootstrap.js';
import { loadConfig } from '../../../src/config.js';
import { createLogger } from '../../../src/logger.js';
import { createGitRunner } from '../../../src/workspace/index.js';
import { createFakeManagedAdapter } from '../../control/fake-adapter.js';
import { git, makeTempDir } from '../control/harness.js';

/*
 * WG-V harness (docs/workflow-graph/wp/WG-V.md at tag v0.3.0). Deliberately free of vitest imports,
 * so the data-copy check and the real-run driver (plain `node --import tsx` scripts) share it with
 * the tests. It starts the real server composition (`startServer`) on 127.0.0.1 with an ephemeral
 * port (never 7420 or 5173), live mode over an EMPTY temp Claude dir and a temp home (so nothing of
 * the owner's ~/.claude is read, listed or even resolved), git isolated from the owner's config
 * with a fixed test identity (skill and agent file commits need one), and an injected managed
 * adapter: the scripted fake, unless a caller passes another one. Neither the Agent SDK nor
 * `claude` ever starts from here.
 */

/** Git isolated from the owner's config, with a fixed identity (as the owner's config gives). */
export const GIT_ISOLATED_IDENTITY_ENV: Readonly<Record<string, string>> = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_COUNT: '3',
  GIT_CONFIG_KEY_0: 'user.useConfigOnly',
  GIT_CONFIG_VALUE_0: 'true',
  GIT_CONFIG_KEY_1: 'user.name',
  GIT_CONFIG_VALUE_1: 'Test Owner',
  GIT_CONFIG_KEY_2: 'user.email',
  GIT_CONFIG_VALUE_2: 'owner@example.invalid',
};

/**
 * The synthetic harness every fixture repository commits on `main`: one required check that
 * passes once `fixed.txt` exists in the checkout (the fake helpers write it).
 */
export const PASS_WHEN_FIXED: Readonly<Record<string, string>> = {
  '.acp/harness.json': `${JSON.stringify(
    {
      version: 1,
      description: 'Synthetic WG-V harness',
      checks: [
        {
          id: 'test',
          name: 'Unit tests',
          argv: ['node', 'check.mjs'],
          timeoutSec: 30,
          required: true,
        },
      ],
    },
    null,
    2,
  )}\n`,
  'check.mjs':
    "import { existsSync } from 'node:fs';\nprocess.exit(existsSync('fixed.txt') ? 0 : 1);\n",
};

export interface Reply {
  status: number;
  body: unknown;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface GraphServer {
  server: RunningServer;
  base: string;
  dataDir: string;
  claudeDir: string;
  homeDir: string;
  databasePath: string;
  /** The scripted fake (also when a caller wraps it in its own adapter). */
  fake: ReturnType<typeof createFakeManagedAdapter>;
  /** Every JSON log line the server wrote. */
  logs: string[];
  request(method: Method, path: string, body?: unknown): Promise<Reply>;
  get(path: string): Promise<Reply>;
  post(path: string, body?: unknown): Promise<Reply>;
  put(path: string, body: unknown): Promise<Reply>;
  patch(path: string, body: unknown): Promise<Reply>;
  close(): Promise<void>;
}

export interface GraphBootOptions {
  dataDir: string;
  claudeDir?: string;
  homeDir?: string;
  logs?: string[];
  /** Wraps the fake (e.g. to tee each start into the real adapter); the fake is still driven. */
  adapter?: (fake: ReturnType<typeof createFakeManagedAdapter>) => ManagedExecutionAdapter;
  /** Ticket runs as before ADR-0021 (the legacy flow some v0.1.0 runs keep). Default: off. */
  legacyTicketRuns?: boolean;
}

export async function bootGraphServer(options: GraphBootOptions): Promise<GraphServer> {
  const claudeDir = options.claudeDir ?? makeTempDir('acp-wgv-claude-');
  const homeDir = options.homeDir ?? makeTempDir('acp-wgv-home-');
  const logs = options.logs ?? [];
  const config = loadConfig(
    {
      ACP_MODE: 'live',
      ACP_DATA_DIR: options.dataDir,
      // Only for the config; the server listens on an ephemeral port below.
      ACP_PORT: '7761',
      ACP_CLAUDE_DIR: claudeDir,
      ACP_POLL_INTERVAL_MS: '1000',
    },
    { homeDir },
  );
  const fake = createFakeManagedAdapter();
  const server = await startServer({
    config,
    port: 0,
    logger: createLogger((line) => logs.push(line)),
    managedAdapter: options.adapter === undefined ? fake.adapter : options.adapter(fake),
    git: createGitRunner({ env: GIT_ISOLATED_IDENTITY_ENV }),
    ...(options.legacyTicketRuns === true && { board: { legacyTicketRuns: true } }),
  });
  const base = `http://127.0.0.1:${server.port}`;
  let csrf = '';
  const request = async (method: Method, path: string, body?: unknown): Promise<Reply> => {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'GET') headers[CSRF_HEADER] = csrf;
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    return { status: res.status, body: text === '' ? null : (JSON.parse(text) as unknown) };
  };
  csrf = CsrfTokenDtoSchema.parse((await request('GET', '/api/control/token')).body).token;
  let closed = false;
  return {
    server,
    base,
    dataDir: options.dataDir,
    claudeDir,
    homeDir,
    databasePath: config.databasePath,
    fake,
    logs,
    request,
    get: (path) => request('GET', path),
    post: (path, body = {}) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    patch: (path, body) => request('PATCH', path, body),
    async close() {
      if (closed) return;
      closed = true;
      await server.close();
    },
  };
}

/** The error code of a reply, or undefined. */
export function errorCode(res: Reply): string | undefined {
  return ErrorDtoSchema.safeParse(res.body).data?.error.code;
}

/** The body of a reply with this status; otherwise throws with the status and error code only. */
export function ok(res: Reply, status = 200, what = 'request'): unknown {
  if (res.status !== status) {
    throw new Error(`${what}: expected ${status}, got ${res.status} ${errorCode(res) ?? ''}`);
  }
  return res.body;
}

/** Polls until `check` returns a value (not undefined), or fails after `timeoutMs`. */
export async function waitFor<T>(
  check: () => Promise<T | undefined> | T | undefined,
  what: string,
  timeoutMs = 20_000,
  intervalMs = 10,
): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Writes files into a repository and commits them on its current branch (test-side git). */
export function commitFiles(
  repo: string,
  files: Readonly<Record<string, string>>,
  message: string,
) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  git(repo, 'add', '--all');
  git(repo, 'commit', '--quiet', '-m', message);
}

/** Temp folders made by one caller, removed together. */
export function tempFolders(): { make(prefix: string): string; removeAll(): void; all: string[] } {
  const all: string[] = [];
  return {
    all,
    make(prefix) {
      const dir = makeTempDir(prefix);
      all.push(dir);
      return dir;
    },
    removeAll() {
      for (const dir of all.splice(0)) rmSync(dir, { recursive: true, force: true });
    },
  };
}
