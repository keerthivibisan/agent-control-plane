import {
  AUTHOR_BLOCK_LABEL,
  FAILURE_EVENT_NAMES,
  WorkflowGraphSchema,
  describeWorkflow,
  migrateWorkflowV2,
  validateWorkflowGraphV3,
  type WorkflowEdgeV3,
  type WorkflowGraphV3,
} from '@acp/core';
import { RunDetailDtoSchema, RunWorkflowGraphDtoSchema } from '@acp/core/api';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { directLoopRunGraph, directLoopScenario } from '../../e2e/live-graph-fixtures';
import { LOOP_RUN_PATH } from '../../e2e/review-loop-fixtures';
import { migratedGraph } from '../../e2e/workflow-fixtures';
import { buildLiveGraph } from '../../src/features/ticket/live-graph';
import { EdgePanel } from '../../src/features/workflow/editor/EdgePanel';
import { Palette } from '../../src/features/workflow/editor/Palette';
import { failureSourceOf, newWhenEvents } from '../../src/features/workflow/editor/failure-routing';
import { toFlowEdges, toFlowNodes } from '../../src/features/workflow/editor/flow';
import { FlowWords } from '../../src/features/workflow/editor/FlowWords';
import type { EditorIssue } from '../../src/features/workflow/editor/IssuesList';
import {
  linkChoices,
  linkOutcome,
  reconnectTargets,
  resolveReconnect,
} from '../../src/features/workflow/editor/linking';
import {
  allowedEdgeTypes,
  authorAvailability,
  editorReducer,
  initialEditorState,
  resolveLink,
  type EditorAction,
  type EditorState,
  type Selection,
} from '../../src/features/workflow/editor/state';

/*
 * FR-6 (ADR-0038 §4–§5; docs/failure-routing/README.md FR-F): the editor's Author block, When
 * arrows (offered only where core allows them, events limited to what their source raises, rounds,
 * who receives a failure, the three new problems), the "Flow in words" panel (core's
 * `describeWorkflow`, the lead's own text) and the live graph's When arrows and Author block.
 */

const base = (): WorkflowGraphV3 => migrateWorkflowV2(WorkflowGraphSchema.parse(migratedGraph()));
const run = (graph: WorkflowGraphV3, ...actions: EditorAction[]): EditorState =>
  actions.reduce(editorReducer, initialEditorState(graph));

/** The base graph with a tester before your merge and the Author block. */
function withTesterAndAuthor(): WorkflowGraphV3 {
  return run(base(), { type: 'add', item: 'tester' }, { type: 'add-author' }).graph;
}
const testerId = (g: WorkflowGraphV3) => {
  const t = g.nodes.find((n) => failureSourceOf(g, n.id) === 'tester');
  if (t === undefined) throw new Error('no tester');
  return t.id;
};
const whenEdges = (g: WorkflowGraphV3) =>
  g.edges.filter((e): e is Extract<WorkflowEdgeV3, { type: 'when' }> => e.type === 'when');
const errorCodes = (g: WorkflowGraphV3) =>
  validateWorkflowGraphV3(g)
    .filter((i) => i.severity === 'error')
    .map((i) => i.code);

afterEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    // No storage in this environment.
  }
});

