import {
  WorkflowGraphSchema,
  defaultProjectWorkflow,
  isGraphRunnable,
  migrateWorkflowV1,
  validateWorkflowGraph,
  workflowTemplate,
  type WorkflowGraph,
} from '@acp/core';
import { WorkflowGraphDtoSchema } from '@acp/core/api';
import { describe, expect, it } from 'vitest';
import { customGraph, customGraphDto, graphDto, migratedGraph } from '../../e2e/workflow-fixtures';
import {
  linkTargets,
  toFlowEdges,
  toFlowNodes,
  type BlockContext,
} from '../../src/features/workflow/editor/flow';
import { countConflicts, drawnLinks } from '../../src/features/workflow/editor/routing';
import { editorIssues, shapeIssues } from '../../src/features/workflow/editor/issues';
import { layoutGraph, sizeOf } from '../../src/features/workflow/editor/layout';
import {
  allowedEdgeTypes,
  edgeIdFor,
  editorReducer,
  initialEditorState,
  paletteAvailability,
  refusalFor,
  sameGraph,
  type EditorAction,
  type EditorState,
} from '../../src/features/workflow/editor/state';
import { restoredGraph, templateGraph } from '../../src/features/workflow/editor/templates';
import {
  choiceGraph,
  isDefaultChoice,
} from '../../src/features/project-setup/WorkflowTemplateChoice';

/*
 * WG-D: the graph editor's pure parts. The reducer (add, remove, connect, refused links,
 * positions, the forced planner and final-chain wiring), the layout, the React Flow mapping and the
 * fixtures the page and e2e tests share. Every link rule is core's `canConnect`, so these tests
 * check the editor uses it, not the rules themselves (WG-A's tests do).
 */

const parse = (g: unknown): WorkflowGraph => WorkflowGraphSchema.parse(g);
const todays = () => workflowTemplate('todays-setup');
const run = (graph: WorkflowGraph, ...actions: EditorAction[]): EditorState =>
  actions.reduce(editorReducer, initialEditorState(graph));
const errors = (g: WorkflowGraph) => validateWorkflowGraph(g).filter((i) => i.severity === 'error');
const has = (g: WorkflowGraph, type: string, from: string, to: string) =>
  g.edges.some((e) => e.type === type && e.from === from && e.to === to);

describe('fixtures', () => {
  it('parse as WorkflowGraphDto, and the migrated graph is core’s migration of the default', () => {
    for (const dto of [graphDto(), customGraphDto()]) {
      expect(WorkflowGraphDtoSchema.safeParse(dto).success).toBe(true);
    }
    const v1 = defaultProjectWorkflow('p-web', '2026-10-16T09:01:00.000Z');
    const migrated = migrateWorkflowV1(
      { plannerMode: v1.plannerMode, stages: v1.stages },
      { projectMode: 'auto-edits' },
    );
    expect(sameGraph(parse(migratedGraph()), migrated)).toBe(true);
  });

  it('the hand-built graph is valid, with warnings only for its missing skill and agent file', () => {
    const g = parse(customGraph());
    const issues = validateWorkflowGraph(g, {
      skills: ['code-review', 'plan-tickets', 'unit-tests'],
      agents: ['db-migrator', 'docs-writer'],
      maxConcurrentHelpers: 3,
      projectMode: 'auto-edits',
    });
    expect(isGraphRunnable(issues)).toBe(true);
    expect(issues.map((i) => i.code).sort()).toEqual(['missing-agent-file', 'missing-skill']);
  });
});

