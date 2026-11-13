import {
  MAX_EDGE_LABEL,
  MAX_EDGE_PURPOSE,
  WorkflowGraphSchema,
  canConnectV3,
  migrateWorkflowV2,
  validateWorkflowGraph,
  validateWorkflowGraphV3,
  type WorkflowGraphV3,
} from '@acp/core';
import { WorkflowGraphDtoSchema } from '@acp/core/api';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  WF_CSRF,
  WF_PROJECT_ID,
  agentFilesFixture,
  graphDto,
  migratedGraph,
} from '../../e2e/workflow-fixtures';
import { toFlowEdges } from '../../src/features/workflow/editor/flow';
import { editorIssues, shapeIssues } from '../../src/features/workflow/editor/issues';
import { linkChoices, linkOutcome } from '../../src/features/workflow/editor/linking';
import { graphRoles } from '../../src/features/workflow/editor/roles';
import {
  canSaveToServer,
  fromServerGraph,
  serverForm,
  toServerGraph,
} from '../../src/features/workflow/editor/server-graph';
import {
  editorReducer,
  initialEditorState,
  type EditorAction,
  type EditorState,
} from '../../src/features/workflow/editor/state';
import { WorkflowPage } from '../../src/features/workflow/WorkflowPage';
import { fakeServer, jsonResponse, renderWithApi } from '../helpers';

