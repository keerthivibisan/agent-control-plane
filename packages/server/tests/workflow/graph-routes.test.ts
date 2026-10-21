// Synthetic temp git repo, skill and agent files only (WG-C, ADR-0023). Never the Agent SDK, never
// ~/.claude.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  approvalsOf,
  defaultProjectWorkflow,
  migrateWorkflowV1,
  validateWorkflowGraph,
  workflowTemplate,
  type WorkflowGraph,
} from '@acp/core';
import {
  CSRF_HEADER,
  ValidateWorkflowGraphResultDtoSchema,
  WorkflowGraphDtoSchema,
} from '@acp/core/api';
import { createRedesignRepositories } from '@acp/db';
import { setupBoard } from '../board/helpers.js';

type Board = Awaited<ReturnType<typeof setupBoard>>;

function addSkill(root: string, name: string): void {
  mkdirSync(join(root, '.claude', 'skills', name), { recursive: true });
  writeFileSync(join(root, '.claude', 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n`);
}

function addAgentFile(root: string, name: string): void {
  mkdirSync(join(root, '.claude', 'agents'), { recursive: true });
  writeFileSync(
    join(root, '.claude', 'agents', `${name}.md`),
    `---\nname: ${name}\n---\nBe brief.\n`,
  );
}

function errorOf(res: { body: unknown }): { code: string; message: string } {
  return (res.body as { error: { code: string; message: string } }).error;
}

const path = (s: Board) => `/api/projects/${s.project.id}/workflow-graph`;

/** The reviewer ↔ helper loop with a named Frontend helper using a skill and an agent file. */
function loopWithFrontend(): WorkflowGraph {
  const g = workflowTemplate('reviewer-helper-loop');
  return {
    ...g,
    template: 'custom',
    nodes: [
      ...g.nodes,
      {
        type: 'helper',
        id: 'frontend',
        label: 'Frontend helper',
        description: 'UI work',
        model: null,
        skills: ['ui-style'],
        agent: 'frontend-style',
        approvalMode: 'manual',
        maxInstances: 1,
        canStartHelpers: false,
      },
    ],
    edges: [
      ...g.edges,
      { type: 'assigns', id: 'assigns-frontend', from: 'orchestrate', to: 'frontend' },
      { type: 'review', id: 'review-frontend', from: 'frontend', to: 'orchestrate' },
    ],
  };
}

describe('GET /api/projects/:id/workflow-graph (ADR-0023)', () => {
  it('answers the default workflow migrated, with its issues, the setup and the files', async () => {
    const s = await setupBoard();
    addSkill(s.repo, 'ui-style');
    addAgentFile(s.repo, 'frontend-style');
    const res = await s.get(path(s));
    expect(res.status).toBe(200);
    const dto = WorkflowGraphDtoSchema.parse(res.body);
    const mode = approvalsOf(dto.setup).mode;
    const expected = migrateWorkflowV1(defaultProjectWorkflow(s.project.id, s.project.createdAt), {
      projectMode: mode,
    });
    expect(dto).toMatchObject({ stored: 'default', updatedAt: null, graph: expected });
    expect(dto.skills).toEqual(['ui-style']);
    expect(dto.agents).toEqual(['frontend-style']);
    expect(dto.issues).toEqual(
      validateWorkflowGraph(expected, {
        skills: ['ui-style'],
        agents: ['frontend-style'],
        maxConcurrentHelpers: dto.setup.maxConcurrentHelpers,
        projectMode: mode,
      }),
    );
  });

  it('answers a saved version 1 workflow migrated with the project mode', async () => {
    const s = await setupBoard();
    const base = defaultProjectWorkflow(s.project.id, s.project.createdAt);
    const v1 = { plannerMode: 'separate' as const, stages: base.stages };
    expect((await s.send('put', `/api/projects/${s.project.id}/workflow`, v1)).status).toBe(200);
    const dto = WorkflowGraphDtoSchema.parse((await s.get(path(s))).body);
    expect(dto.stored).toBe('v1');
    expect(dto.updatedAt).toBe('2026-10-16T09:00:00.000Z');
    expect(dto.graph.nodes.some((n) => n.type === 'planner' && n.id === 'plan')).toBe(true);
    expect(dto.graph.legacyV1).toEqual(v1);
  });

  it('is 404 for an unknown project', async () => {
    const s = await setupBoard();
    const res = await s.get('/api/projects/nope/workflow-graph');
    expect(res.status).toBe(404);
    expect(errorOf(res).code).toBe('not_found');
  });
});

describe('PUT /api/projects/:id/workflow-graph (ADR-0023)', () => {
  it('stores a valid graph as version 2 and answers it with its warnings', async () => {
    const s = await setupBoard();
    addSkill(s.repo, 'ui-style');
    s.notices.length = 0;
    const graph = loopWithFrontend();
    const res = await s.send('put', path(s), { graph });
    expect(res.status).toBe(200);
    const dto = WorkflowGraphDtoSchema.parse(res.body);
    expect(dto).toMatchObject({ stored: 'v2', graph, updatedAt: '2026-10-16T09:00:00.000Z' });
    // The agent file is not in the project: a warning, never a refusal.
    expect(dto.issues.map((i) => [i.code, i.severity])).toContainEqual([
      'missing-agent-file',
      'warning',
    ]);
    expect(
      s.notices.some((n) => n.kind === 'projects-changed' && n.projectIds.includes(s.project.id)),
    ).toBe(true);
    expect(WorkflowGraphDtoSchema.parse((await s.get(path(s))).body)).toEqual(dto);
    expect(createRedesignRepositories(s.db).workflow.stored(s.project.id)).toMatchObject({
      kind: 'v2',
    });
  });

  it('answers 422 workflow_invalid with a plain summary for a graph with errors, saving nothing', async () => {
    const s = await setupBoard();
    const g = workflowTemplate('lead-only');
    const broken = { ...g, edges: g.edges.filter((e) => e.type !== 'merge') };
    const res = await s.send('put', path(s), { graph: broken });
    expect(res.status).toBe(422);
    expect(errorOf(res).code).toBe('workflow_invalid');
    expect(errorOf(res).message).toMatch(/^The workflow was not saved: it has \d+ problems?\./);
    expect(createRedesignRepositories(s.db).workflow.isStored(s.project.id)).toBe(false);
  });

  it('refuses a body that is not a graph with 400, and a missing or wrong CSRF token with 403', async () => {
    const s = await setupBoard();
    const graph = workflowTemplate('lead-only');
    for (const body of [
      {},
      { graph: { ...graph, version: 1 } },
      { graph: { ...graph, nodes: [] } },
    ]) {
      const res = await s.send('put', path(s), body);
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(errorOf(res).code).toBe('invalid_request');
    }
    const missing = await request(s.app).put(path(s)).send({ graph });
    expect(missing.status).toBe(403);
    const wrong = await request(s.app)
      .put(path(s))
      .set(CSRF_HEADER, 'f'.repeat(64))
      .send({ graph });
    expect(wrong.status).toBe(403);
    const validate = await request(s.app)
      .post(`${path(s)}/validate`)
      .send({ graph });
    expect(validate.status).toBe(403);
    expect(createRedesignRepositories(s.db).workflow.isStored(s.project.id)).toBe(false);
  });

  it('is 404 for an unknown project', async () => {
    const s = await setupBoard();
    const graph = workflowTemplate('lead-only');
    expect((await s.send('put', '/api/projects/nope/workflow-graph', { graph })).status).toBe(404);
  });
});

describe('POST /api/projects/:id/workflow-graph/validate (ADR-0023)', () => {
  it('answers the validator’s issues and ok, and never saves', async () => {
    const s = await setupBoard();
    const good = workflowTemplate('todays-setup');
    const ok = ValidateWorkflowGraphResultDtoSchema.parse(
      (await s.post(`${path(s)}/validate`, { graph: good })).body,
    );
    expect(ok.ok).toBe(true);
    const broken = { ...good, edges: good.edges.filter((e) => e.type !== 'findings') };
    const res = await s.post(`${path(s)}/validate`, { graph: broken });
    expect(res.status).toBe(200);
    const bad = ValidateWorkflowGraphResultDtoSchema.parse(res.body);
    expect(bad.ok).toBe(false);
    expect(bad.issues.map((i) => i.code)).toContain('reviewer-no-findings');
    expect(createRedesignRepositories(s.db).workflow.isStored(s.project.id)).toBe(false);
  });
});

describe('version 1 routes once a graph is stored (ADR-0023 §9)', () => {
  it('answer 409 workflow_is_graph and never overwrite the graph', async () => {
    const s = await setupBoard();
    const graph = workflowTemplate('reviewer-helper-loop');
    expect((await s.send('put', path(s), { graph })).status).toBe(200);
    const get = await s.get(`/api/projects/${s.project.id}/workflow`);
    expect(get.status).toBe(409);
    expect(errorOf(get).code).toBe('workflow_is_graph');
    const base = defaultProjectWorkflow(s.project.id, s.project.createdAt);
    const put = await s.send('put', `/api/projects/${s.project.id}/workflow`, {
      plannerMode: 'lead',
      stages: base.stages,
    });
    expect(put.status).toBe(409);
    expect(errorOf(put).code).toBe('workflow_is_graph');
    expect(WorkflowGraphDtoSchema.parse((await s.get(path(s))).body).graph).toEqual(graph);
  });

  it('keep working for a version 1 project', async () => {
    const s = await setupBoard();
    const base = defaultProjectWorkflow(s.project.id, s.project.createdAt);
    const body = { plannerMode: 'lead' as const, stages: base.stages };
    expect((await s.send('put', `/api/projects/${s.project.id}/workflow`, body)).status).toBe(200);
    expect((await s.get(`/api/projects/${s.project.id}/workflow`)).status).toBe(200);
  });
});