describe('editor reducer: adding blocks', () => {
  it('adds a named helper with a free id and label, selects it, and marks the graph custom', () => {
    const s = run(todays(), { type: 'add', item: 'helper' }, { type: 'add', item: 'helper' });
    const helpers = s.graph.nodes.filter((n) => n.type === 'helper');
    expect(helpers.map((n) => [n.id, n.label])).toEqual([
      ['helper-1', 'Helper 1'],
      ['helper-2', 'Helper 2'],
    ]);
    expect(s.selection).toEqual({ kind: 'node', id: 'helper-2' });
    expect(s.graph.template).toBe('custom');
    // A new named helper is not linked yet: the problems say so.
    const codes = errors(s.graph).map((i) => `${i.code}:${i.nodeId ?? ''}`);
    expect(codes).toContain('not-assigned:helper-1');
    expect(codes).toContain('no-review-route:helper-1');
  });

  it('adding the planner rewires the plan path; removing it puts the lead’s path back', () => {
    const added = run(todays(), { type: 'add', item: 'planner' });
    const g = added.graph;
    expect(has(g, 'flow', 'ticket', 'plan')).toBe(true);
    expect(has(g, 'flow', 'plan', 'plan-approval')).toBe(true);
    expect(has(g, 'flow', 'plan-approval', 'orchestrate')).toBe(true);
    expect(has(g, 'flow', 'ticket', 'orchestrate')).toBe(false);
    expect(errors(g)).toEqual([]);
    const removed = editorReducer(added, { type: 'remove-node', id: 'plan' });
    expect(has(removed.graph, 'flow', 'ticket', 'orchestrate')).toBe(true);
    expect(has(removed.graph, 'flow', 'orchestrate', 'plan-approval')).toBe(true);
    expect(errors(removed.graph)).toEqual([]);
  });

  it('a final reviewer or tester goes just before your merge; removing one joins the chain', () => {
    const s = run(
      todays(),
      { type: 'add', item: 'final-reviewer' },
      { type: 'add', item: 'tester' },
    );
    const g = s.graph;
    expect(has(g, 'flow', 'ticket-merge', 'code-review')).toBe(true);
    expect(has(g, 'flow', 'code-review', 'unit-tests')).toBe(true);
    expect(has(g, 'flow', 'unit-tests', 'owner-merge')).toBe(true);
    expect(has(g, 'flow', 'ticket-merge', 'owner-merge')).toBe(false);
    // The final reviewer is complete; the tester still needs its review route.
    expect(errors(g).map((i) => `${i.code}:${i.nodeId ?? ''}`)).toEqual([
      'no-review-route:unit-tests',
    ]);
    const without = editorReducer(s, { type: 'remove-node', id: 'code-review' });
    expect(has(without.graph, 'flow', 'ticket-merge', 'unit-tests')).toBe(true);
  });

  it('respects NODE_CAPABILITIES: one planner and one pool; the palette says why', () => {
    const g = parse(customGraph());
    for (const item of ['planner', 'helper-pool'] as const) {
      const a = paletteAvailability(g, item);
      expect(a.ok).toBe(false);
      if (!a.ok) expect(a.reason).toMatch(/can have only one/);
      expect(run(g, { type: 'add', item }).graph).toBe(g);
    }
    expect(paletteAvailability(g, 'helper').ok).toBe(true);
    let s = initialEditorState(g);
    for (let i = 0; i < 10; i += 1) s = editorReducer(s, { type: 'add', item: 'tester' });
    expect(s.graph.nodes.filter((n) => n.type === 'tester')).toHaveLength(2);
    const t = paletteAvailability(s.graph, 'tester');
    expect(!t.ok && t.reason).toMatch(/2 of this block/);
  });
});

