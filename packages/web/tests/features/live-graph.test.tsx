import { validateWorkflowGraph, WorkflowGraphSchema, type WorkflowGraph } from '@acp/core';
import {
  RunDetailDtoSchema,
  RunWorkflowGraphDtoSchema,
  WorkflowGraphDtoSchema,
  type RunWorkflowGraphDto,
} from '@acp/core/api';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  LIVE_GRAPH_PATH,
  PROJECT_GRAPH_PATH,
  carefulGraph,
  directLoopGraph,
  directLoopRunGraph,
  directLoopScenario,
} from '../../e2e/live-graph-fixtures';
import {
  CSRF,
  L_API,
  L_LEAD,
  L_REV2,
  L_UI,
  LOOP_PROJECT_WORKFLOW_PATH,
  LOOP_RUN_PATH,
  LOOP_TICKET_ID,
  LOOP_TICKET_PATH,
  type LoopScenario,
} from '../../e2e/review-loop-fixtures';
import {
  agentToShow,
  buildLiveGraph,
  heldBlock,
  layoutLiveGraph,
  reworkCounts,
  stageOfBlock,
} from '../../src/features/ticket/live-graph';
import { TicketPage } from '../../src/features/ticket/TicketPage';
import { fakeServer, jsonResponse, renderWithApi, type RouteTable } from '../helpers';

/*
 * WG-E (ADR-0023): the ticket page's live run graph from `GET /api/runs/:id/workflow-graph`: the
 * run's own blocks and links, states, agents, the editing blocks' modes and sandbox, the review
 * agent's direct rework (scenario c), the held final stage, and the version 1 view when the server
 * has no graph (404 or 409). Fixtures are synthetic (e2e/live-graph-fixtures.ts).
 */

beforeAll(() => {
  if (typeof globalThis.DOMMatrixReadOnly === 'undefined') {
    class Matrix {
      m22: number;
      constructor(transform?: string) {
        const scale = /scale\(([\d.]+)\)/.exec(transform ?? '')?.[1];
        this.m22 = scale === undefined ? 1 : Number(scale);
      }
    }
    Object.assign(globalThis, { DOMMatrixReadOnly: Matrix });
  }
  for (const prop of ['offsetWidth', 'offsetHeight'] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 800 });
  }
  Object.assign(SVGElement.prototype, {
    getBBox: () => ({ x: 0, y: 0, width: 0, height: 0 }),
  });
});

function render(sc: LoopScenario, routes: RouteTable = {}) {
  const s = fakeServer({ ...sc.routes, '/api/control/token': { token: CSRF }, ...routes });
  // The agents are on the Agents tab (v0.3.0 D-B).
  window.location.hash = '#?tab=agents';
  renderWithApi(<TicketPage id={LOOP_TICKET_ID} />, s);
  return s;
}

const dto = (): RunWorkflowGraphDto => RunWorkflowGraphDtoSchema.parse(directLoopRunGraph());
const runOf = (sc: LoopScenario = directLoopScenario()) =>
  RunDetailDtoSchema.parse(sc.routes[LOOP_RUN_PATH]);

/** The scenario with the graph route's answer replaced. */
function withGraph(edit: (g: Record<string, unknown>) => Record<string, unknown>): LoopScenario {
  const sc = directLoopScenario();
  return {
    routes: {
      ...sc.routes,
      [LIVE_GRAPH_PATH]: edit(sc.routes[LIVE_GRAPH_PATH] as Record<string, unknown>),
    },
  };
}

describe('live graph fixtures', () => {
  it('match the API contract, and the drawn workflow is valid', () => {
    const sc = directLoopScenario();
    expect(() => RunWorkflowGraphDtoSchema.parse(sc.routes[LIVE_GRAPH_PATH])).not.toThrow();
    expect(() => WorkflowGraphDtoSchema.parse(sc.routes[PROJECT_GRAPH_PATH])).not.toThrow();
    expect(() => RunDetailDtoSchema.parse(sc.routes[LOOP_RUN_PATH])).not.toThrow();
    for (const g of [directLoopGraph(), carefulGraph()]) {
      const graph = WorkflowGraphSchema.parse(g);
      const errors = validateWorkflowGraph(graph).filter((i) => i.severity === 'error');
      expect(errors).toEqual([]);
    }
  });
});

