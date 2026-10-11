import { join } from 'node:path';
import request from 'supertest';
import { afterEach, expect } from 'vitest';
import { CSRF_HEADER, ErrorDtoSchema, type RunDetailDto } from '@acp/core/api';
import type { Logger } from '../../src/logger.js';
import { createApp } from '../../src/app.js';
import {
  createControlService,
  type ControlService,
  type ControlServiceDeps,
} from '../../src/control/service.js';
import { createGitRunner, createWorkspaceManager } from '../../src/workspace/index.js';
import { setupApp } from '../helpers.js';
import { GIT_TEST_ENV, makeRepo, tempDir } from '../workspace/helpers.js';
import { createFakeManagedAdapter, type FakeManagedAdapter } from './fake-adapter.js';

/**
 * The full app over a temp-file database with the control service wired to a scripted fake
 * managed adapter (never the Agent SDK) and a real workspace manager over a temp git repository
 * (`git init` in a temp dir, isolated from the user's git config).
 */

export const CONTROL_NOW = new Date('2026-10-11T09:00:00.000Z');

const open: ControlService[] = [];
const extraDbs: { close(): void }[] = [];
afterEach(async () => {
  for (const c of open.splice(0)) await c.close();
  for (const db of extraDbs.splice(0)) db.close();
});

export interface ControlSetupOptions {
  logger?: Logger;
  enabled?: boolean;
  /** Reuse a database (restart tests). */
  dbPath?: string;
  dataDir?: string;
  repo?: string;
  clock?: { now: Date };
  overrides?: Partial<ControlServiceDeps>;
}

export async function setupControl(options: ControlSetupOptions = {}) {
  const base = await setupApp({
    ingestDemo: false,
    ...(options.logger !== undefined && { logger: options.logger }),
  });
  // setupApp opens its own database; a restart test points a second control service at an old one.
  const { openDatabase, createRepositories } = await import('@acp/db');
  const db = options.dbPath === undefined ? base.db : openDatabase(options.dbPath);
  if (db !== base.db) extraDbs.push(db);
  const repos = options.dbPath === undefined ? base.repos : createRepositories(db);
  const repo = options.repo ?? makeRepo({ 'README.md': 'hello\n', 'src/app.ts': 'export {};\n' });
  const project =
    repos.projects.getByRootPath(repo) ?? repos.projects.insert({ name: 'app', rootPath: repo });
  const dataDir = options.dataDir ?? tempDir('acp-control-data-');
  const git = createGitRunner({ env: GIT_TEST_ENV });
  const fake: FakeManagedAdapter = createFakeManagedAdapter();
  const clock = options.clock ?? { now: CONTROL_NOW };
  const control = createControlService({
    db,
    repos,
    adapter: fake.adapter,
    workspaces: createWorkspaceManager({ dataDir, git }),
    git,
    dataDir,
    enabled: options.enabled ?? true,
    logger: options.logger ?? { log() {} },
    now: () => clock.now,
    publish: base.publish,
    sweepIntervalMs: null,
    ...options.overrides,
  });
  open.push(control);
  await control.start();
  const app = createApp({
    config: base.config,
    logger: options.logger ?? { log() {} },
    services: base.services,
    stream: { repos, notifier: base.notifier, heartbeatMs: 20 },
    hooks: {
      token: base.hookToken,
      adapter: undefined,
      pipeline: base.pipeline,
      hookState: base.hookState,
      requestPoll: () => {},
      logger: options.logger ?? { log() {} },
      now: () => clock.now,
    },
    control,
  });
  const token = control.csrfToken;
  const post = (path: string, body?: unknown) => {
    const r = request(app).post(path).set(CSRF_HEADER, token);
    return body === undefined ? r : r.send(body as object);
  };
  const get = (path: string) => request(app).get(path);

  /** POST /api/runs, then the first chat message, which starts the lead. */
  async function startRun(text = 'Spin up two agents'): Promise<RunDetailDto> {
    const created = await post('/api/runs', { projectId: project.id });
    expect(created.status).toBe(201);
    const run = created.body as RunDetailDto;
    const chat = await post(`/api/runs/${run.id}/chat`, { text });
    expect(chat.status).toBe(200);
    await control.idle();
    return run;
  }

  async function detail(runId: string): Promise<RunDetailDto> {
    await control.idle();
    const res = await get(`/api/runs/${runId}`);
    expect(res.status).toBe(200);
    return res.body as RunDetailDto;
  }

  /** The lead starts a worker through its tool; returns the new worker's fake agent. */
  async function startWorker(role = 'Builder', task = 'Build the thing') {
    await control.idle();
    const before = fake.workers().length;
    const reply = await fake.lead().callLead('start_agent', { role, task });
    await control.idle();
    const worker = fake.workers()[before];
    if (worker === undefined) throw new Error(`worker did not start: ${reply}`);
    return worker;
  }

  return {
    ...base,
    db,
    repos,
    app,
    control,
    fake,
    repo,
    project,
    dataDir,
    git,
    clock,
    token,
    post,
    get,
    startRun,
    startWorker,
    detail,
    worktree: (runId: string, agentId: string) => join(dataDir, 'worktrees', runId, agentId),
  };
}

export function expectError(res: { status: number; body: unknown }, status: number, code: string) {
  expect(res.status).toBe(status);
  const parsed = ErrorDtoSchema.parse(res.body);
  expect(parsed.error.code).toBe(code);
  return parsed;
}