describe('the Author block', () => {
  it('is added once, selected, with no arrow; a second is not made and the menu says why', () => {
    const g = base();
    expect(authorAvailability(g)).toEqual({ ok: true });
    const s = run(g, { type: 'add-author' });
    const author = s.graph.nodes.find((n) => n.type === 'author');
    expect(author).toMatchObject({ type: 'author', id: 'author', label: AUTHOR_BLOCK_LABEL });
    expect(s.selection).toEqual({ kind: 'node', id: 'author' });
    expect(s.graph.edges.some((e) => e.from === 'author' || e.to === 'author')).toBe(false);
    expect(s.graph.template).toBe('custom');
    const again = editorReducer(s, { type: 'add-author' });
    expect(again).toBe(s);
    const full = authorAvailability(s.graph);
    expect(full.ok).toBe(false);
    if (!full.ok) expect(full.reason).toBe('The workflow already has its Author block.');
  });

  it('is in the "Add block" menu under Routing, explained, and disabled once there is one', () => {
    const actions: EditorAction[] = [];
    const first = render(<Palette graph={base()} dispatch={(a) => actions.push(a)} />);
    fireEvent.click(screen.getByTestId('add-block'));
    const item = screen.getByTestId('palette-author');
    expect(item.getAttribute('data-disabled')).toBeNull();
    expect(item.textContent).toContain('Whoever wrote the failing code');
    expect(screen.getByText('Routing')).toBeTruthy();
    fireEvent.click(item);
    expect(actions).toEqual([{ type: 'add-author' }]);
    first.unmount();
    render(
      <Palette graph={run(base(), { type: 'add-author' }).graph} dispatch={() => undefined} />,
    );
    fireEvent.click(screen.getByTestId('add-block'));
    const full = screen.getByTestId('palette-author');
    expect(full.getAttribute('data-disabled')).not.toBeNull();
    expect(full.textContent).toContain('The workflow already has its Author block.');
  });

  it('is drawn as a step and starts no link; removing it removes its When arrows', () => {
    const g = withTesterAndAuthor();
    const block = toFlowNodes(g, [], null, {
      skills: undefined,
      agents: undefined,
      agentModels: undefined,
      projectModel: null,
      projectMode: null,
      helperLimit: 4,
    }).find((n) => n.id === 'author');
    expect(block?.type).toBe('gate');
    expect(linkChoices(g, 'author')).toEqual([]);
    const linked = run(g, {
      type: 'connect',
      from: testerId(g),
      to: 'author',
      edgeType: 'when',
    }).graph;
    expect(whenEdges(linked)).toHaveLength(1);
    const removed = run(linked, { type: 'remove-node', id: 'author' }).graph;
    expect(removed.nodes.some((n) => n.type === 'author')).toBe(false);
    expect(whenEdges(removed)).toHaveLength(0);
  });
});

describe('When arrows are offered only from a failure source to a fixer', () => {
  it('from a tester, a Checks block, a change reviewer or the ticket merge to a helper, the Lead or the Author', () => {
    const g = withTesterAndAuthor();
    const tester = testerId(g);
    expect(allowedEdgeTypes(g, tester, 'author')).toEqual(['when']);
    expect(allowedEdgeTypes(g, tester, 'helpers')).toContain('when');
    expect(allowedEdgeTypes(g, tester, 'orchestrate')).toContain('when');
    expect(allowedEdgeTypes(g, 'checks', 'author')).toEqual(['when']);
    expect(allowedEdgeTypes(g, 'review', 'author')).toEqual(['when']);
    expect(allowedEdgeTypes(g, 'ticket-merge', 'orchestrate')).toEqual(['when']);
    // Not from blocks that raise no failure, and never to a block that is no fixer.
    expect(allowedEdgeTypes(g, 'helpers', 'author')).toEqual([]);
    expect(allowedEdgeTypes(g, 'orchestrate', 'author')).toEqual([]);
    expect(allowedEdgeTypes(g, tester, 'review')).not.toContain('when');
    expect(allowedEdgeTypes(g, 'checks', tester)).not.toContain('when');
  });

  it('a drop on the Author block makes the When arrow at once; on a helper it is a choice', () => {
    const g = withTesterAndAuthor();
    const tester = testerId(g);
    expect(linkOutcome(g, tester, 'author')).toEqual({
      kind: 'link',
      from: tester,
      to: 'author',
      type: 'when',
    });
    const choice = linkOutcome(g, tester, 'helpers');
    expect(choice.kind).toBe('choose');
    if (choice.kind === 'choose') expect(choice.option.types).toContain('when');
    const menu = linkChoices(g, tester).filter((c) => c.type === 'when');
    expect(menu.map((c) => c.to).sort()).toEqual(['author', 'helpers', 'orchestrate']);
  });

  it('the Finish block starts the ticket merge’s When arrows only, drawn from the Finish block', () => {
    const plain = run(base(), { type: 'add-author' }).graph;
    expect(resolveLink(plain, 'owner-merge', 'orchestrate')).toEqual({
      from: 'ticket-merge',
      to: 'orchestrate',
      types: ['when'],
    });
    expect(resolveLink(plain, 'owner-merge', 'review')).toBeNull();
    const linked = run(plain, {
      type: 'connect',
      from: 'ticket-merge',
      to: 'author',
      edgeType: 'when',
    }).graph;
    const when = whenEdges(linked)[0];
    expect(when).toMatchObject({ from: 'ticket-merge', to: 'author', on: ['merge-conflict'] });
    const drawn = toFlowEdges(linked, [], null).find((e) => e.id === when?.id);
    expect(drawn?.source).toBe('owner-merge');
  });
});

