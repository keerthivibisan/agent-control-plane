import {
  WorkflowGraphSchema,
  canConnect,
  validateWorkflowGraph,
  workflowTemplate,
  type WorkflowGraph,
} from '@acp/core';
import { WorkflowGraphDtoSchema, type WorkflowGraphDto } from '@acp/core/api';
import { fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  WF_CSRF,
  WF_PROJECT_ID,
  agentFilesFixture,
  customGraph,
  graphDto,
  setupFixture,
} from '../../e2e/workflow-fixtures';
import { finishIssues, finishView } from '../../src/features/workflow/finish';
import { IssuesList, type EditorIssue } from '../../src/features/workflow/editor/IssuesList';
import { hasErrors } from '../../src/features/workflow/editor/issues';
import {
  editorReducer,
  initialEditorState,
  isRemovable,
  patchNode,
  resolveLink,
  type EditorAction,
} from '../../src/features/workflow/editor/state';
import { WorkflowPage } from '../../src/features/workflow/WorkflowPage';
import { fakeServer, jsonResponse, renderWithApi } from '../helpers';

/*
 * v0.3.1 P-B (ADR-0028), the web side: the effort per agent block, Checks blocks that can all be
 * removed, the warning list, and the Finish block that stands for the three end steps. The tests
 * use graphs that are valid under the rules before and after ADR-0028's core change, and never
 * mock core: whether the merge block's removal is an error or a warning is core's answer.
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

const BASE = `/api/projects/${WF_PROJECT_ID}`;
const GRAPH = `${BASE}/workflow-graph`;
const parse = (dto: unknown): WorkflowGraphDto => WorkflowGraphDtoSchema.parse(dto);
const graphOf = (g: unknown): WorkflowGraph => WorkflowGraphSchema.parse(g);

const GIT_FLOW = {
  preset: 'git-flow',
  baseBranch: 'develop',
  defaultTargetBranch: 'develop',
  ticketBranchTemplate: '{type}/{key}-{slug}',
  typeWords: { feature: 'feature', bug: 'bugfix', chore: 'chore', harness: 'chore' },
};

function server(initial: unknown) {
  let current = parse(initial);
  return fakeServer({
    '/api/control/token': { token: WF_CSRF },
    [`${BASE}/agents`]: agentFilesFixture(),
    [GRAPH]: () => jsonResponse(200, current),
    [`PUT ${GRAPH}`]: (body: unknown) => {
      const graph = WorkflowGraphSchema.parse((body as { graph: unknown }).graph);
      current = { ...current, graph, stored: 'v2', issues: validateWorkflowGraph(graph) };
      return jsonResponse(200, current);
    },
  });
}

function render(initial: unknown) {
  const s = server(initial);
  return { server: s, ...renderWithApi(<WorkflowPage projectId={WF_PROJECT_ID} />, s) };
}

const panel = () => screen.getByRole('complementary', { name: 'Block settings' });

async function select(id: string) {
  fireEvent.click(await screen.findByTestId(`block-${id}`));
  await waitFor(() => expect(panel().querySelector(`[data-node="${id}"]`)).not.toBeNull());
}

function run(graph: WorkflowGraph, ...actions: EditorAction[]) {
  return actions.reduce(editorReducer, initialEditorState(graph));
}

describe('effort per agent block', () => {
  it('the Effort select saves `effort`, shows a chip, and Default drops the field', async () => {
    const { server: s } = render(graphDto());
    await select('orchestrate');
    const field = within(panel()).getByTestId('effort-field');
    const effort = within(field).getByRole('combobox', { name: 'Effort' });
    expect((effort as HTMLSelectElement).value).toBe('default');
    expect(
      within(field)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Default (the model decides)', 'Low', 'Medium', 'High']);
    expect(field.textContent).toContain(
      'How much the agent thinks before acting: more effort is slower and uses more tokens.',
    );
    // No chip while the block uses the model's default.
    expect(
      within(screen.getByTestId('block-orchestrate')).queryByTestId('block-effort'),
    ).toBeNull();

    fireEvent.change(effort, { target: { value: 'high' } });
    const chip = within(screen.getByTestId('block-orchestrate')).getByTestId('block-effort');
    expect(chip.textContent).toBe('High effort');
    fireEvent.click(screen.getByTestId('save-workflow'));
    await screen.findByTestId('saved');
    const put = s.calls.filter((c) => c.method === 'PUT' && c.path === GRAPH);
    const saved = graphOf((put[0]?.body as { graph: unknown }).graph);
    expect(saved.nodes.find((n) => n.id === 'orchestrate')).toMatchObject({ effort: 'high' });

    // Back to Default: the field is dropped, not stored as null.
    fireEvent.change(within(panel()).getByRole('combobox', { name: 'Effort' }), {
      target: { value: 'default' },
    });
    expect(
      within(screen.getByTestId('block-orchestrate')).queryByTestId('block-effort'),
    ).toBeNull();
    fireEvent.click(screen.getByTestId('save-workflow'));
    await waitFor(() =>
      expect(s.calls.filter((c) => c.method === 'PUT' && c.path === GRAPH)).toHaveLength(2),
    );
    const again = s.calls.filter((c) => c.method === 'PUT' && c.path === GRAPH)[1];
    const node = (again?.body as { graph: { nodes: Record<string, unknown>[] } }).graph.nodes.find(
      (n) => n['id'] === 'orchestrate',
    );
    expect(node !== undefined && 'effort' in node).toBe(false);
  });

  it('patchNode sets and clears effort on agent blocks only', () => {
    const g = graphOf(customGraph());
    const lead = g.nodes.find((n) => n.id === 'orchestrate');
    const ticket = g.nodes.find((n) => n.id === 'ticket');
    if (lead === undefined || ticket === undefined) throw new Error('fixture');
    const low = patchNode(lead, { effort: 'low' });
    expect(low).toMatchObject({ effort: 'low' });
    expect('effort' in patchNode(low, { effort: null })).toBe(false);
    // A patch without the field keeps it.
    expect(patchNode(low, { label: 'Lead 2' })).toMatchObject({ effort: 'low', label: 'Lead 2' });
    expect(patchNode(ticket, { effort: 'high' })).toBe(ticket);
  });
});

describe('Checks blocks are optional (ADR-0028 §2)', () => {
  it('the merge block can be removed and added back in the same place', () => {
    const g = workflowTemplate('todays-setup');
    const merge = g.nodes.find((n) => n.type === 'checks');
    expect(merge !== undefined && isRemovable(merge)).toBe(true);
    const removed = run(g, { type: 'remove-node', id: 'checks' }).graph;
    expect(removed.nodes.some((n) => n.type === 'checks')).toBe(false);
    expect(removed.edges.some((e) => e.from === 'checks' || e.to === 'checks')).toBe(false);
    // The lead merges straight into the ticket branch exactly when core allows that link.
    const isDirect = (e: { from: string; to: string }) =>
      e.from === 'orchestrate' && e.to === 'ticket-merge';
    const unlinked = { ...removed, edges: removed.edges.filter((e) => !isDirect(e)) };
    expect(removed.edges.some(isDirect)).toBe(
      canConnect(unlinked, 'orchestrate', 'ticket-merge', 'merge').ok,
    );

    const back = run(removed, { type: 'add-checks', place: 'merge' });
    const id = back.selection?.id ?? '';
    expect(back.graph.nodes.find((n) => n.id === id)).toMatchObject({
      type: 'checks',
      place: 'merge',
      select: { kind: 'required' },
      onFailure: 'lead',
    });
    const has = (type: string, from: string, to: string) =>
      back.graph.edges.some((e) => e.type === type && e.from === from && e.to === to);
    expect(has('merge', 'orchestrate', id)).toBe(true);
    expect(has('flow', id, 'ticket-merge')).toBe(true);
    expect(back.graph.edges.some((e) => e.from === 'orchestrate' && e.to === 'ticket-merge')).toBe(
      false,
    );
    // Back as valid as the template it came from.
    const errors = (graph: WorkflowGraph) =>
      validateWorkflowGraph(graph)
        .filter((i) => i.severity === 'error')
        .map((i) => i.code);
    expect(errors(back.graph)).toEqual(errors(g));
    // Only one block before the merge.
    expect(run(back.graph, { type: 'add-checks', place: 'merge' }).graph).toBe(back.graph);
  });

  it('Add block → Checks offers the three places; the merge block’s panel can remove it', async () => {
    render(graphDto({ graph: customGraph(), stored: 'v2' }));
    await screen.findByTestId('graph-editor');
    fireEvent.click(screen.getByTestId('add-block'));
    const merge = screen.getByTestId('palette-checks-merge');
    expect(merge.textContent).toContain('Checks before merge');
    // The workflow already has one: offered, disabled, with the reason in plain sight.
    expect(merge.getAttribute('data-disabled')).not.toBeNull();
    expect(merge.textContent).toContain('already has checks before the merge');
    expect(screen.getByTestId('palette-checks-change').textContent).toContain('Checks on a change');
    expect(screen.getByTestId('palette-checks-branch').textContent).toContain(
      'Checks on the branch',
    );
    fireEvent.keyDown(screen.getByTestId('palette'), { key: 'Escape' });

    await select('checks');
    expect(within(panel()).getByTestId('check-optional').textContent).toBe(
      'Optional. Without it, the lead merges each change after its review, with no checks.',
    );
    expect(panel().textContent).toContain(
      'Runs the chosen checks on each change before the lead merges it into the ticket branch.',
    );
    expect(within(screen.getByTestId('block-checks')).getByTestId('checks-kind').textContent).toBe(
      'Checks before merge',
    );
    fireEvent.click(within(panel()).getByRole('button', { name: 'Remove block' }));
    expect(screen.queryByTestId('block-checks')).toBeNull();
    expect(screen.getByTestId('unsaved')).toBeTruthy();
  });

  it('the Problems list shows a warning, not an error, and saving is not blocked by it', () => {
    const warning: EditorIssue = {
      code: 'no-checks',
      severity: 'warning',
      message: 'No checks: changes merge after review only.',
    };
    expect(hasErrors([warning])).toBe(false);
    rtlRender(<IssuesList issues={[warning]} serverIssues={null} onFocus={() => undefined} />);
    const group = screen.getByTestId('issues-warnings');
    expect(group.textContent).toContain('Warnings (you can still save)');
    expect(group.textContent).toContain('No checks: changes merge after review only.');
    expect(screen.queryByTestId('issues-errors')).toBeNull();
  });
});

describe('the Finish block (ADR-0028 §3)', () => {
  it('stands for the three end steps; links around them keep their stored ids', () => {
    const g = graphOf(customGraph());
    const view = finishView(g);
    expect(view.finish).toEqual({
      ticketMerge: 'ticket-merge',
      ownerMerge: 'owner-merge',
      done: 'done',
    });
    const ids = view.graph.nodes.map((n) => n.id);
    expect(ids).toContain('owner-merge');
    expect(ids).not.toContain('ticket-merge');
    expect(ids).not.toContain('done');
    // checks → ticket merge → tester: drawn as checks → tester, with the stored id of the link
    // that leaves the ticket merge; your merge → Done is not drawn.
    const drawn = view.graph.edges.find((e) => e.id === 'flow-ticket-merge-unit-tests');
    expect(drawn).toMatchObject({ from: 'checks', to: 'unit-tests' });
    expect(view.graph.edges.some((e) => e.to === 'done' || e.from === 'done')).toBe(false);
    expect(view.graph.edges.some((e) => e.to === 'ticket-merge')).toBe(false);
    // Without a final stage, the merge block's link ends on the Finish block.
    const plain = finishView(workflowTemplate('todays-setup'));
    const into = plain.graph.edges.filter((e) => e.to === 'owner-merge');
    expect(into.map((e) => e.from)).toEqual(['checks']);
    // A problem with a hidden step, or a link not drawn, belongs to the Finish block.
    const shown = finishIssues(
      [
        { code: 'x', severity: 'error' as const, message: 'm', nodeId: 'done' },
        { code: 'y', severity: 'error' as const, message: 'm', edgeId: 'flow-owner-merge-done' },
      ],
      g,
      view,
    );
    expect(shown.map((i) => [i.nodeId, i.edgeId])).toEqual([
      ['owner-merge', undefined],
      ['owner-merge', undefined],
    ]);
  });

  it('a link drawn to the Finish block is stored on the ticket merge or your merge', () => {
    const g = graphOf(customGraph());
    // The tester flows into your merge.
    expect(resolveLink({ ...g, edges: [] }, 'unit-tests', 'owner-merge')).toMatchObject({
      to: 'owner-merge',
      types: ['flow'],
    });
    // The merge block flows into the ticket merge.
    const without = { ...g, edges: g.edges.filter((e) => e.id !== 'flow-checks-ticket-merge') };
    expect(resolveLink(without, 'checks', 'owner-merge')).toMatchObject({
      from: 'checks',
      to: 'ticket-merge',
      types: ['flow'],
    });
  });

  it('renders one block with the project’s target, and saving keeps the three nodes', async () => {
    const original = graphOf(customGraph());
    const { server: s } = render(
      graphDto({
        graph: customGraph(),
        stored: 'v2',
        setup: setupFixture({
          approvals: { mode: 'auto-edits', commands: [] },
          branching: GIT_FLOW,
        }),
      }),
    );
    const finish = await screen.findByTestId('block-owner-merge');
    expect(finish.dataset['kind']).toBe('finish');
    expect(within(finish).getByTestId('block-label').textContent).toBe('Finish');
    expect(within(finish).getByTestId('finish-text').textContent).toBe(
      'Merge into develop or open a pull request',
    );
    expect(within(finish).getByTestId('finish-done').textContent).toBe('then Done');
    expect(screen.queryByTestId('block-ticket-merge')).toBeNull();
    expect(screen.queryByTestId('block-done')).toBeNull();

    await select('owner-merge');
    expect(panel().textContent).toContain(
      'You finish every ticket: merge it into develop here, or push it and open a pull request. Nothing merges without your click.',
    );
    expect(within(panel()).getByTestId('block-fixed').textContent).toContain('can’t be removed');
    expect(within(panel()).queryByRole('button', { name: 'Remove block' })).toBeNull();

    // A change elsewhere, then Save: the three end steps and their links are stored as they were.
    await select('unit-tests');
    fireEvent.change(within(panel()).getByRole('combobox', { name: 'Effort' }), {
      target: { value: 'medium' },
    });
    fireEvent.click(screen.getByTestId('save-workflow'));
    await screen.findByTestId('saved');
    const put = s.calls.find((c) => c.method === 'PUT' && c.path === GRAPH);
    const saved = graphOf((put?.body as { graph: unknown }).graph);
    const end = (graph: WorkflowGraph) => ({
      nodes: graph.nodes.filter((n) => ['ticket-merge', 'owner-merge', 'done'].includes(n.type)),
      edges: graph.edges.filter((e) =>
        ['ticket-merge', 'owner-merge', 'done'].some((id) => e.from === id || e.to === id),
      ),
    });
    expect(end(saved)).toEqual(end(original));
    expect(saved.edges).toEqual(original.edges);
  });

  it('says “your target branch” when the project has no branching strategy', async () => {
    render(graphDto());
    const finish = await screen.findByTestId('block-owner-merge');
    expect(within(finish).getByTestId('finish-text').textContent).toBe(
      'Merge into your target branch or open a pull request',
    );
  });
});