/*
 * AR-5a (ADR-0037): the workflow editor on version 3. One Agent block whose role comes from its
 * arrows, presets that draw the arrow, a role badge and its error state, the arrow menu with
 * Custom, an arrow's label and purpose, and the one adapter to the server's version 2 graph:
 * a graph version 2 can say is saved as version 2; one it can't (research or custom arrows, two
 * planners, a review fan-out, labels or purposes) stays editable and is never sent.
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

const base = (): WorkflowGraphV3 => fromServerGraph(WorkflowGraphSchema.parse(migratedGraph()));
const run = (graph: WorkflowGraphV3, ...actions: EditorAction[]): EditorState =>
  actions.reduce(editorReducer, initialEditorState(graph));
const kindOf = (g: WorkflowGraphV3, id: string) => graphRoles(g).kinds.get(id);
const has = (g: WorkflowGraphV3, type: string, from: string, to: string) =>
  g.edges.some((e) => e.type === type && e.from === from && e.to === to);
const errorCodes = (g: WorkflowGraphV3) =>
  validateWorkflowGraphV3(g)
    .filter((i) => i.severity === 'error')
    .map((i) => `${i.code}:${i.nodeId ?? ''}`);

describe('presets: an agent with its arrow drawn', () => {
  it('each preset adds one agent and the arrow that gives it its role', () => {
    const g = base();
    const cases = [
      { item: 'agent', id: 'agent-1', kind: 'agent', arrow: null },
      {
        item: 'researcher',
        id: 'research',
        kind: 'researcher',
        arrow: ['research', 'research', 'orchestrate'],
      },
      { item: 'planner', id: 'plan', kind: 'planner', arrow: ['plan', 'plan', 'plan-approval'] },
      {
        item: 'helper',
        id: 'helper-1',
        kind: 'helper',
        arrow: ['implement', 'orchestrate', 'helper-1'],
      },
      {
        item: 'final-reviewer',
        id: 'code-review',
        kind: 'reviewer-final',
        arrow: ['flow', 'ticket-merge', 'code-review'],
      },
      {
        item: 'tester',
        id: 'unit-tests',
        kind: 'tester',
        arrow: ['test', 'ticket-merge', 'unit-tests'],
      },
    ] as const;
    for (const c of cases) {
      const s = run(g, { type: 'add', item: c.item });
      expect(s.graph.nodes).toHaveLength(g.nodes.length + 1);
      expect(s.graph.nodes.find((n) => n.id === c.id)).toMatchObject({ type: 'agent' });
      expect(s.selection).toEqual({ kind: 'node', id: c.id });
      expect(kindOf(s.graph, c.id)).toBe(c.kind);
      if (c.arrow !== null) {
        const [type, from, to] = c.arrow;
        expect(has(s.graph, type, from, to)).toBe(true);
      } else expect(s.graph.edges.some((e) => e.from === c.id || e.to === c.id)).toBe(false);
    }
  });

  it('a researcher researches for the planner when there is one', () => {
    const s = run(base(), { type: 'add', item: 'planner' }, { type: 'add', item: 'researcher' });
    expect(has(s.graph, 'research', 'research', 'plan')).toBe(true);
    expect(kindOf(s.graph, 'research')).toBe('researcher');
    expect(errorCodes(s.graph)).toEqual([]);
  });

  it('a change reviewer reviews the selected helper, sends findings to the lead, and is valid', () => {
    const helper = run(base(), { type: 'add', item: 'helper' });
    expect(has(helper.graph, 'review', 'helper-1', 'orchestrate')).toBe(false);
    // Give the helper the lead's review first: the reviewer then takes its place.
    const toLead = run(helper.graph, {
      type: 'connect',
      from: 'helper-1',
      to: 'orchestrate',
      edgeType: 'review',
    }).graph;
    const s = run(toLead, { type: 'add', item: 'change-reviewer', near: 'helper-1' });
    const id = s.selection?.id ?? '';
    expect(kindOf(s.graph, id)).toBe('reviewer-change');
    expect(has(s.graph, 'review', 'helper-1', id)).toBe(true);
    expect(has(s.graph, 'findings', id, 'orchestrate')).toBe(true);
    expect(has(s.graph, 'review', 'helper-1', 'orchestrate')).toBe(false);
    expect(errorCodes(s.graph)).toEqual([]);
  });

  it('a second planner joins the plan path; removing both puts the lead’s path back', () => {
    const s = run(base(), { type: 'add', item: 'planner' }, { type: 'add', item: 'planner' });
    expect(has(s.graph, 'plan', 'plan-2', 'plan-approval')).toBe(true);
    expect(has(s.graph, 'flow', 'ticket', 'plan-2')).toBe(true);
    expect(errorCodes(s.graph)).toEqual([]);
    const gone = run(
      s.graph,
      { type: 'remove-node', id: 'plan' },
      { type: 'remove-node', id: 'plan-2' },
    );
    expect(has(gone.graph, 'flow', 'ticket', 'orchestrate')).toBe(true);
    expect(has(gone.graph, 'flow', 'orchestrate', 'plan-approval')).toBe(true);
    expect(errorCodes(gone.graph)).toEqual([]);
  });

  it('the helper pool is a helper with the pool switch; only one pool', () => {
    const s = run(base(), { type: 'add', item: 'helper' });
    // The migrated graph has a pool already: a second one is not made.
    expect(run(s.graph, { type: 'update-node', id: 'helper-1', patch: { pool: true } }).graph).toBe(
      s.graph,
    );
    const off = run(s.graph, { type: 'update-node', id: 'helpers', patch: { pool: false } }).graph;
    expect(kindOf(off, 'helpers')).toBe('helper');
    expect(off.nodes.find((n) => n.id === 'helpers')).not.toHaveProperty('pool');
    const on = run(off, { type: 'update-node', id: 'helper-1', patch: { pool: true } }).graph;
    expect(kindOf(on, 'helper-1')).toBe('helper-pool');
  });
});

describe('roles and arrows', () => {
  it('an agent with arrows asking for two roles is `agent-mixed-roles`; core refuses drawing it', () => {
    const s = run(base(), { type: 'add', item: 'planner' });
    // Drawing the lead's implement arrow to the planner is refused in core's words.
    const refused = editorReducer(s, {
      type: 'connect',
      from: 'orchestrate',
      to: 'plan',
      edgeType: 'implement',
    });
    expect(refused.graph).toBe(s.graph);
    expect(refused.refusal).toMatch(/already a planner/);
    // A stored graph with both arrows: the block's kind and the validator say so.
    const mixed: WorkflowGraphV3 = {
      ...s.graph,
      edges: [
        ...s.graph.edges,
        { type: 'implement', id: 'implement-x', from: 'orchestrate', to: 'plan' },
      ],
    };
    expect(kindOf(mixed, 'plan')).toBe('mixed');
    expect(errorCodes(mixed)).toContain('agent-mixed-roles:plan');
    expect(errorCodes(run(base(), { type: 'add', item: 'agent' }).graph)).toContain(
      'agent-without-role:agent-1',
    );
  });

  it('the arrow menu offers Custom between agents, and Custom always asks', () => {
    const g = run(base(), { type: 'add', item: 'agent' }).graph;
    const choices = linkChoices(g, 'agent-1');
    expect(choices.filter((c) => c.to === 'helpers').map((c) => c.type)).toEqual([
      'research',
      'custom',
    ]);
    for (const c of choices) expect(canConnectV3(g, c.link.from, c.link.to, c.type).ok).toBe(true);
    const out = linkOutcome(g, 'review', 'agent-1');
    expect(out.kind).toBe('choose');
    if (out.kind === 'choose') expect(out.option.types).toContain('custom');
  });

  it('label and purpose: set, dropped when empty, kept on the canvas and as hover text', () => {
    const g = base();
    const id = g.edges.find((e) => e.type === 'implement')?.id ?? '';
    const s = run(g, {
      type: 'update-edge',
      id,
      patch: { label: 'Build it', purpose: 'Small, reviewed steps.' },
    });
    expect(s.graph.edges.find((e) => e.id === id)).toMatchObject({
      label: 'Build it',
      purpose: 'Small, reviewed steps.',
    });
    const drawn = toFlowEdges(s.graph, [], null).find((e) => e.id === id);
    expect(drawn?.label).toBe('Build it');
    expect(drawn?.data?.purpose).toBe('Small, reviewed steps.');
    const cleared = run(s.graph, { type: 'update-edge', id, patch: { label: '  ', purpose: '' } });
    const edge = cleared.graph.edges.find((e) => e.id === id);
    expect(edge).not.toHaveProperty('label');
    expect(edge).not.toHaveProperty('purpose');
    // A rework arrow keeps its rounds next to its label.
    const rework = g.edges.find((e) => e.type === 'rework')?.id ?? '';
    const named = run(g, { type: 'update-edge', id: rework, patch: { label: 'Fix' } }).graph;
    expect(toFlowEdges(named, [], null).find((e) => e.id === rework)?.label).toBe(
      'Fix · Rework ×2',
    );
  });

  it('a label or purpose over its limit is a problem on the arrow', () => {
    const g = base();
    const id = g.edges[0]?.id ?? '';
    const long = run(g, {
      type: 'update-edge',
      id,
      patch: { label: 'x'.repeat(MAX_EDGE_LABEL + 1), purpose: 'y'.repeat(MAX_EDGE_PURPOSE + 1) },
    }).graph;
    const issues = shapeIssues(long);
    expect(issues.map((i) => [i.edgeId, i.message])).toEqual([
      [id, 'Label: Use at most 40 characters.'],
      [id, 'Purpose: Use at most 300 characters.'],
    ]);
    expect(editorIssues(long, {})[0]?.code).toBe('shape');
    const ok = run(g, { type: 'update-edge', id, patch: { label: 'x'.repeat(MAX_EDGE_LABEL) } });
    expect(shapeIssues(ok.graph)).toEqual([]);
  });
});

describe('the server adapter (until AR-4)', () => {
  it('a version 2 graph round-trips; a v2-expressible editor graph saves as version 2', () => {
    const v2 = WorkflowGraphSchema.parse(migratedGraph());
    expect(toServerGraph(fromServerGraph(v2))).toEqual(v2);
    const s = run(base(), { type: 'add', item: 'helper' }, { type: 'add', item: 'planner' });
    expect(canSaveToServer(s.graph)).toEqual({ ok: true });
    const sent = toServerGraph(s.graph);
    expect(sent?.version).toBe(2);
    expect(sent?.nodes.find((n) => n.id === 'helper-1')?.type).toBe('helper');
    expect(sent?.edges.some((e) => e.type === 'assigns' && e.to === 'helper-1')).toBe(true);
    expect(serverForm(s.graph)).toEqual(fromServerGraph(sent ?? v2));
  });

  it('names every version 3 part the server can’t store yet', () => {
    const g = base();
    const parts = (graph: WorkflowGraphV3) => {
      const c = canSaveToServer(graph);
      return c.ok ? [] : c.parts;
    };
    expect(parts(run(g, { type: 'add', item: 'researcher' }).graph)).toEqual(['research']);
    expect(
      parts(run(g, { type: 'add', item: 'planner' }, { type: 'add', item: 'planner' }).graph),
    ).toEqual(['planners']);
    const id = g.edges[0]?.id ?? '';
    expect(parts(run(g, { type: 'update-edge', id, patch: { purpose: 'why' } }).graph)).toEqual([
      'words',
    ]);
    const custom = run(g, { type: 'connect', from: 'review', to: 'helpers', edgeType: 'custom' });
    expect(parts(custom.graph)).toEqual(['custom']);
    const fanOut = run(g, { type: 'add', item: 'change-reviewer', near: 'helpers' }).graph;
    expect(parts(fanOut)).toEqual(['fan-out']);
    expect(toServerGraph(fanOut)).toBeNull();
  });
});

// ---------------------------------------------------------------- the page

const BASE = `/api/projects/${WF_PROJECT_ID}`;
const GRAPH = `${BASE}/workflow-graph`;

function render() {
  let current = WorkflowGraphDtoSchema.parse(graphDto());
  const server = fakeServer({
    '/api/control/token': { token: WF_CSRF },
    [`${BASE}/agents`]: agentFilesFixture(),
    [GRAPH]: () => jsonResponse(200, current),
    [`PUT ${GRAPH}`]: (body: unknown) => {
      const graph = WorkflowGraphSchema.parse((body as { graph: unknown }).graph);
      current = { ...current, graph, stored: 'v2', issues: validateWorkflowGraph(graph) };
      return jsonResponse(200, current);
    },
  });
  return { server, ...renderWithApi(<WorkflowPage projectId={WF_PROJECT_ID} />, server) };
}

const panel = () => screen.getByRole('complementary', { name: 'Block settings' });
function addBlock(name: RegExp) {
  fireEvent.click(screen.getByTestId('add-block'));
  fireEvent.click(screen.getByRole('menuitem', { name }));
}
const role = (id: string) => within(screen.getByTestId(`block-${id}`)).getByTestId('block-role');
const puts = (s: ReturnType<typeof render>['server']) =>
  s.calls.filter((c) => c.method === 'PUT' && c.path === GRAPH);

describe('Workflow page on version 3', () => {
  it('the menu has one Agent block and the presets; each block shows its role badge', async () => {
    render();
    await screen.findByTestId('graph-editor');
    expect(role('helpers').dataset.role).toBe('helper-pool');
    expect(role('review').dataset.role).toBe('reviewer-change');
    fireEvent.click(screen.getByTestId('add-block'));
    const names = within(screen.getByTestId('palette'))
      .getAllByRole('menuitem')
      .map((i) => i.dataset.testid);
    expect(names.slice(0, 7)).toEqual([
      'palette-agent',
      'palette-researcher',
      'palette-planner',
      'palette-helper',
      'palette-change-reviewer',
      'palette-final-reviewer',
      'palette-tester',
    ]);
    fireEvent.click(screen.getByTestId('palette-planner'));
    await waitFor(() => expect(role('plan').dataset.role).toBe('planner'));
    addBlock(/^Tester/);
    await waitFor(() => expect(role('unit-tests').dataset.role).toBe('tester'));
    addBlock(/^Agent/);
    await waitFor(() => expect(role('agent-1').dataset.role).toBe('agent'));
    // No role yet: the badge is in its error state, and the panel says why.
    expect(role('agent-1').dataset.problem).toBe('true');
    expect(role('agent-1').textContent).toContain('No role');
    expect(within(panel()).getByTestId('role-section').dataset.problem).toBe('true');
    expect(within(panel()).queryByTestId('mode-field')).toBeNull();
  });

  it('the node panel follows the role: mode and pool for helpers, none for read-only roles', async () => {
    render();
    await screen.findByTestId('graph-editor');
    addBlock(/^Helper/);
    await waitFor(() => expect(panel().querySelector('[data-node="helper-1"]')).not.toBeNull());
    expect(within(panel()).getByTestId('mode-field')).toBeTruthy();
    expect(within(panel()).getByRole('textbox', { name: 'What this helper is for' })).toBeTruthy();
    // The project's pool is taken: this helper can't be a second pool.
    expect(within(panel()).getByTestId<HTMLInputElement>('pool-toggle').disabled).toBe(true);
    addBlock(/^Planner/);
    await waitFor(() => expect(panel().querySelector('[data-node="plan"]')).not.toBeNull());
    expect(within(panel()).queryByTestId('mode-field')).toBeNull();
    expect(within(panel()).getByTestId('no-mode')).toBeTruthy();
    expect(within(panel()).getByTestId('role-section').dataset.role).toBe('planner');
    expect(within(panel()).getByTestId('provider-field')).toBeTruthy();
  });

  it('an arrow’s label and purpose are edited with counters; Custom is in “Link to…”', async () => {
    const { server } = render();
    await screen.findByTestId('graph-editor');
    addBlock(/^Agent/);
    await waitFor(() => expect(panel().querySelector('[data-node="agent-1"]')).not.toBeNull());
    fireEvent.click(within(panel()).getByTestId('link-to'));
    expect(screen.getByTestId('link-to-helpers-custom')).toBeTruthy();
    fireEvent.click(screen.getByTestId('link-to-helpers-custom'));
    const edgePanel = await within(panel()).findByTestId('edge-panel');
    expect(edgePanel.dataset.type).toBe('custom');
    expect(within(edgePanel).getByTestId('edge-from').textContent).toBe('Agent 1');
    expect(within(edgePanel).getByTestId('edge-to').textContent).toBe('Helpers');
    fireEvent.change(within(edgePanel).getByTestId('edge-label'), {
      target: { value: 'Hand-off' },
    });
    expect(within(edgePanel).getByTestId('edge-label-count').textContent).toBe('8/40');
    fireEvent.change(within(edgePanel).getByTestId('edge-purpose'), {
      target: { value: 'z'.repeat(301) },
    });
    expect(within(edgePanel).getByTestId('edge-purpose-error').textContent).toBe(
      'Use at most 300 characters.',
    );
    expect(screen.getByTestId('save-workflow').hasAttribute('disabled')).toBe(true);
    expect(puts(server)).toHaveLength(0);
  });

  it('a version 3 graph shows why it can’t be saved yet and is never sent', async () => {
    const { server } = render();
    await screen.findByTestId('graph-editor');
    addBlock(/^Researcher/);
    await waitFor(() => expect(role('research').dataset.role).toBe('researcher'));
    const notice = await screen.findByTestId('save-v3-only');
    expect(notice.dataset.parts).toBe('research');
    expect(notice.textContent).toContain('research arrows');
    const save = screen.getByTestId('save-workflow');
    expect(save.hasAttribute('disabled')).toBe(true);
    expect(save.getAttribute('aria-describedby')).toBe('workflow-save-v3');
    fireEvent.click(save);
    expect(puts(server)).toHaveLength(0);
    // Removing the v3 part makes it savable again, as version 2.
    fireEvent.click(within(panel()).getByRole('button', { name: 'Remove block' }));
    await waitFor(() => expect(screen.queryByTestId('save-v3-only')).toBeNull());
    addBlock(/^Final reviewer/);
    await waitFor(() => expect(save.hasAttribute('disabled')).toBe(false));
    fireEvent.click(save);
    await screen.findByTestId('saved');
    const body = puts(server)[0]?.body as { graph: unknown };
    const sent = WorkflowGraphSchema.parse(body.graph);
    expect(sent.version).toBe(2);
    expect(sent.nodes.find((n) => n.id === 'code-review')).toMatchObject({
      type: 'reviewer',
      scope: 'final',
    });
    // The refetched graph equals what was sent: no "Unsaved changes".
    expect(screen.queryByTestId('unsaved')).toBeNull();
    expect(migrateWorkflowV2(sent).nodes.some((n) => n.id === 'code-review')).toBe(true);
  });
});