describe('editor reducer: removing, connecting, moving', () => {
  it('never removes the lead or a step, and drops a removed block’s links', () => {
    const g = todays();
    // Every Checks block can be removed since ADR-0028 (tested with the Checks blocks).
    for (const id of ['orchestrate', 'ticket', 'plan-approval', 'owner-merge', 'done']) {
      expect(run(g, { type: 'remove-node', id }).graph).toBe(g);
    }
    const s = run(g, { type: 'remove-node', id: 'review' });
    expect(s.graph.edges.some((e) => e.from === 'review' || e.to === 'review')).toBe(false);
    expect(errors(s.graph).map((i) => i.code)).toContain('no-review-route');
  });

  it('connects only what canConnect allows, and refuses the rest in its words', () => {
    const s = run(todays(), { type: 'add', item: 'helper' });
    const ok = editorReducer(s, {
      type: 'connect',
      from: 'orchestrate',
      to: 'helper-1',
      edgeType: 'assigns',
    });
    expect(has(ok.graph, 'assigns', 'orchestrate', 'helper-1')).toBe(true);
    expect(ok.selection).toEqual({ kind: 'edge', id: 'assigns-orchestrate-helper-1' });
    expect(ok.refusal).toBeNull();
    // A helper can't merge: refused, the graph unchanged, the message is canConnect's.
    const refused = editorReducer(ok, {
      type: 'connect',
      from: 'helper-1',
      to: 'checks',
      edgeType: 'merge',
    });
    expect(refused.graph).toBe(ok.graph);
    expect(refused.refusal).toMatch(/Only the Lead merges, through the Checks block/);
    // A duplicate is refused too.
    const dup = editorReducer(ok, {
      type: 'connect',
      from: 'orchestrate',
      to: 'helper-1',
      edgeType: 'assigns',
    });
    expect(dup.refusal).toMatch(/already has a assigns link/);
    expect(editorReducer(dup, { type: 'dismiss-refusal' }).refusal).toBeNull();
  });

  it('lists the link kinds that fit two blocks, and explains why none does', () => {
    const g = todays();
    expect(allowedEdgeTypes(g, 'orchestrate', 'helpers')).toEqual([]); // both already there
    const s = run(g, { type: 'add', item: 'helper' });
    expect(allowedEdgeTypes(s.graph, 'orchestrate', 'helper-1')).toEqual(['assigns', 'rework']);
    expect(allowedEdgeTypes(s.graph, 'helper-1', 'orchestrate')).toEqual(['review']);
    expect(allowedEdgeTypes(s.graph, 'helper-1', 'checks')).toEqual([]);
    expect(refusalFor(s.graph, 'helper-1', 'checks')).toMatch(
      /cannot send its change for review to "Checks"/,
    );
    expect(refusalFor(g, 'orchestrate', 'helpers')).toMatch(/already has/);
  });

  it('a new rework link starts at 2 rounds; set-rounds stays within 0–5', () => {
    const s = run(
      todays(),
      { type: 'add', item: 'helper' },
      { type: 'connect', from: 'review', to: 'helper-1', edgeType: 'rework' },
    );
    const id = 'rework-review-helper-1';
    const rounds = (st: EditorState) => {
      const e = st.graph.edges.find((x) => x.id === id);
      return e?.type === 'rework' ? e.maxRounds : null;
    };
    expect(rounds(s)).toBe(2);
    expect(rounds(editorReducer(s, { type: 'set-rounds', id, maxRounds: 9 }))).toBe(5);
    expect(rounds(editorReducer(s, { type: 'set-rounds', id, maxRounds: -1 }))).toBe(0);
  });

  it('moving a block saves its position and keeps the template', () => {
    const s = run(todays(), { type: 'move-node', id: 'helpers', position: { x: 10.4, y: -3.6 } });
    expect(s.graph.nodes.find((n) => n.id === 'helpers')?.position).toEqual({ x: 10, y: -4 });
    expect(s.graph.template).toBe('todays-setup');
    expect(sameGraph(s.graph, todays())).toBe(false);
  });

  it('edits only the fields a block’s kind has (no mode on read-only blocks)', () => {
    const s = run(
      todays(),
      {
        type: 'update-node',
        id: 'orchestrate',
        patch: { approvalMode: 'full-auto', label: 'Boss' },
      },
      { type: 'update-node', id: 'helpers', patch: { approvalMode: 'manual', skills: ['a'] } },
      { type: 'update-node', id: 'plan-approval', patch: { auto: true, label: 'x' } },
    );
    const lead = s.graph.nodes.find((n) => n.id === 'orchestrate');
    expect(lead).toMatchObject({ label: 'Boss' });
    expect(lead && 'approvalMode' in lead).toBe(false);
    expect(s.graph.nodes.find((n) => n.id === 'helpers')).toMatchObject({
      approvalMode: 'manual',
      skills: ['a'],
    });
    expect(s.graph.nodes.find((n) => n.id === 'plan-approval')).toMatchObject({
      auto: true,
      label: 'Plan approval',
    });
  });

  it('selection: React Flow’s deselect clears only what is still selected', () => {
    const s = run(todays(), { type: 'select', selection: { kind: 'edge', id: 'x' } });
    expect(editorReducer(s, { type: 'deselect', id: 'helpers' }).selection).toEqual({
      kind: 'edge',
      id: 'x',
    });
    expect(editorReducer(s, { type: 'deselect', id: 'x' }).selection).toBeNull();
  });

  it('link ids are unique and fit the id pattern even for long block ids', () => {
    const long = 'a'.repeat(30);
    const g = {
      ...todays(),
      edges: [
        { type: 'flow' as const, id: `flow-${long}-${long}`.slice(0, 40), from: 'x', to: 'y' },
      ],
    };
    const id = edgeIdFor(g, 'flow', long, long);
    expect(id).toMatch(/^[a-z][a-z0-9-]{0,39}$/);
    expect(id).not.toBe(g.edges[0]?.id);
  });
});

