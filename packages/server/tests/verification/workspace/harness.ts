import { join } from 'node:path';
import { expect } from 'vitest';
import {
  BoardDtoSchema,
  CSRF_HEADER,
  CsrfTokenDtoSchema,
  ErrorDtoSchema,
  RunDetailDtoSchema,
  TicketDetailDtoSchema,
  type BoardDto,
  type ProjectDto,
  type RunDetailDto,
  type TicketDetailDto,
  type TicketDto,
} from '@acp/core/api';
import { startServer, type RunningServer } from '../../../src/bootstrap.js';
import { loadConfig } from '../../../src/config.js';
import { createLogger } from '../../../src/logger.js';
import { createGitRunner } from '../../../src/workspace/index.js';
import { createFakeManagedAdapter, type FakeAgent } from '../../control/fake-adapter.js';
import { GIT_TEST_ENV, tempDir } from '../../workspace/helpers.js';

/*
 * P4-H verification harness: the real server composition (`startServer`) on 127.0.0.1 with an
 * ephemeral port, driven over HTTP the way the owner's browser drives it. Live mode over an empty
 * temp Claude dir (demo mode rebuilds its database on every start, so restarts need live mode),
 * the scripted fake managed adapter (the Agent SDK and `claude` never start), the real check
 * runner over tiny `node` scripts, and git isolated from the owner's config. Every log line goes
 * through the production JSON logger into `logs`; every response body is kept in `responses`, so
 * a test can assert that something never reached either.
 */

/** A harness whose one required check passes once `fixed.txt` exists in the checkout. */
export const HARNESS_FILES: Readonly<Record<string, string>> = {
  '.acp/harness.json': `${JSON.stringify(
    {
      version: 1,
      description: 'Synthetic P4-H harness',
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

/** The setup the full flow saves (README §4.1 steps 2–4). */
export function setupBody(projectKey: string, overrides: Record<string, unknown> = {}) {
  return {
    projectKey,
    maxConcurrentHelpers: 3,
    maxDepth: 1,
    defaultBudgetTokensPerAgent: 100_000,
    model: null,
    allowlist: { editInOwnWorktree: false, runHarnessChecks: false },
    contextFiles: [],
    ...overrides,
  };
}

export interface Reply {
  status: number;
  body: unknown;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface WorkspaceServer {
  server: RunningServer;
  base: string;
  dataDir: string;
  claudeDir: string;
  databasePath: string;
  csrf: string;
  fake: ReturnType<typeof createFakeManagedAdapter>;
  /** Every JSON log line the server wrote. */
  logs: string[];
  /** Every response body (raw text) the server sent to this harness. */
  responses: string[];
  request(
    method: Method,
    path: string,
    body?: unknown,
    options?: { csrf?: string | null },
  ): Promise<Reply>;
  get(path: string): Promise<Reply>;
  post(path: string, body?: unknown): Promise<Reply>;
  put(path: string, body: unknown): Promise<Reply>;
  close(): Promise<void>;
}

export interface WorkspaceBootOptions {
  dataDir?: string;
  claudeDir?: string;
  /** Shared across restarts so a test can search everything a server ever logged. */
  logs?: string[];
  /** ADR-0021: start ticket runs with the review loop, as production does (default: legacy). */
  reviewLoop?: boolean;
}

export async function bootWorkspace(options: WorkspaceBootOptions = {}): Promise<WorkspaceServer> {
  const dataDir = options.dataDir ?? tempDir('acp-p4h-data-');
  const claudeDir = options.claudeDir ?? tempDir('acp-p4h-claude-');
  const logs = options.logs ?? [];
  const config = loadConfig({
    ACP_MODE: 'live',
    ACP_DATA_DIR: dataDir,
    // Only for the config; the server listens on an ephemeral port (never 7420 or 5173).
    ACP_PORT: '7741',
    ACP_CLAUDE_DIR: claudeDir,
    ACP_POLL_INTERVAL_MS: '1000',
  });
  const fake = createFakeManagedAdapter();
  const server = await startServer({
    config,
    port: 0,
    logger: createLogger((line) => logs.push(line)),
    managedAdapter: fake.adapter,
    git: createGitRunner({ env: GIT_TEST_ENV }),
    // P4-H verifies the flow of ticket runs started before ADR-0021 (the owner merges each change
    // into the base branch), which such runs keep; the review loop is verified in
    // tests/verification/review-loop (`reviewLoop: true`).
    board: { legacyTicketRuns: options.reviewLoop !== true },
  });
  const base = `http://127.0.0.1:${server.port}`;
  const responses: string[] = [];
  let csrf = '';

  async function request(
    method: Method,
    path: string,
    body?: unknown,
    opts: { csrf?: string | null } = {},
  ): Promise<Reply> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    const token = opts.csrf === undefined ? csrf : opts.csrf;
    if (method !== 'GET' && token !== null) headers[CSRF_HEADER] = token;
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    responses.push(text);
    return { status: res.status, body: text === '' ? null : (JSON.parse(text) as unknown) };
  }

  const token = await request('GET', '/api/control/token');
  csrf = CsrfTokenDtoSchema.parse(token.body).token;
  let closed = false;
  return {
    server,
    base,
    dataDir,
    claudeDir,
    databasePath: config.databasePath,
    csrf,
    fake,
    logs,
    responses,
    request,
    get: (path) => request('GET', path),
    post: (path, body = {}) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    async close() {
      if (closed) return;
      closed = true;
      await server.close();
    },
  };
}

