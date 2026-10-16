import { join } from 'node:path';
import request from 'supertest';
import { afterEach, expect } from 'vitest';
import { CSRF_HEADER, type TicketDetailDto, type TicketDto } from '@acp/core/api';
import { createWorkspaceRepositories } from '@acp/db';
import { createApp } from '../../src/app.js';
import { createCheckService, type CheckService } from '../../src/board/checks.js';
import { createProjectHarness } from '../../src/board/harness.js';
import { createBoardService } from '../../src/board/service.js';
import { createWorkflowService } from '../../src/workflow/service.js';
import { createSkillsPlugins } from '../../src/workflow/skills-plugin.js';
import {
  createControlService,
  type ControlService,
  type ControlWorkspaceHooks,
} from '../../src/control/service.js';
import { createCheckRunner, createMainChecks } from '../../src/harness/index.js';
import type { Logger } from '../../src/logger.js';
import { createGitRunner, createWorkspaceManager } from '../../src/workspace/index.js';
import { createFakeManagedAdapter } from '../control/fake-adapter.js';
import { setupApp } from '../helpers.js';
import { GIT_TEST_ENV, makeRepo, tempDir } from '../workspace/helpers.js';

/**
 * The full app with the Phase 4 board wired as `startServer` wires it: a temp-file database, the
 * control service over the scripted fake managed adapter (never the Agent SDK), a real workspace
 * manager and real check runner over a throwaway git repository (isolated from the user's git
 * config). Checks are tiny `node` scripts in the repo.
 */

export const BOARD_NOW = new Date('2026-10-16T09:00:00.000Z');

/** A harness whose one required check passes once `fixed.txt` exists in the checkout. */
export const PASSING_WHEN_FIXED = {
  '.acp/harness.json': JSON.stringify({
    version: 1,
    checks: [
      {
        id: 'test',
        name: 'Unit tests',
        argv: ['node', 'check.mjs'],
        timeoutSec: 30,
        required: true,
      },
    ],
  }),
  'check.mjs':
    "import { existsSync } from 'node:fs';\nprocess.exit(existsSync('fixed.txt') ? 0 : 1);\n",
};

const open: { control: ControlService; checks: CheckService }[] = [];
afterEach(async () => {
  for (const o of open.splice(0)) {
    await o.checks.close();
    await o.control.close();
  }
});

export interface BoardSetupOptions {
  files?: Record<string, string>;
  logger?: Logger;
  enabled?: boolean;
}

export async function setupBoard(options: BoardSetupOptions = {}) {
  const logger = options.logger ?? { log() {} };
  const base = await setupApp({ ingestDemo: false, logger });
  const { db, repos } = base;
  const repo = makeRepo(options.files ?? { 'README.md': 'hello\n', 'src/app.ts': 'export {};\n' });
  const project = repos.projects.insert({ name: 'web-app', rootPath: repo });
  const dataDir = tempDir('acp-board-data-');
  const git = createGitRunner({ env: GIT_TEST_ENV });
  const fake = createFakeManagedAdapter();
  const clock = { now: BOARD_NOW };
  const now = () => clock.now;
  const hooks: ControlWorkspaceHooks = {};
  // The owner's home is a temp directory, so the real ~/.claude is never listed or copied.
  const homeDir = tempDir('acp-board-home-');
  const control = createControlService({
    db,
    repos,
    adapter: fake.adapter,
    workspaces: createWorkspaceManager({ dataDir, git }),
    git,
    dataDir,
    enabled: options.enabled ?? true,
    logger,
    now,
    publish: base.publish,
    sweepIntervalMs: null,
    skillsPlugins: createSkillsPlugins({ dataDir, skills: { homeDir } }),
    workspace: hooks,
  });
  const workspace = createWorkspaceRepositories(db, { now });
  const harness = createProjectHarness({ repos, workspace, now, logger });
  const runner = createCheckRunner({ now });
  const mainChecks = createMainChecks({ dataDir, runner, git, now });
  const checks = createCheckService({
    repos,
    workspace,
    control,
    runner,
    mainChecks,
    harness,
    publish: base.publish,
    logger,
  });
  open.push({ control, checks });
  const board = createBoardService({
    db,
    repos,
    queries: base.queries,
    projects: base.services.projects,
    control,
    harness,
    checks,
    git,
    now,
    publish: base.publish,
    logger,
  });
  Object.assign(hooks, board.controlHooks());
  const workflow = createWorkflowService({
    db,
    repos,
    setupFor: (projectId) => board.getSetup(projectId),
    now,
    publish: base.publish,
    skills: { homeDir },
  });
  await control.start();
  const app = createApp({
    config: base.config,
    logger,
    services: base.services,
    stream: { repos, notifier: base.notifier, heartbeatMs: 20 },
    hooks: {
      token: base.hookToken,
      adapter: undefined,
      pipeline: base.pipeline,
      hookState: base.hookState,
      requestPoll: () => {},
      logger,
      now,
    },
    control,
    board,
    workflow,
  });
  const token = control.csrfToken;
  const send = (method: 'post' | 'put' | 'patch' | 'delete', path: string, body?: unknown) => {
    const r = request(app)[method](path).set(CSRF_HEADER, token);
    return body === undefined ? r : r.send(body as object);
  };
  const post = (path: string, body: unknown = {}) => send('post', path, body);
  const get = (path: string) => request(app).get(path);

  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await control.idle();
      await checks.idle();
    }
  }

  async function createTicket(title = 'Add dark mode', extra: object = {}): Promise<TicketDto> {
    const res = await post(`/api/projects/${project.id}/tickets`, { title, ...extra });
    expect(res.status).toBe(201);
    return res.body as TicketDto;
  }

  /** A ticket moved to Ready and started: its run is PLANNING and the lead is running. */
  async function startTicket(
    title?: string,
  ): Promise<{ ticket: TicketDto; detail: TicketDetailDto }> {
    const ticket = await createTicket(title);
    expect((await post(`/api/tickets/${ticket.id}/move`, { status: 'READY' })).status).toBe(200);
    const started = await post(`/api/tickets/${ticket.id}/start`);
    expect(started.status).toBe(200);
    await settle();
    fake.lead().started();
    await settle();
    return { ticket, detail: started.body as TicketDetailDto };
  }

  async function detail(ticketId: string): Promise<TicketDetailDto> {
    await settle();
    const res = await get(`/api/tickets/${ticketId}`);
    expect(res.status).toBe(200);
    return res.body as TicketDetailDto;
  }

  /** The lead submits a plan with one helper step. */
  async function submitPlan(summary = 'Add a theme toggle') {
    const reply = await fake.lead().callLead('submit_plan', {
      summary,
      steps: [{ title: 'Build the toggle', role: 'Builder', detail: 'In settings' }],
    });
    await settle();
    return reply;
  }

  return {
    ...base,
    app,
    control,
    board,
    workflow,
    homeDir,
    checks,
    fake,
    repo,
    project,
    dataDir,
    git,
    clock,
    token,
    workspace,
    send,
    post,
    get,
    settle,
    createTicket,
    startTicket,
    detail,
    submitPlan,
    worktree: (runId: string, agentId: string) => join(dataDir, 'worktrees', runId, agentId),
  };
}