describe('issues, layout and the canvas mapping', () => {
  it('names an empty or too long block name before the validator’s issues', () => {
    const s = run(todays(), { type: 'update-node', id: 'helpers', patch: { label: '  ' } });
    const shape = shapeIssues(s.graph);
    expect(shape).toHaveLength(1);
    expect(shape[0]).toMatchObject({ severity: 'error', nodeId: 'helpers', code: 'shape' });
    expect(editorIssues(s.graph, {})[0]?.code).toBe('shape');
  });

  it('keeps saved positions and lays out the rest left to right without overlaps', () => {
    const g = parse(customGraph());
    const moved = {
      ...g,
      nodes: g.nodes.map((n) => (n.id === 'plan' ? { ...n, position: { x: 5, y: 6 } } : n)),
    };
    const pos = layoutGraph(moved);
    expect(pos.get('plan')).toEqual({ x: 5, y: 6 });
    // Three rows: the plan path, then the lead and its helpers, then the merge and final steps.
    const at = (id: string) => pos.get(id) ?? { x: NaN, y: NaN };
    expect(at('ticket').y).toBeLessThan(at('orchestrate').y);
    expect(at('orchestrate').x).toBeLessThan(at('helper-1').x);
    expect(at('helper-1').x).toBeLessThan(at('review').x);
    expect(at('helper-1').y).toBeLessThan(at('helpers').y);
    expect(at('helpers').y).toBeLessThan(at('checks').y);
    expect(at('checks').x).toBeLessThan(at('unit-tests').x);
    expect(at('unit-tests').x).toBeLessThan(at('owner-merge').x);
    // The Finish block (your merge) stands for the ticket merge and Done: they share its place.
    expect(at('ticket-merge')).toEqual(at('owner-merge'));
    expect(at('done')).toEqual(at('owner-merge'));
    // Same layout every time.
    expect([...layoutGraph(moved)]).toEqual([...pos]);
    const boxes = moved.nodes
      .filter((n) => n.id !== 'plan' && n.id !== 'done' && n.id !== 'ticket-merge')
      .map((n) => ({ ...(pos.get(n.id) ?? { x: 0, y: 0 }), ...sizeOf(n) }));
    for (const a of boxes) {
      for (const b of boxes) {
        if (a === b) continue;
        const apart =
          a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y;
        expect(apart).toBe(true);
      }
    }
  });

  it('maps blocks and links for React Flow: kinds, removability, back links, labels', () => {
    const g = parse(customGraph());
    const ctx: BlockContext = {
      skills: ['plan-tickets'],
      agents: ['db-migrator'],
      agentModels: new Map([['db-migrator', 'claude-haiku-4']]),
      projectModel: null,
      projectMode: 'auto-edits',
      helperLimit: 3,
    };
    const issues = editorIssues(g, { skills: ['plan-tickets'], agents: ['db-migrator'] });
    const nodes = toFlowNodes(g, issues, { kind: 'node', id: 'helper-1' }, ctx);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(byId.get('orchestrate')).toMatchObject({ type: 'agent', deletable: false });
    expect(byId.get('checks')).toMatchObject({ type: 'gate', deletable: true });
    // The end steps are one Finish block (ADR-0028 §3): your merge, fixed; the others not drawn.
    expect(byId.get('owner-merge')).toMatchObject({ type: 'finish', deletable: false });
    expect(byId.has('ticket-merge')).toBe(false);
    expect(byId.has('done')).toBe(false);
    expect(byId.get('helper-1')).toMatchObject({ selected: true, deletable: true });
    expect(byId.get('helper-1')?.data).toMatchObject({
      missingSkills: ['release-notes'],
      agentMissing: true,
      warnings: 2,
    });
    expect(byId.get('helpers')?.data.model).toEqual({
      text: 'claude-haiku-4 (agent file)',
      own: true,
    });
    const edges = toFlowEdges(g, issues, null);
    const rework = edges.find((e) => e.id === 'rework-review-helpers');
    // Rework loops underneath, leaving and entering on the sides that face each other.
    expect(rework).toMatchObject({ sourceHandle: 's-bottom-15', targetHandle: 't-bottom-85' });
    expect(rework?.data?.route.kind).toBe('loop-bottom');
    // Forward links: side to side to the right, bottom to top into the next row.
    expect(edges.find((e) => e.id === 'assigns-orchestrate-helper-1')).toMatchObject({
      sourceHandle: 'out',
      targetHandle: 'in',
    });
    expect(edges.find((e) => e.id === 'merge-orchestrate-checks')).toMatchObject({
      sourceHandle: 's-bottom-50',
      targetHandle: 't-top-50',
    });
    expect(rework?.label).toBe('Rework ×2');
    // Findings loop over the top into the lead, clear of its plan link at 50%.
    expect(edges.find((e) => e.id === 'findings-review-orchestrate')).toMatchObject({
      sourceHandle: 's-top-50',
      targetHandle: 't-top-85',
    });
    // The tester's review goes up to the lead in the gap between the rows, not across the
    // helpers stacked in the middle row.
    const up = edges.find((e) => e.id === 'review-unit-tests-orchestrate');
    expect(up).toMatchObject({ sourceHandle: 's-top-30', targetHandle: 't-bottom-70' });
    expect(up?.data?.route.kind).toBe('corridor');
    expect(edges.find((e) => e.id === 'merge-orchestrate-checks')?.ariaLabel).toBe(
      'Merges through: from Lead to Checks',
    );
  });
});

