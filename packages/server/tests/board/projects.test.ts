import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  CSRF_HEADER,
  CheckRunDtoSchema,
  ContextCandidateDtoSchema,
  HarnessStatusDtoSchema,
  ProjectAgentSetupDtoSchema,
  ProjectDtoSchema,
  TicketDtoSchema,
} from '@acp/core/api';
import { expectError } from '../control/helpers.js';
import { git, tempDir } from '../workspace/helpers.js';
import { PASSING_WHEN_FIXED, setupBoard } from './helpers.js';
import { projectKeyCandidates } from '../../src/board/setup.js';

/*
 * Project routes of the Agent Workspace (README §6.3, §4.1, ADR-0017 §1): create a repository,
 * the agent setup (default row for projects that predate it), the harness, context files and
 * removal from the app.
 */

describe('POST /api/projects/new (ADR-0017 §1)', () => {
  it('runs git init -b main with a first commit, registers the project and gives it a setup', async () => {
    const s = await setupBoard();
    const parent = tempDir('acp-new-parent-');
    const res = await s.post('/api/projects/new', {
      parentDir: parent,
      name: 'shop-api',
      readme: '# Shop API\n',
    });
    expect(res.status).toBe(201);
    const project = ProjectDtoSchema.parse(res.body);
    expect(project).toMatchObject({ name: 'shop-api', rootPath: join(parent, 'shop-api') });
    expect(readFileSync(join(parent, 'shop-api', 'README.md'), 'utf8')).toBe('# Shop API\n');
    expect(git(join(parent, 'shop-api'), 'branch', '--show-current').trim()).toBe('main');
    expect(git(join(parent, 'shop-api'), 'log', '--format=%an %s').trim()).toBe(
      'Agent Control Plane Initial commit',
    );

    // The wizard edits the setup of a project it just created.
    const setup = await s.get(`/api/projects/${project.id}/setup`);
    expect(setup.status).toBe(200);
    expect(ProjectAgentSetupDtoSchema.parse(setup.body)).toMatchObject({
      projectKey: 'SHOPAP',
      planFirst: true,
      maxConcurrentHelpers: 3,
      maxDepth: 1,
      model: null,
      allowlist: { editInOwnWorktree: false, runHarnessChecks: false },
      contextFiles: [],
    });
  });

  it('makes an empty first commit without a README', async () => {
    const s = await setupBoard();
    const parent = tempDir('acp-new-parent-');
    expect((await s.post('/api/projects/new', { parentDir: parent, name: 'empty' })).status).toBe(
      201,
    );
    expect(git(join(parent, 'empty'), 'rev-list', '--count', 'HEAD').trim()).toBe('1');
    expect(existsSync(join(parent, 'empty', 'README.md'))).toBe(false);
  });

  it('refuses an existing folder (conflict), a missing parent (invalid_root) and a bad name', async () => {
    const s = await setupBoard();
    const parent = tempDir('acp-new-parent-');
    mkdirSync(join(parent, 'taken'));
    expectError(
      await s.post('/api/projects/new', { parentDir: parent, name: 'taken' }),
      409,
      'conflict',
    );
    expectError(
      await s.post('/api/projects/new', { parentDir: join(parent, 'nope'), name: 'x' }),
      400,
      'invalid_root',
    );
    expectError(
      await s.post('/api/projects/new', { parentDir: parent, name: '../escape' }),
      400,
      'invalid_request',
    );
    expectError(
      await s.post('/api/projects/new', { parentDir: 'relative', name: 'x' }),
      400,
      'invalid_request',
    );
    expectError(
      await request(s.app).post('/api/projects/new').send({ parentDir: parent, name: 'y' }),
      403,
      'csrf_missing',
    );
    expect(existsSync(join(parent, 'y'))).toBe(false);
  });
});

describe('project setup', () => {
  it('creates the default row lazily for a project registered before Phase 4', async () => {
    const s = await setupBoard();
    expect(s.workspace.projectSetup.get(s.project.id)).toBeUndefined();
    const res = await s.get(`/api/projects/${s.project.id}/setup`);
    expect(res.status).toBe(200);
    expect(ProjectAgentSetupDtoSchema.parse(res.body).projectKey).toBe('WEBAPP');
    expect(s.workspace.projectSetup.get(s.project.id)).toBeDefined();
  });

  it('pre-approves the checks by default once a harness exists', async () => {
    const s = await setupBoard({ files: { 'README.md': 'x\n', ...PASSING_WHEN_FIXED } });
    const setup = ProjectAgentSetupDtoSchema.parse(
      (await s.get(`/api/projects/${s.project.id}/setup`)).body,
    );
    expect(setup.allowlist).toEqual({ editInOwnWorktree: false, runHarnessChecks: true });
  });

  it('PUT saves the setup; a key in use by another project is a conflict', async () => {
    const s = await setupBoard();
    const body = {
      projectKey: 'WEB',
      maxConcurrentHelpers: 6,
      maxDepth: 2,
      defaultBudgetTokensPerAgent: 100_000,
      model: 'claude-test',
      allowlist: { editInOwnWorktree: true, runHarnessChecks: true },
      contextFiles: ['README.md'],
    };
    const res = await s.send('put', `/api/projects/${s.project.id}/setup`, body);
    expect(res.status).toBe(200);
    expect(ProjectAgentSetupDtoSchema.parse(res.body)).toMatchObject(body);

    const other = s.repos.projects.insert({ name: 'other', rootPath: tempDir('acp-other-') });
    expectError(await s.send('put', `/api/projects/${other.id}/setup`, body), 409, 'conflict');
    expectError(
      await s.send('put', `/api/projects/${s.project.id}/setup`, { ...body, maxDepth: 3 }),
      400,
      'invalid_request',
    );
    expectError(
      await s.send('put', `/api/projects/${s.project.id}/setup`, {
        ...body,
        contextFiles: ['../secret'],
      }),
      400,
      'invalid_request',
    );
    expectError(await s.get('/api/projects/nope/setup'), 404, 'not_found');
  });

  it('derives distinct keys from project names', () => {
    expect(projectKeyCandidates('web-app')[0]).toBe('WEBAPP');
    expect(projectKeyCandidates('x1')[0]).toBe('PRJ');
    expect(projectKeyCandidates('ab')[0]).toBe('AB');
    const keys = projectKeyCandidates('web');
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => /^[A-Z]{2,6}$/.test(k))).toBe(true);
  });
});

