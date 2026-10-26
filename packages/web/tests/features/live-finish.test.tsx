import { RunDetailDtoSchema, RunWorkflowGraphDtoSchema } from '@acp/core/api';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  LIVE_GRAPH_PATH,
  directLoopRunGraph,
  directLoopScenario,
} from '../../e2e/live-graph-fixtures';
import {
  CSRF,
  LOOP_RUN_PATH,
  LOOP_TICKET_ID,
  type LoopScenario,
} from '../../e2e/review-loop-fixtures';
import { buildLiveGraph, finishState } from '../../src/features/ticket/live-graph';
import { TicketPage } from '../../src/features/ticket/TicketPage';
import { fakeServer, renderWithApi } from '../helpers';

/*
 * v0.3.1 P-B (ADR-0028) on the ticket page: the live run graph's Finish block (the run's ticket
 * merge, your merge and Done as one block, with the run's real target branch) and an agent block's
 * effort on the graph and in the agent's Details. Synthetic fixtures (e2e/live-graph-fixtures.ts).
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

type Json = Record<string, unknown>;

/** The scenario with the run's target branch, the end steps' states and the lead's effort set. */
function scenario(o: { target?: string; states?: Record<string, string>; effort?: string } = {}) {
  const sc = directLoopScenario();
  const run = sc.routes[LOOP_RUN_PATH] as Json;
  const graph = sc.routes[LIVE_GRAPH_PATH] as Json;
  const inner = graph['graph'] as Json;
  const routes = {
    ...sc.routes,
    [LOOP_RUN_PATH]:
      o.target === undefined
        ? run
        : { ...run, ticketBranch: { ...(run['ticketBranch'] as Json), baseBranch: o.target } },
    [LIVE_GRAPH_PATH]: {
      ...graph,
      nodes: (graph['nodes'] as Json[]).map((n) => {
        const state = o.states?.[n['nodeId'] as string];
        return state === undefined ? n : { ...n, state };
      }),
      graph: {
        ...inner,
        nodes: (inner['nodes'] as Json[]).map((n) =>
          n['id'] === 'orchestrate' && o.effort !== undefined ? { ...n, effort: o.effort } : n,
        ),
      },
    },
  };
  return { routes } satisfies LoopScenario;
}

function render(sc: LoopScenario) {
  const s = fakeServer({ ...sc.routes, '/api/control/token': { token: CSRF } });
  window.location.hash = '#?tab=agents';
  renderWithApi(<TicketPage id={LOOP_TICKET_ID} />, s);
  return s;
}

const block = (id: string) => screen.getByTestId(`live-block-${id}`);
const states = (m: Record<string, string>) =>
  new Map(Object.entries(m).map(([k, state]) => [k, { state: state as 'waiting' }]));

describe('the live Finish block (model)', () => {
  it('takes its state from the three end steps', () => {
    const parts = { ticketMerge: 'ticket-merge', ownerMerge: 'owner-merge', done: 'done' };
    expect(finishState(parts, states({}))).toBe('waiting');
    expect(finishState(parts, states({ 'ticket-merge': 'active' }))).toBe('waiting');
    expect(finishState(parts, states({ 'ticket-merge': 'failed' }))).toBe('failed');
    expect(finishState(parts, states({ 'owner-merge': 'needs-you' }))).toBe('needs-you');
    expect(finishState(parts, states({ 'owner-merge': 'done', done: 'done' }))).toBe('done');
  });

  it('is one block with the run’s target, in place of the three end steps', () => {
    const dto = RunWorkflowGraphDtoSchema.parse(directLoopRunGraph());
    const run = RunDetailDtoSchema.parse(scenario({ target: 'develop' }).routes[LOOP_RUN_PATH]);
    const g = buildLiveGraph(dto, run);
    const finish = g.nodes.find((n) => n.id === 'owner-merge');
    expect(finish).toMatchObject({ type: 'finish', data: { target: 'develop' } });
    expect(finish?.ariaLabel).toBe('Finish: merge into develop or open a pull request, then Done');
    expect(g.nodes.some((n) => n.id === 'done' || n.id === 'ticket-merge')).toBe(false);
    // Before the ticket branch exists, the target is not known yet.
    const early = buildLiveGraph(dto, { ...run, ticketBranch: null });
    expect(early.nodes.find((n) => n.id === 'owner-merge')?.data.target).toBeNull();
  });
});

describe('the live Finish block and effort on the ticket page', () => {
  it('shows Finish with the run’s target, then a Done tick once the ticket is done', async () => {
    render(scenario({ target: 'develop' }));
    await screen.findByTestId('live-run-graph');
    const finish = within(screen.getByTestId('live-node-owner-merge'));
    expect(finish.getByText('Finish')).toBeTruthy();
    expect(finish.getByTestId('live-finish-text').textContent).toBe(
      'Merge into develop or open a pull request',
    );
    expect(finish.getByTestId('live-finish-done').dataset['done']).toBe('false');
    expect(screen.queryByTestId('live-block-done')).toBeNull();
    expect(screen.queryByTestId('live-block-ticket-merge')).toBeNull();
  });

  it('turns green with Done when the run is done', async () => {
    render(scenario({ states: { 'ticket-merge': 'done', 'owner-merge': 'done', done: 'done' } }));
    await screen.findByTestId('live-run-graph');
    expect(block('owner-merge').dataset['state']).toBe('done');
    const tick = screen.getByTestId('live-finish-done');
    expect(tick.dataset['done']).toBe('true');
    expect(tick.textContent).toBe('Done');
  });

  it('shows the block’s effort on the graph and in the agent’s Details', async () => {
    render(scenario({ effort: 'high' }));
    await screen.findByTestId('live-run-graph');
    expect(within(block('orchestrate')).getByTestId('live-effort').textContent).toBe('High effort');
    expect(within(block('api-helper')).queryByTestId('live-effort')).toBeNull();
    fireEvent.click(screen.getByTestId('live-node-orchestrate'));
    const panel = () => screen.getByTestId('side-panel');
    await waitFor(() =>
      expect(within(panel()).getByRole('heading', { name: 'Lead' })).toBeTruthy(),
    );
    fireEvent.click(within(panel()).getByRole('tab', { name: 'Details' }));
    const row = await within(panel()).findByTestId('details-effort');
    expect(row.textContent).toBe('High');
  });
});