describe('linking and drawing (v0.3.0 D-C)', () => {
  const ctx: BlockContext = {
    skills: undefined,
    agents: undefined,
    agentModels: undefined,
    projectModel: null,
    projectMode: 'auto-edits',
    helperLimit: 3,
  };

  it('while a link is dragged, the blocks canConnect allows are valid targets, the rest not', () => {
    const g = run(todays(), { type: 'add', item: 'helper' }).graph;
    const targets = linkTargets(g, 'orchestrate');
    expect(targets?.get('orchestrate')).toBe('source');
    // A new helper can be assigned or reworked by the lead.
    expect(targets?.get('helper-1')).toBe('valid');
    // Already linked (merge, assigns and rework to the pool) or never allowed: invalid.
    for (const id of ['checks', 'helpers', 'ticket', 'review']) {
      expect(targets?.get(id)).toBe('invalid');
    }
    // The steps the Finish block stands for are not targets of their own.
    expect(targets?.has('done')).toBe(false);
    expect(targets?.has('ticket-merge')).toBe(false);
    // Every valid target is one allowedEdgeTypes accepts (the Finish block: its ticket merge or
    // your merge), and nothing else.
    for (const n of g.nodes) {
      if (n.id === 'orchestrate' || n.id === 'done' || n.id === 'ticket-merge') continue;
      const ends = n.id === 'owner-merge' ? ['ticket-merge', 'owner-merge'] : [n.id];
      expect(targets?.get(n.id) === 'valid').toBe(
        ends.some((to) => allowedEdgeTypes(g, 'orchestrate', to).length > 0),
      );
    }
    expect(linkTargets(g, null)).toBeNull();
    const nodes = toFlowNodes(g, [], null, ctx, undefined, 'orchestrate');
    expect(nodes.find((n) => n.id === 'helper-1')?.data.linkTarget).toBe('valid');
    expect(nodes.find((n) => n.id === 'ticket')?.data.linkTarget).toBe('invalid');
    expect(toFlowNodes(g, [], null, ctx).every((n) => n.data.linkTarget === null)).toBe(true);
  });

  it('fades the links that don’t touch the selection, and all of them while dragging', () => {
    const g = todays();
    const selected = toFlowEdges(g, [], { kind: 'node', id: 'review' });
    for (const e of selected) {
      expect(e.data?.dim).toBe(e.source !== 'review' && e.target !== 'review');
    }
    const one = toFlowEdges(g, [], { kind: 'edge', id: 'merge-orchestrate-checks' });
    expect(one.filter((e) => e.data?.dim === false).map((e) => e.id)).toEqual([
      'merge-orchestrate-checks',
    ]);
    expect(toFlowEdges(g, [], null, undefined, true).every((e) => e.data?.dim)).toBe(true);
    expect(toFlowEdges(g, [], null).some((e) => e.data?.dim)).toBe(false);
  });

  it('draws every template without links crossing, the dense hand-built graph with one', () => {
    const templates = [
      workflowTemplate('lead-only'),
      todays(),
      workflowTemplate('reviewer-helper-loop'),
      workflowTemplate('todays-setup', { planner: true }),
    ];
    for (const g of templates) expect(countConflicts(drawnLinks(g, layoutGraph(g)))).toBe(0);
    // Two helpers stacked, the lead assigning both and reworking the first: its rework loop has to
    // cross the line to the second (there is no way round in rows).
    const custom = parse(customGraph());
    expect(countConflicts(drawnLinks(custom, layoutGraph(custom)))).toBeLessThanOrEqual(1);
  });
});