describe('moving a link end', () => {
  it('never turns another link into a When arrow; a When arrow keeps its events where it fits', () => {
    const g = withTesterAndAuthor();
    const tester = testerId(g);
    // The tester's flow into your merge, its end moved onto the Author block: only a When arrow
    // fits there, so the move is refused.
    const flow = g.edges.find((e) => e.from === tester && e.type === 'flow');
    if (flow === undefined) throw new Error('no flow');
    const moved = resolveReconnect(g, flow.id, 'target', 'author');
    expect(moved.kind).toBe('refused');
    expect(reconnectTargets(g, flow.id, 'target')?.get('author')).toBe('invalid');
    const linked = run(
      g,
      { type: 'connect', from: 'checks', to: 'author', edgeType: 'when' },
      { type: 'set-rounds', id: 'when-checks-author', maxRounds: 4 },
    ).graph;
    const r = resolveReconnect(linked, 'when-checks-author', 'target', 'helpers');
    expect(r).toEqual({ kind: 'ok', from: 'checks', to: 'helpers', types: ['when'] });
    const after = run(linked, {
      type: 'reconnect',
      id: 'when-checks-author',
      from: 'checks',
      to: 'helpers',
      edgeType: 'when',
    }).graph;
    expect(whenEdges(after)[0]).toMatchObject({
      to: 'helpers',
      on: ['checks-failed', 'harness-failed'],
      maxRounds: 4,
    });
  });
});

describe('a new When arrow, its events and rounds', () => {
  it('starts with the source’s events that no other When arrow routes, and 2 rounds', () => {
    const g = withTesterAndAuthor();
    const tester = testerId(g);
    const a = run(g, { type: 'connect', from: tester, to: 'author', edgeType: 'when' });
    expect(whenEdges(a.graph)[0]).toMatchObject({ on: ['tests-failed'], maxRounds: 2 });
    expect(a.selection).toEqual({ kind: 'edge', id: whenEdges(a.graph)[0]?.id });
    const checks = run(g, { type: 'connect', from: 'checks', to: 'author', edgeType: 'when' });
    expect(whenEdges(checks.graph)[0]?.on).toEqual(['checks-failed', 'harness-failed']);
    // One event left for a second arrow from the same block.
    const one = run(g, {
      type: 'connect',
      from: 'checks',
      to: 'author',
      edgeType: 'when',
    }).graph;
    const first = whenEdges(one)[0];
    if (first === undefined) throw new Error('no arrow');
    const narrowed = run(one, { type: 'set-when-events', id: first.id, on: ['checks-failed'] });
    expect(newWhenEvents(narrowed.graph, 'checks')).toEqual(['harness-failed']);
  });

  it('events: a set replaces them, deduplicated; an empty list is ignored', () => {
    const g = run(withTesterAndAuthor(), {
      type: 'connect',
      from: 'checks',
      to: 'author',
      edgeType: 'when',
    });
    const id = whenEdges(g.graph)[0]?.id ?? '';
    const one = editorReducer(g, {
      type: 'set-when-events',
      id,
      on: ['harness-failed', 'harness-failed'],
    });
    expect(whenEdges(one.graph)[0]?.on).toEqual(['harness-failed']);
    expect(editorReducer(one, { type: 'set-when-events', id, on: [] })).toBe(one);
  });

  it('rounds: 1 to 5 for a When arrow (a rework arrow keeps 0 to 5)', () => {
    const g = run(withTesterAndAuthor(), {
      type: 'connect',
      from: 'checks',
      to: 'author',
      edgeType: 'when',
    });
    const id = whenEdges(g.graph)[0]?.id ?? '';
    const rounds = (n: number) =>
      whenEdges(editorReducer(g, { type: 'set-rounds', id, maxRounds: n }).graph)[0]?.maxRounds;
    expect(rounds(4)).toBe(4);
    expect(rounds(0)).toBe(1);
    expect(rounds(9)).toBe(5);
  });

  it('is drawn red and dashed, labelled with its events and rounds', () => {
    const g = run(withTesterAndAuthor(), {
      type: 'connect',
      from: 'checks',
      to: 'author',
      edgeType: 'when',
    }).graph;
    const edge = toFlowEdges(g, [], null).find((e) => e.data?.type === 'when');
    expect(edge?.label).toBe(
      `${FAILURE_EVENT_NAMES['checks-failed']}, ${FAILURE_EVENT_NAMES['harness-failed']} ×2`,
    );
    expect(edge?.className).toBe('link-when');
    const id = whenEdges(g)[0]?.id ?? '';
    const labelled = run(g, { type: 'update-edge', id, patch: { label: 'Fix it' } }).graph;
    expect(toFlowEdges(labelled, [], null).find((e) => e.id === id)?.label).toBe(
      'Fix it · checks fail, the harness cannot run ×2',
    );
  });
});