describe('harness routes', () => {
  it('GET reports none without a manifest and ready with one', async () => {
    const none = await setupBoard();
    const a = HarnessStatusDtoSchema.parse(
      (await none.get(`/api/projects/${none.project.id}/harness`)).body,
    );
    expect(a.state).toBe('none');
    const ready = await setupBoard({ files: { 'README.md': 'x\n', ...PASSING_WHEN_FIXED } });
    const b = HarnessStatusDtoSchema.parse(
      (await ready.get(`/api/projects/${ready.project.id}/harness`)).body,
    );
    expect(b).toMatchObject({ state: 'ready', problems: [] });
    expect(b.checks[0]).toMatchObject({ id: 'test', argv: ['node', 'check.mjs'], required: true });
  });

  it('POST checks runs them on the main branch and stores the results', async () => {
    const s = await setupBoard({ files: { 'README.md': 'x\n', ...PASSING_WHEN_FIXED } });
    const res = await s.post(`/api/projects/${s.project.id}/harness/checks`, {});
    expect(res.status).toBe(200);
    const runs = CheckRunDtoSchema.array().parse(res.body);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      runId: null,
      agentRunId: null,
      checkId: 'test',
      status: 'failed',
      exitCode: 1,
    });
    expect(s.workspace.checkRuns.listForProjectMain(s.project.id)).toHaveLength(1);
    expectError(
      await request(s.app).post(`/api/projects/${s.project.id}/harness/checks`).send({}),
      403,
      'csrf_missing',
    );
  }, 30_000);

  it('POST ticket adds the ready-written "Build the harness" ticket', async () => {
    const s = await setupBoard();
    const res = await s.post(`/api/projects/${s.project.id}/harness/ticket`, {});
    expect(res.status).toBe(201);
    expect(TicketDtoSchema.parse(res.body)).toMatchObject({
      key: 'WEBAPP-1',
      title: 'Build the harness',
      type: 'harness',
      priority: 'high',
      labels: ['harness'],
      status: 'BACKLOG',
      stage: 'BACKLOG',
    });
  });

  it('GET context-candidates lists tracked text files and suggests CLAUDE.md', async () => {
    const s = await setupBoard({ files: { 'README.md': 'x\n', 'CLAUDE.md': 'rules\n' } });
    const res = await s.get(`/api/projects/${s.project.id}/context-candidates`);
    expect(res.status).toBe(200);
    const list = ContextCandidateDtoSchema.array().parse(res.body);
    expect(list.find((c) => c.path === 'CLAUDE.md')).toMatchObject({ suggested: true });
    expect(list.find((c) => c.path === 'README.md')).toMatchObject({ suggested: false });
  });
});

describe('DELETE /api/projects/:id', () => {
  it('refuses a project with tickets (409) and removes one without history', async () => {
    const s = await setupBoard();
    await s.createTicket();
    expectError(
      await s.send('delete', `/api/projects/${s.project.id}`),
      409,
      'project_has_history',
    );
    expect(s.repos.projects.getById(s.project.id)).toBeDefined();

    const other = s.repos.projects.insert({ name: 'other', rootPath: tempDir('acp-other-') });
    await s.get(`/api/projects/${other.id}/setup`);
    expectError(await request(s.app).delete(`/api/projects/${other.id}`), 403, 'csrf_missing');
    expect((await s.send('delete', `/api/projects/${other.id}`)).status).toBe(204);
    expect(s.repos.projects.getById(other.id)).toBeUndefined();
    expectError(await s.send('delete', `/api/projects/${other.id}`), 404, 'not_found');
  });
});

describe('CSRF on every workspace mutation', () => {
  it('refuses each one without the token and with a wrong one', async () => {
    const s = await setupBoard();
    const t = await s.createTicket();
    const routes: ['post' | 'put' | 'patch' | 'delete', string][] = [
      ['post', '/api/projects/new'],
      ['put', `/api/projects/${s.project.id}/setup`],
      ['post', `/api/projects/${s.project.id}/harness/checks`],
      ['post', `/api/projects/${s.project.id}/harness/ticket`],
      ['post', `/api/projects/${s.project.id}/tickets`],
      ['patch', `/api/tickets/${t.id}`],
      ['post', `/api/tickets/${t.id}/move`],
      ['post', `/api/tickets/${t.id}/start`],
      ['post', `/api/tickets/${t.id}/comments`],
      ['post', `/api/tickets/${t.id}/plans/x/decision`],
      ['post', '/api/runs/x/agents/y/checks'],
      ['delete', `/api/projects/${s.project.id}`],
    ];
    for (const [method, path] of routes) {
      expectError(await request(s.app)[method](path).send({}), 403, 'csrf_missing');
      expectError(
        await request(s.app)[method](path).set(CSRF_HEADER, 'f'.repeat(64)).send({}),
        403,
        'csrf_invalid',
      );
    }
    expect(s.workspace.tickets.listForProject(s.project.id)).toHaveLength(1);
  });
});