describe('templates and restore', () => {
  it('a template’s plan step asks, except in a Full auto project; the earlier setup is kept', () => {
    const legacy = parse(migratedGraph()).legacyV1;
    const g = templateGraph('lead-only', {
      planner: true,
      projectMode: 'full-auto',
      legacyV1: legacy,
    });
    expect(g.nodes.find((n) => n.type === 'plan-approval')).toMatchObject({ auto: true });
    expect(g.nodes.some((n) => n.type === 'planner')).toBe(true);
    expect(g.legacyV1).toEqual(legacy);
    expect(errors(g)).toEqual([]);
    const ask = templateGraph('reviewer-helper-loop', { planner: false, projectMode: 'auto' });
    expect(ask.nodes.find((n) => n.type === 'plan-approval')).toMatchObject({ auto: false });
    expect(validateWorkflowGraph(ask, { projectMode: 'auto' })).toEqual([]);
  });

  it('restores the version 1 setup with core’s migration', () => {
    const legacy = parse(migratedGraph()).legacyV1;
    if (legacy === undefined) throw new Error('fixture has no legacyV1');
    expect(sameGraph(restoredGraph(legacy, 'auto-edits'), parse(migratedGraph()))).toBe(true);
  });

  it('the wizard saves nothing for the default, and a custom graph for "Build my own"', () => {
    expect(isDefaultChoice({ template: 'todays-setup', planner: false })).toBe(true);
    expect(isDefaultChoice({ template: 'todays-setup', planner: true })).toBe(false);
    const own = choiceGraph({ template: 'custom', planner: false }, 'auto-edits');
    expect(own.template).toBe('custom');
    expect(sameGraph({ ...own, template: 'todays-setup' }, todays())).toBe(true);
  });
});