describe('the When arrow’s panel', () => {
  function panelFor(graph: WorkflowGraphV3, edge: WorkflowEdgeV3, issues: EditorIssue[] = []) {
    const actions: EditorAction[] = [];
    const view = render(
      <EdgePanel
        edge={edge}
        graph={graph}
        issues={issues}
        dispatch={(a) => actions.push(a)}
        onClose={() => undefined}
      />,
    );
    return { actions, view };
  }

  it('offers only the events its source raises, with their names, and dispatches a change', () => {
    const g = run(withTesterAndAuthor(), {
      type: 'connect',
      from: 'checks',
      to: 'author',
      edgeType: 'when',
    }).graph;
    const edge = whenEdges(g)[0];
    if (edge === undefined) throw new Error('no arrow');
    const { actions } = panelFor(g, edge);
    const boxes = within(screen.getByTestId('when-events')).getAllByRole('checkbox');
    expect(boxes.map((b) => b.dataset.testid)).toEqual([
      'when-event-checks-failed',
      'when-event-harness-failed',
    ]);
    expect(screen.getByLabelText<HTMLInputElement>('Checks fail').checked).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>('The harness cannot run').checked).toBe(true);
    fireEvent.click(screen.getByLabelText('The harness cannot run'));
    expect(actions).toEqual([{ type: 'set-when-events', id: edge.id, on: ['checks-failed'] }]);
    expect(screen.queryByTestId('edge-purpose-to')).toBeNull();
  });

  it('keeps the last event ticked, flags an event its source never raises', () => {
    const g = run(withTesterAndAuthor(), {
      type: 'connect',
      from: testerId(withTesterAndAuthor()),
      to: 'author',
      edgeType: 'when',
    }).graph;
    const edge = whenEdges(g)[0];
    if (edge === undefined) throw new Error('no arrow');
    const first = panelFor(g, edge);
    const boxes = within(screen.getByTestId('when-events')).getAllByRole('checkbox');
    expect(boxes).toHaveLength(1);
    expect(screen.getByTestId<HTMLInputElement>('when-event-tests-failed').disabled).toBe(true);
    first.view.unmount();
    const foreign = { ...edge, on: ['tests-failed', 'merge-conflict'] } as WorkflowEdgeV3;
    const { actions } = panelFor(g, foreign);
    expect(screen.getByTestId('when-foreign-merge-conflict').textContent).toContain(
      'This block never raises it',
    );
    fireEvent.click(screen.getByTestId('when-event-merge-conflict'));
    expect(actions).toEqual([{ type: 'set-when-events', id: edge.id, on: ['tests-failed'] }]);
  });

  it('rounds 1 to 5, and says who receives the failure: the fixer, and the lead is told', () => {
    const g = withTesterAndAuthor();
    const tester = testerId(g);
    const linked = run(
      g,
      { type: 'connect', from: tester, to: 'author', edgeType: 'when' },
      { type: 'connect', from: 'checks', to: 'helpers', edgeType: 'when' },
      { type: 'connect', from: 'review', to: 'orchestrate', edgeType: 'when' },
    ).graph;
    const [toAuthor, toHelper, toLead] = whenEdges(linked);
    if (toAuthor === undefined || toHelper === undefined || toLead === undefined) {
      throw new Error('arrows missing');
    }
    const a = panelFor(linked, toAuthor);
    const radios = within(screen.getByRole('group', { name: 'Fix rounds' })).getAllByRole('radio');
    expect(radios.map((r) => r.closest('label')?.textContent)).toEqual(['1', '2', '3', '4', '5']);
    fireEvent.click(radios[3] as HTMLElement);
    expect(a.actions).toEqual([{ type: 'set-rounds', id: toAuthor.id, maxRounds: 4 }]);
    const receives = screen.getByTestId('when-receives');
    expect(receives.dataset.receiver).toBe('author');
    expect(receives.textContent).toContain('The helper whose change touched the failing files');
    expect(receives.textContent).toContain('The lead is told and can step in.');
    expect(receives.textContent).toContain('When the rounds run out, the lead decides.');
    a.view.unmount();
    const h = panelFor(linked, toHelper);
    expect(screen.getByTestId('when-receives').textContent).toContain(
      'Helpers gets a fix turn with the failure’s context',
    );
    h.view.unmount();
    panelFor(linked, toLead);
    expect(screen.getByTestId('when-receives').textContent).toContain(
      'The lead gets the failure with its context and decides who fixes it.',
    );
  });

  it('shows the three new problems core finds with a When arrow', () => {
    const g = withTesterAndAuthor();
    const tester = testerId(g);
    const twice = run(
      g,
      { type: 'connect', from: tester, to: 'author', edgeType: 'when' },
      { type: 'connect', from: tester, to: 'helpers', edgeType: 'when' },
    ).graph;
    expect(errorCodes(twice)).toContain('when-duplicate-route');
    const wrongEvent: WorkflowGraphV3 = {
      ...twice,
      edges: twice.edges
        .filter((e) => !(e.type === 'when' && e.to === 'helpers'))
        .map((e) => (e.type === 'when' ? { ...e, on: ['merge-conflict'] } : e)),
    };
    expect(errorCodes(wrongEvent)).toContain('when-event-invalid');
    // A When arrow to a block that is no fixer (stored by hand: the editor never draws one).
    const wrongTarget: WorkflowGraphV3 = {
      ...g,
      edges: [
        ...g.edges,
        {
          type: 'when',
          id: 'when-bad',
          from: tester,
          to: 'review',
          on: ['tests-failed'],
          maxRounds: 2,
        },
      ],
    };
    expect(errorCodes(wrongTarget)).toContain('when-target-invalid');
    for (const [graph, code] of [
      [twice, 'when-duplicate-route'],
      [wrongEvent, 'when-event-invalid'],
      [wrongTarget, 'when-target-invalid'],
    ] as const) {
      const issue = validateWorkflowGraphV3(graph).find((i) => i.code === code);
      const edge = graph.edges.find((e) => e.id === issue?.edgeId);
      if (issue === undefined || edge === undefined) throw new Error(`no ${code} on an arrow`);
      const { view } = panelFor(graph, edge, [issue]);
      expect(screen.getByText(issue.message)).toBeTruthy();
      view.unmount();
    }
    // A refused target is drawn in the danger tone.
    const drawn = toFlowEdges(wrongTarget, validateWorkflowGraphV3(wrongTarget), null).find(
      (e) => e.id === 'when-bad',
    );
    expect(drawn?.data?.refused).toBe(true);
  });
});