/** Polls until `check` returns a value (not undefined), or fails after `timeoutMs`. */
export async function waitFor<T>(
  check: () => Promise<T | undefined> | T | undefined,
  what: string,
  timeoutMs = 20_000,
): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

export function expectError(res: Reply, status: number, code: string): void {
  expect({ status: res.status, code: ErrorDtoSchema.safeParse(res.body).data?.error.code }).toEqual(
    { status, code },
  );
}

export function expectStatus(res: Reply, status: number): unknown {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body;
}

export async function ticketDetail(b: WorkspaceServer, ticketId: string): Promise<TicketDetailDto> {
  return TicketDetailDtoSchema.parse(expectStatus(await b.get(`/api/tickets/${ticketId}`), 200));
}

export async function boardOf(b: WorkspaceServer, projectId: string): Promise<BoardDto> {
  return BoardDtoSchema.parse(expectStatus(await b.get(`/api/board?projectId=${projectId}`), 200));
}

/** The column a ticket sits in on the board. */
export function columnOf(board: BoardDto, ticketId: string): string | undefined {
  return board.columns.find((c) => c.tickets.some((t) => t.id === ticketId))?.stage;
}

export async function waitForTicket(
  b: WorkspaceServer,
  ticketId: string,
  ready: (d: TicketDetailDto) => boolean,
  what: string,
): Promise<TicketDetailDto> {
  return waitFor(async () => {
    const d = await ticketDetail(b, ticketId);
    return ready(d) ? d : undefined;
  }, what);
}

export async function runDetail(b: WorkspaceServer, runId: string): Promise<RunDetailDto> {
  return RunDetailDtoSchema.parse(expectStatus(await b.get(`/api/runs/${runId}`), 200));
}

export async function waitForRun(
  b: WorkspaceServer,
  runId: string,
  ready: (r: RunDetailDto) => boolean,
  what: string,
): Promise<RunDetailDto> {
  return waitFor(async () => {
    const r = await runDetail(b, runId);
    return ready(r) ? r : undefined;
  }, what);
}

export async function createProject(
  b: WorkspaceServer,
  name: string,
  parentDir = tempDir('acp-p4h-parent-'),
): Promise<ProjectDto> {
  return expectStatus(
    await b.post('/api/projects/new', { parentDir, name, readme: `# ${name}\n` }),
    201,
  ) as ProjectDto;
}

export async function createTicket(
  b: WorkspaceServer,
  projectId: string,
  body: Record<string, unknown>,
): Promise<TicketDto> {
  return expectStatus(await b.post(`/api/projects/${projectId}/tickets`, body), 201) as TicketDto;
}

