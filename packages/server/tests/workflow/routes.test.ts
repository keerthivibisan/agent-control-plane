// Synthetic temp git repo and skill folders only (R-G). Never the Agent SDK, never ~/.claude.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { defaultProjectWorkflow } from '@acp/core';
import { CSRF_HEADER, ProjectWorkflowDtoSchema, type UpdateWorkflowRequest } from '@acp/core/api';
import { createRedesignRepositories } from '@acp/db';
import { setupBoard } from '../board/helpers.js';

function addSkill(root: string, name: string): void {
  mkdirSync(join(root, '.claude', 'skills', name), { recursive: true });
  writeFileSync(join(root, '.claude', 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n`);
}

function errorCode(res: { body: unknown }): string {
  return (res.body as { error: { code: string } }).error.code;
}

function dtoOf(res: { body: unknown }) {
  return ProjectWorkflowDtoSchema.parse(res.body);
}

function update(): UpdateWorkflowRequest {
  const base = defaultProjectWorkflow('x', '2026-10-16T09:00:00.000Z');
  return {
    plannerMode: 'separate',
    stages: {
      ...base.stages,
      plan: { model: 'claude-opus-4-1', skill: 'plan' },
      helpers: { model: null, skill: null },
      'code-review': { enabled: true, model: null, skill: 'code-review' },
      // Not in the repo: allowed, the Workflow page flags it (ADR-0019 §4).
      'unit-tests': { enabled: true, model: null, skill: 'gone-skill' },
    },
  };
}

describe('GET /api/projects/:id/workflow (R-G)', () => {
  it('answers the default workflow, the setup and the project skills', async () => {
    const s = await setupBoard();
    const empty = await s.get(`/api/projects/${s.project.id}/workflow`);
    expect(empty.status).toBe(200);
    const dto = ProjectWorkflowDtoSchema.parse(empty.body);
    expect(dto.workflow).toEqual(defaultProjectWorkflow(s.project.id, s.project.createdAt));
    expect(dto.setup).toMatchObject({ projectId: s.project.id, maxConcurrentHelpers: 3 });
    expect(dto.skills).toEqual([]);

    addSkill(s.repo, 'code-review');
    addSkill(s.repo, 'plan');
    const listed = await s.get(`/api/projects/${s.project.id}/workflow`);
    expect(dtoOf(listed).skills).toEqual(['code-review', 'plan']);
  });

  it('is 404 for an unknown project', async () => {
    const s = await setupBoard();
    const res = await s.get('/api/projects/nope/workflow');
    expect(res.status).toBe(404);
    expect(errorCode(res)).toBe('not_found');
  });
});

describe('PUT /api/projects/:id/workflow (R-G)', () => {
  it('saves the stage configuration and answers the workflow DTO', async () => {
    const s = await setupBoard();
    addSkill(s.repo, 'code-review');
    s.notices.length = 0;
    const res = await s.send('put', `/api/projects/${s.project.id}/workflow`, update());
    expect(res.status).toBe(200);
    const dto = ProjectWorkflowDtoSchema.parse(res.body);
    expect(dto.workflow).toMatchObject({
      projectId: s.project.id,
      plannerMode: 'separate',
      updatedAt: '2026-10-16T09:00:00.000Z',
    });
    expect(dto.workflow.stages['unit-tests']).toEqual({
      enabled: true,
      model: null,
      skill: 'gone-skill',
    });
    expect(dto.skills).toEqual(['code-review']);
    expect(
      s.notices.some((n) => n.kind === 'projects-changed' && n.projectIds.includes(s.project.id)),
    ).toBe(true);

    const again = await s.get(`/api/projects/${s.project.id}/workflow`);
    expect(dtoOf(again).workflow).toEqual(dto.workflow);
    expect((await s.workflow.effective(s.project.id)).v1).toEqual(dto.workflow);
  });

  it('round-trips stage agent files; a stage without one stays without (R-I)', async () => {
    const s = await setupBoard();
    const body = update();
    body.stages.plan = { ...body.stages.plan, agent: 'planner-style' };
    body.stages['code-review'] = { ...body.stages['code-review'], agent: null };
    // Not in the repo: allowed; the agent starts without it (ADR-0019 §6).
    body.stages['unit-tests'] = { ...body.stages['unit-tests'], agent: 'gone-agent' };
    const res = await s.send('put', `/api/projects/${s.project.id}/workflow`, body);
    expect(res.status).toBe(200);
    const saved = dtoOf(res).workflow.stages;
    expect(saved.plan.agent).toBe('planner-style');
    expect(saved['code-review'].agent).toBeNull();
    expect(saved['unit-tests'].agent).toBe('gone-agent');
    expect(saved.helpers).not.toHaveProperty('agent');
    const again = dtoOf(await s.get(`/api/projects/${s.project.id}/workflow`));
    expect(again.workflow.stages).toEqual(saved);

    const bad = update();
    bad.stages.plan = { ...bad.stages.plan, agent: '../../etc/passwd' };
    expect((await s.send('put', `/api/projects/${s.project.id}/workflow`, bad)).status).toBe(400);
  });

  it('takes the project from the path, never from the body', async () => {
    const s = await setupBoard();
    const other = s.repos.projects.insert({ name: 'other', rootPath: '/home/user/other' });
    const body = { ...update(), projectId: other.id, updatedAt: '2020-01-01T00:00:00.000Z' };
    const res = await s.send('put', `/api/projects/${s.project.id}/workflow`, body);
    expect(res.status).toBe(200);
    expect(dtoOf(res).workflow.projectId).toBe(s.project.id);
    expect(dtoOf(res).workflow.updatedAt).toBe('2026-10-16T09:00:00.000Z');
    expect(createRedesignRepositories(s.db).workflow.isStored(other.id)).toBe(false);
  });

  it('refuses a request without the CSRF token, or with a wrong one, and saves nothing', async () => {
    const s = await setupBoard();
    const path = `/api/projects/${s.project.id}/workflow`;
    const missing = await request(s.app).put(path).send(update());
    expect(missing.status).toBe(403);
    expect(errorCode(missing)).toBe('csrf_missing');
    const wrong = await request(s.app).put(path).set(CSRF_HEADER, 'f'.repeat(64)).send(update());
    expect(wrong.status).toBe(403);
    expect(errorCode(wrong)).toBe('csrf_invalid');
    expect(createRedesignRepositories(s.db).workflow.isStored(s.project.id)).toBe(false);
  });

  it('refuses an invalid body with 400 and saves nothing', async () => {
    const s = await setupBoard();
    const path = `/api/projects/${s.project.id}/workflow`;
    const good = update();
    const bad: unknown[] = [
      {},
      { ...good, plannerMode: 'committee' },
      { ...good, stages: { ...good.stages, review: { requireChecks: false } } },
      { ...good, stages: { ...good.stages, plan: { model: null, skill: '../../etc' } } },
      { ...good, stages: { ...good.stages, 'code-review': { model: null, skill: null } } },
      { plannerMode: 'lead' },
    ];
    for (const body of bad) {
      const res = await s.send('put', path, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(errorCode(res)).toBe('invalid_request');
    }
    expect(createRedesignRepositories(s.db).workflow.isStored(s.project.id)).toBe(false);
  });

  it('is 404 for an unknown project', async () => {
    const s = await setupBoard();
    const res = await s.send('put', '/api/projects/nope/workflow', update());
    expect(res.status).toBe(404);
  });
});