describe('the live graph model', () => {
  it('draws every block and link of the run’s graph, in three rows without positions', () => {
    const g = buildLiveGraph(dto(), runOf());
    expect(g.nodes.map((n) => n.id)).toEqual(
      WorkflowGraphSchema.parse(directLoopGraph()).nodes.map((n) => n.id),
    );
    expect(g.edges).toHaveLength((directLoopGraph().edges as unknown[]).length);
    const y = (id: string) => g.nodes.find((n) => n.id === id)?.position.y ?? -1;
    expect(y('ticket')).toBeLessThan(y('orchestrate'));
    expect(y('orchestrate')).toBeLessThan(y('checks'));
    // Helpers stack in their column: the API helper above the pool.
    expect(y('api-helper')).toBeLessThan(y('helpers'));
    expect(g.width).toBeGreaterThan(0);
    expect(g.height).toBeGreaterThan(0);
  });

  it('keeps the positions the owner gave the blocks in the editor', () => {
    const graph = WorkflowGraphSchema.parse(directLoopGraph());
    const moved: WorkflowGraph = {
      ...graph,
      nodes: graph.nodes.map((n) =>
        n.id === 'review' ? { ...n, position: { x: 900, y: 10 } } : n,
      ),
    };
    expect(layoutLiveGraph(moved).get('review')).toEqual({ x: 900, y: 10 });
  });

  it('counts the review agent’s direct rework on its link, apart from the lead’s', () => {
    const d = dto();
    const counts = reworkCounts(d.graph, d.nodes, runOf().changes ?? []);
    expect(counts.get('rework-review-api-helper')).toBe(1);
    expect(counts.get('rework-review-helpers')).toBe(0);
    expect(counts.get('rework-orchestrate-helpers')).toBe(0);
    const g = buildLiveGraph(d, runOf());
    const label = (id: string) => g.edges.find((e) => e.id === id)?.label;
    expect(label('rework-review-api-helper')).toBe('Direct rework ×1');
    expect(label('rework-review-helpers')).toBe('Direct rework');
    expect(label('rework-orchestrate-helpers')).toBe('Rework');
    expect(g.edges.find((e) => e.id === 'rework-review-api-helper')?.data).toMatchObject({
      direct: true,
      reworks: 1,
    });
    // A lead round counts on the lead's link, once per round (a decider's note is a second row).
    const leadRound = {
      id: 'r',
      round: 0,
      reviewer: 'lead' as const,
      reviewerAgentRunId: null,
      verdict: null,
      decision: 'rework' as const,
      decidedBy: 'lead' as const,
      commentId: null,
      createdAt: '2026-10-17T09:00:00.000Z',
      decidedAt: '2026-10-17T09:00:00.000Z',
    };
    const ui = (runOf().changes ?? []).find((c) => c.agentRunId === L_UI);
    if (ui === undefined) throw new Error('no change');
    const withLead = reworkCounts(d.graph, d.nodes, [
      { ...ui, reviews: [leadRound, { ...leadRound, id: 'r2' }] },
    ]);
    expect(withLead.get('rework-orchestrate-helpers')).toBe(1);
    expect(withLead.get('rework-review-helpers')).toBe(0);
  });

  it('carries each block’s agents, the run’s mode and the sandbox, and the direct reviewer', () => {
    const g = buildLiveGraph(dto(), runOf());
    const data = (id: string) => g.nodes.find((n) => n.id === id)?.data;
    expect(data('api-helper')).toMatchObject({
      mode: 'auto-edits',
      sandbox: true,
      state: 'active',
    });
    expect(data('api-helper')?.agents.map((a) => a.id)).toEqual([L_API]);
    expect(data('helpers')).toMatchObject({ mode: 'auto-edits', sandbox: false });
    expect(data('review')).toMatchObject({ direct: true, mode: null });
    expect(data('orchestrate')?.agents.map((a) => a.id)).toEqual([L_LEAD]);
    // A block the server does not list waits.
    const partial = { ...dto(), nodes: dto().nodes.filter((n) => n.nodeId !== 'done') };
    expect(buildLiveGraph(partial, runOf()).nodes.find((n) => n.id === 'done')?.data.state).toBe(
      'waiting',
    );
  });

  it('picks the working agent of a block, and maps blocks to the side panel', () => {
    const agents = runOf().agents.filter((a) => a.kind === 'reviewer');
    expect(agentToShow(agents)?.id).toBe(L_REV2);
    const graph = WorkflowGraphSchema.parse(directLoopGraph());
    const node = (id: string) => {
      const n = graph.nodes.find((x) => x.id === id);
      if (n === undefined) throw new Error(id);
      return n;
    };
    expect(stageOfBlock(node('review'))).toBe('review');
    expect(stageOfBlock(node('code-review'))).toBe('code-review');
    expect(stageOfBlock(node('api-helper'))).toBe('helpers');
    expect(stageOfBlock(node('orchestrate'))).toBe('orchestrate');
  });

  it('finds a held final stage only while the run waits in review with nobody on it', () => {
    const d = dto();
    const held = {
      ...d,
      nodes: d.nodes.map((n) =>
        n.nodeId === 'code-review' ? { ...n, state: 'needs-you' as const } : n,
      ),
    };
    const run = runOf();
    expect(heldBlock(held, { ...run, status: 'REVIEW' })?.id).toBe('code-review');
    expect(heldBlock(held, run)).toBeNull();
    expect(heldBlock(d, { ...run, status: 'REVIEW' })).toBeNull();
  });
});