/** Ready → Start; waits for the run's lead and reports it started. Returns the run id and lead. */
export async function startTicket(
  b: WorkspaceServer,
  ticketId: string,
): Promise<{ runId: string; lead: FakeAgent }> {
  expectStatus(await b.post(`/api/tickets/${ticketId}/move`, { status: 'READY' }), 200);
  const started = TicketDetailDtoSchema.parse(
    expectStatus(await b.post(`/api/tickets/${ticketId}/start`), 200),
  );
  const runId = started.currentRun?.id;
  if (runId === undefined) throw new Error('the ticket has no run');
  const leadId = started.currentRun?.agents.find((a) => a.kind === 'lead')?.id;
  if (leadId === undefined) throw new Error('the run has no lead');
  const lead = await waitFor(() => b.fake.agents.find((a) => a.id === leadId), 'the lead');
  lead.started();
  await waitForRun(
    b,
    runId,
    (r) => r.agents.some((a) => a.kind === 'lead' && a.status === 'RUNNING'),
    'the lead running',
  );
  return { runId, lead };
}

/** The lead submits a plan; waits until the ticket shows it in Plan review. */
export async function submitPlan(
  b: WorkspaceServer,
  ticketId: string,
  lead: FakeAgent,
  summary: string,
  steps = [{ title: 'Do the work', role: 'Builder', detail: 'In one helper' }],
): Promise<TicketDetailDto> {
  const before = (await ticketDetail(b, ticketId)).plans.length;
  await lead.callLead('submit_plan', { summary, steps });
  return waitForTicket(
    b,
    ticketId,
    (d) => d.plans.length === before + 1 && d.ticket.stage === 'PLAN_REVIEW',
    `plan v${before + 1} in review`,
  );
}

export async function approveLatestPlan(
  b: WorkspaceServer,
  ticketId: string,
): Promise<TicketDetailDto> {
  const plan = (await ticketDetail(b, ticketId)).plans.at(-1);
  if (plan === undefined) throw new Error('no plan');
  return TicketDetailDtoSchema.parse(
    expectStatus(
      await b.post(`/api/tickets/${ticketId}/plans/${plan.id}/decision`, { decision: 'approve' }),
      200,
    ),
  );
}

/** The lead (or a parent helper) starts a helper; waits for its worktree and reports it started. */
export async function startHelper(
  b: WorkspaceServer,
  runId: string,
  caller: FakeAgent,
  role: string,
  task: string,
): Promise<FakeAgent> {
  await caller.callLead('start_agent', { role, task });
  const run = await waitForRun(
    b,
    runId,
    (r) => r.agents.some((a) => a.role === role),
    `the ${role} helper`,
  );
  const id = run.agents.find((a) => a.role === role)?.id ?? '';
  // The adapter is called once the helper's worktree exists.
  const helper = await waitFor(() => b.fake.agents.find((a) => a.id === id), `${role} started`);
  helper.started();
  await waitForRun(
    b,
    runId,
    (r) => r.agents.some((a) => a.id === id && a.status === 'RUNNING'),
    `the ${role} helper running`,
  );
  return helper;
}

/** The helper's worktree (its cwd: the project is the repository root here). */
export const worktreeOf = (helper: FakeAgent): string => helper.spec.cwd;

export const fileIn = (root: string, path: string): string => join(root, path);

/** Lines the server logged with this message. */
export function logLines(logs: readonly string[], message: string): Record<string, unknown>[] {
  return logs
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((l) => l['message'] === message);
}

/** Reads `GET /api/events/stream` until `stop()`, which returns every frame received. */
export function listenToStream(b: WorkspaceServer): { stop(): Promise<string> } {
  const controller = new AbortController();
  const done = (async () => {
    let text = '';
    try {
      const res = await fetch(`${b.base}/api/events/stream`, { signal: controller.signal });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const chunk = await reader?.read();
        if (chunk === undefined || chunk.done) break;
        text += decoder.decode(chunk.value as Uint8Array, { stream: true });
      }
    } catch {
      // Aborted by stop(), or the server closed the connection.
    }
    return text;
  })();
  return {
    stop() {
      controller.abort();
      return done;
    },
  };
}
