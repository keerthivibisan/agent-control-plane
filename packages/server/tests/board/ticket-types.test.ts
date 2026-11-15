import { describe, expect, it } from 'vitest';
import { workflowTemplateV3 } from '@acp/core';
import { RunWorkflowGraphDtoSchema, TicketDetailDtoSchema } from '@acp/core/api';
import { putGraph } from './graph-helpers.js';
import { setupBoard } from './helpers.js';
import type { Board } from './loop-helpers.js';

/*
 * ADR-0039 through the server: a ticket's run follows the graph its type runs. On the BDD template
 * a bug ticket starts without the Behaviour analyst and Scenario tests; a feature ticket starts
 * with the analyst researching before the lead plans. The fake managed adapter plays every agent.
 * Synthetic data only.
 */

async function start(s: Board, type: 'feature' | 'bug') {
  const ticket = await s.createTicket(type === 'bug' ? 'Fix the login crash' : 'Add dark mode', {
    type,
  });
  expect((await s.post(`/api/tickets/${ticket.id}/move`, { status: 'READY' })).status).toBe(200);
  const res = await s.post(`/api/tickets/${ticket.id}/start`, {});
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
  await s.settle();
  const runId = TicketDetailDtoSchema.parse(res.body).currentRun?.id ?? '';
  const view = RunWorkflowGraphDtoSchema.parse(
    (await s.get(`/api/runs/${runId}/workflow-graph`)).body,
  );
  return { runId, view, kinds: s.fake.agents.map((a) => a.spec.kind) };
}

describe('ticket types on the BDD template (ADR-0039)', () => {
  it('a bug ticket runs without the behaviour analyst and the scenario tests', async () => {
    const s = await setupBoard();
    await putGraph(s, workflowTemplateV3('bdd'));
    const { view, kinds } = await start(s, 'bug');
    const ids = view.graph.nodes.map((n) => n.id);
    expect(ids).not.toContain('behaviour');
    expect(ids).not.toContain('scenario-tests');
    expect(ids).toContain('developer');
    expect(ids).toContain('unit-tests');
    expect(view.nodes.map((n) => n.nodeId)).not.toContain('behaviour');
    // No researcher before the lead's plan.
    expect(kinds).toEqual(['lead']);
  });

  it('a feature ticket runs the analyst first, with every block', async () => {
    const s = await setupBoard();
    await putGraph(s, workflowTemplateV3('bdd'));
    const { view, kinds } = await start(s, 'feature');
    const ids = view.graph.nodes.map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining(['behaviour', 'scenario-tests', 'developer']));
    expect(kinds).toContain('researcher');
  });

  it('the saved workflow keeps every block; only the run leaves them out', async () => {
    const s = await setupBoard();
    await putGraph(s, workflowTemplateV3('bdd'));
    await start(s, 'bug');
    const saved = (await s.get(`/api/projects/${s.project.id}/workflow-graph`)).body as {
      graph: { nodes: { id: string }[] };
    };
    expect(saved.graph.nodes.map((n) => n.id)).toContain('behaviour');
  });
});