describe('Flow in words', () => {
  function graphWithRoutes(): WorkflowGraphV3 {
    const g = withTesterAndAuthor();
    return run(g, { type: 'connect', from: testerId(g), to: 'author', edgeType: 'when' }).graph;
  }

  it('lists exactly core’s describeWorkflow sentences, grouped by section', () => {
    const g = graphWithRoutes();
    render(<FlowWords graph={g} selection={null} onSelect={() => undefined} />);
    const sentences = describeWorkflow(g);
    const shown = screen.getAllByTestId('flow-words-text').map((t) => t.textContent);
    expect(shown).toEqual(sentences.map((s) => s.text));
    for (const section of ['agents', 'links', 'failures'] as const) {
      const list = screen.getByTestId(`flow-words-${section}`);
      expect(
        within(list)
          .getAllByTestId('flow-words-text')
          .map((t) => t.textContent),
      ).toEqual(sentences.filter((s) => s.section === section).map((s) => s.text));
    }
    // The owner's words stand apart, with their quotes.
    expect(document.querySelector('[data-quoted="true"]')?.textContent).toBe('"Lead"');
  });

  it('marks failures nobody routes as "Lead decides (default)"', () => {
    const g = graphWithRoutes();
    render(<FlowWords graph={g} selection={null} onSelect={() => undefined} />);
    const defaults = describeWorkflow(g).filter((s) => s.routing === 'default');
    expect(defaults.length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('flow-words-default')).toHaveLength(defaults.length);
    const rows = screen.getAllByTestId('flow-words-sentence');
    const routed = rows.find((r) => r.dataset.routing === 'when');
    expect(routed).toBeDefined();
    expect(within(routed as HTMLElement).queryByTestId('flow-words-default')).toBeNull();
  });

  it('selecting a sentence selects its arrow, else its block (the Finish block for its steps)', () => {
    const g = graphWithRoutes();
    const picked: Selection[] = [];
    render(<FlowWords graph={g} selection={null} onSelect={(s) => picked.push(s)} />);
    const sentences = describeWorkflow(g);
    const texts = screen.getAllByTestId('flow-words-sentence');
    const at = (pred: (s: (typeof sentences)[number]) => boolean) => {
      const i = sentences.findIndex(pred);
      const row = texts[i];
      if (row === undefined) throw new Error('no row');
      fireEvent.click(within(row).getByTestId('flow-words-select'));
    };
    at((s) => s.section === 'agents' && s.nodeId === 'orchestrate');
    at((s) => s.routing === 'when');
    at((s) => s.section === 'failures' && s.nodeId === 'ticket-merge');
    const when = whenEdges(g)[0];
    expect(picked).toEqual([
      { kind: 'node', id: 'orchestrate' },
      { kind: 'edge', id: when?.id },
      // The ticket merge is drawn as the Finish block.
      { kind: 'node', id: 'owner-merge' },
    ]);
  });

  it('collapses, and remembers it in this browser', () => {
    const g = graphWithRoutes();
    const first = render(<FlowWords graph={g} selection={null} onSelect={() => undefined} />);
    expect(screen.getByTestId('flow-words-body')).toBeTruthy();
    fireEvent.click(screen.getByTestId('flow-words-toggle'));
    expect(screen.queryByTestId('flow-words-body')).toBeNull();
    expect(screen.getByTestId('flow-words-toggle').getAttribute('aria-expanded')).toBe('false');
    first.unmount();
    render(<FlowWords graph={g} selection={null} onSelect={() => undefined} />);
    expect(screen.queryByTestId('flow-words-body')).toBeNull();
    fireEvent.click(screen.getByTestId('flow-words-toggle'));
    expect(screen.getByTestId('flow-words-body')).toBeTruthy();
  });
});

describe('the live run graph', () => {
  it('draws the Author block as a step and a When arrow with its events and rounds', () => {
    const raw = RunWorkflowGraphDtoSchema.parse(directLoopRunGraph());
    const graph = raw.graph;
    const withRoute: typeof graph = {
      ...graph,
      nodes: [...graph.nodes, { type: 'author', id: 'author', label: 'Author' }],
      edges: [
        ...graph.edges,
        {
          type: 'when',
          id: 'when-checks-author',
          from: 'checks',
          to: 'author',
          on: ['checks-failed'],
          maxRounds: 3,
        },
      ],
    };
    const runDto = RunDetailDtoSchema.parse(directLoopScenario().routes[LOOP_RUN_PATH]);
    const live = buildLiveGraph({ ...raw, graph: withRoute }, runDto);
    expect(live.nodes.find((n) => n.id === 'author')?.type).toBe('gate');
    const link = live.edges.find((e) => e.id === 'when-checks-author');
    expect(link?.label).toBe('checks fail ×3');
    expect(link?.className).toBe('live-link-when');
    expect(link?.style?.stroke).toBe('var(--color-danger)');
  });
});