describe('the live graph on the ticket page', () => {
  const block = (id: string) => screen.getByTestId(`live-block-${id}`);

  it('shows the run’s blocks with their states, modes, sandbox and the direct rework', async () => {
    render(directLoopScenario());
    const graph = await screen.findByTestId('live-run-graph');
    expect(
      within(screen.getByTestId('live-workflow')).getByRole('heading', { name: 'Workflow' }),
    ).toBeTruthy();
    expect(graph.dataset.template).toBe('custom');
    expect(block('orchestrate').dataset.state).toBe('active');
    expect(within(block('orchestrate')).getByTestId('stage-state-word').textContent).toBe(
      'Working',
    );
    expect(block('code-review').dataset.state).toBe('waiting');
    expect(block('plan-approval').dataset.state).toBe('done');
    // The editing blocks: the mode this run gives them; the Full auto block keeps the sandbox.
    const api = block('api-helper');
    expect(within(api).getByTestId('live-mode').textContent).toBe('Mode: Auto edits');
    expect(within(api).getByTestId('live-sandbox').textContent).toBe('Sandboxed');
    expect(within(block('helpers')).getByTestId('live-mode').dataset.mode).toBe('auto-edits');
    expect(within(block('helpers')).queryByTestId('live-sandbox')).toBeNull();
    // Read-only blocks have no mode; the change reviewer says it reworks directly.
    expect(within(block('review')).queryByTestId('live-mode')).toBeNull();
    expect(within(block('review')).getByTestId('live-direct').textContent).toBe(
      'Sends changes back to the helper itself',
    );
    expect(screen.getByTestId('review-counts').textContent).toBe('1 in review · 1 in rework');
    // The version 1 stages are not drawn.
    expect(screen.queryByTestId('wf-node-review')).toBeNull();
  });

  it('clicking an agent on a block shows that agent; clicking a block its working agent', async () => {
    render(directLoopScenario());
    await screen.findByTestId('live-run-graph');
    const panel = () => screen.getByTestId('side-panel');
    fireEvent.click(
      within(block('api-helper')).getByRole('button', {
        name: 'Show the API helper in the side panel',
      }),
    );
    await waitFor(() =>
      expect(within(panel()).getByRole('heading', { name: 'API helper' })).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId('live-node-orchestrate'));
    await waitFor(() =>
      expect(within(panel()).getByRole('heading', { name: 'Lead' })).toBeTruthy(),
    );
  });

  it('draws every state in words', async () => {
    const states = ['off', 'waiting', 'active', 'needs-you', 'done', 'failed', 'skipped'] as const;
    const ids = ['orchestrate', 'api-helper', 'helpers', 'review', 'code-review'];
    render(
      withGraph((g) => ({
        ...g,
        nodes: (g['nodes'] as { nodeId: string }[]).map((n) => {
          const i = ids.indexOf(n.nodeId);
          return i < 0 ? n : { ...n, state: states[(i + 2) % states.length] };
        }),
      })),
    );
    await screen.findByTestId('live-run-graph');
    expect(block('orchestrate').dataset.state).toBe('active');
    expect(block('api-helper').dataset.state).toBe('needs-you');
    expect(within(block('api-helper')).getByTestId('stage-state-word').textContent).toBe(
      'Needs you',
    );
    expect(block('helpers').dataset.state).toBe('done');
    expect(block('review').dataset.state).toBe('failed');
    expect(within(block('review')).getByTestId('stage-state-word').textContent).toBe('Failed');
    expect(block('code-review').dataset.state).toBe('skipped');
    expect(within(block('code-review')).getByTestId('stage-state-word').textContent).toBe(
      'Skipped',
    );
  });

  it('offers Continue for a held final stage, by its block name', async () => {
    const sc = withGraph((g) => ({
      ...g,
      nodes: (g['nodes'] as { nodeId: string }[]).map((n) =>
        n.nodeId === 'code-review' ? { ...n, state: 'needs-you' } : n,
      ),
    }));
    const detail = sc.routes[LOOP_TICKET_PATH] as Record<string, unknown>;
    const run = { ...(detail['currentRun'] as Record<string, unknown>), status: 'REVIEW' };
    render({
      routes: {
        ...sc.routes,
        [LOOP_TICKET_PATH]: { ...detail, currentRun: run },
        [LOOP_RUN_PATH]: run,
      },
    });
    const held = await screen.findByTestId('held-stage');
    expect(held.dataset.stage).toBe('code-review');
    expect(held.textContent).toContain('Code reviewer is waiting for you');
  });

  it.each([404, 409])('keeps the version 1 stages when the server answers %i', async (status) => {
    render(directLoopScenario(), {
      [LIVE_GRAPH_PATH]: jsonResponse(status, {
        error: {
          code: status === 404 ? 'not_found' : 'conflict',
          message: 'no graph',
          requestId: 'r',
        },
      }),
    });
    expect(await screen.findByTestId('wf-node-review')).toBeTruthy();
    expect(screen.getByTestId('live-review').dataset.state).toBe('active');
    expect(screen.queryByTestId('live-run-graph')).toBeNull();
  });

  it('asks the project’s version 1 workflow only once the run’s version 1 route answers (WG-F)', async () => {
    // A server with graphs answers the run's graph or 404s both run routes (unknown run): the
    // project's version 1 route, which 409s for a project that stores a graph, is never asked.
    const notFound = () =>
      jsonResponse(404, { error: { code: 'not_found', message: 'no run', requestId: 'r' } });
    const s = render(directLoopScenario(), {
      [LIVE_GRAPH_PATH]: notFound,
      [`${LOOP_RUN_PATH}/workflow`]: notFound,
    });
    await screen.findByTestId('agent-canvas');
    await waitFor(() =>
      expect(s.calls.some((c) => c.path === `${LOOP_RUN_PATH}/workflow`)).toBe(true),
    );
    expect(screen.queryByTestId('live-workflow')).toBeNull();
    expect(s.calls.some((c) => c.path === LOOP_PROJECT_WORKFLOW_PATH)).toBe(false);
  });

  it('shows nothing on another error rather than the wrong graph', async () => {
    render(directLoopScenario(), {
      [LIVE_GRAPH_PATH]: jsonResponse(500, {
        error: { code: 'internal', message: 'boom', requestId: 'r' },
      }),
    });
    await screen.findByTestId('agent-canvas');
    expect(screen.queryByTestId('live-workflow')).toBeNull();
  });
});
