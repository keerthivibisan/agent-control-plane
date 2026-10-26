import {
  WorkflowGraphSchema,
  isGraphRunnable,
  validateWorkflowGraph,
  workflowTemplate,
  type CheckSelection,
  type HarnessCheck,
  type WorkflowGraph,
  type WorkflowNode,
} from '@acp/core';
import { describe, expect, it } from 'vitest';
import { customGraph } from '../../e2e/workflow-fixtures';
import {
  blocksRunningCheck,
  checkFailureOf,
  harnessForValidation,
  harnessLabels,
  missingSelection,
  selectedChecks,
  type ChecksNode,
} from '../../src/features/workflow/check-blocks';
import { layoutGraph, rowOf } from '../../src/features/workflow/editor/layout';
import { kindWord, selectionChip } from '../../src/features/workflow/editor/nodes';
import { editorIssues, shapeIssues } from '../../src/features/workflow/editor/issues';
import {
  checksAvailability,
  editorReducer,
  initialEditorState,
  isRemovable,
  type EditorAction,
  type EditorState,
} from '../../src/features/workflow/editor/state';

/*
 * H-D (ADR-0027 §5): the editor's Checks blocks, pure, against core's real rules (H-A): a helper
 * or tester flows into a change block, a change block reworks the blocks it checks, branch blocks
 * sit on the final chain. The editor only ever links through `canConnect`, so a graph built here
 * is checked with `validateWorkflowGraph`, the same check the server runs on a save.
 */

const parse = (g: unknown): WorkflowGraph => WorkflowGraphSchema.parse(g);
const run = (graph: WorkflowGraph, ...actions: EditorAction[]): EditorState =>
  actions.reduce(editorReducer, initialEditorState(graph));
const has = (g: WorkflowGraph, type: string, from: string, to: string) =>
  g.edges.some((e) => e.type === type && e.from === from && e.to === to);
const blockOf = (g: WorkflowGraph, id: string) =>
  g.nodes.find((n) => n.id === id) as ChecksNode | undefined;

const CHECKS: HarnessCheck[] = [
  {
    id: 'lint',
    name: 'Lint',
    argv: ['pnpm', 'lint'],
    timeoutSec: 300,
    required: true,
    labels: ['fast'],
  },
  {
    id: 'unit',
    name: 'Unit tests',
    argv: ['pnpm', 'test'],
    timeoutSec: 600,
    required: true,
    labels: ['fast', 'full'],
  },
  {
    id: 'e2e',
    name: 'End-to-end',
    argv: ['pnpm', 'e2e'],
    timeoutSec: 1800,
    required: false,
    labels: ['full'],
  },
];

describe('check blocks: selection', () => {
  it('runs the required checks, a list, or labels; lists the labels; finds missing picks', () => {
    const ids = (s: CheckSelection) => selectedChecks(s, CHECKS).map((c) => c.id);
    expect(ids({ kind: 'required' })).toEqual(['lint', 'unit']);
    expect(ids({ kind: 'ids', ids: ['e2e', 'gone'] })).toEqual(['e2e']);
    expect(ids({ kind: 'labels', labels: ['full'] })).toEqual(['unit', 'e2e']);
    expect(harnessLabels(CHECKS)).toEqual(['fast', 'full']);
    expect(missingSelection({ kind: 'ids', ids: ['lint', 'gone'] }, CHECKS)).toEqual({
      ids: ['gone'],
      labels: [],
    });
    expect(missingSelection({ kind: 'labels', labels: ['slow'] }, CHECKS).labels).toEqual(['slow']);
  });

  it('warns (core’s check) for picks the harness file does not have, not while unknown', () => {
    const g = parse(customGraph());
    const picked: WorkflowGraph = {
      ...g,
      nodes: g.nodes.map((n) =>
        n.type === 'checks' ? { ...n, select: { kind: 'ids', ids: ['lint', 'gone'] } } : n,
      ),
    };
    const unknown = (h: ReturnType<typeof harnessForValidation>) =>
      editorIssues(picked, h === undefined ? {} : { harness: h }).filter(
        (i) => i.code === 'unknown-check',
      );
    const ready = harnessForValidation({ state: 'ready', checks: CHECKS });
    expect(unknown(ready)).toHaveLength(1);
    expect(unknown(ready)[0]).toMatchObject({ severity: 'warning', nodeId: 'checks' });
    expect(unknown(ready)[0]?.message).toContain('"gone"');
    // Unreadable or still loading: nothing flagged. No harness file: null for core.
    expect(harnessForValidation({ state: 'invalid', checks: [] })).toBeUndefined();
    expect(harnessForValidation(undefined)).toBeUndefined();
    expect(harnessForValidation({ state: 'none', checks: [] })).toBeNull();
    expect(unknown(undefined)).toEqual([]);
  });

  it('a change block (back to the helper) and a branch block pass core’s validation', () => {
    let s = run(parse(customGraph()), { type: 'add-checks', place: 'change', near: 'helper-1' });
    s = run(
      s.graph,
      { type: 'set-check-failure', id: 'change-checks', onFailure: 'helper' },
      {
        type: 'update-node',
        id: 'change-checks',
        patch: { select: { kind: 'labels', labels: ['fast'] } },
      },
      { type: 'add-checks', place: 'branch' },
      {
        type: 'update-node',
        id: 'branch-checks',
        patch: { select: { kind: 'labels', labels: ['full'] } },
      },
    );
    const g = WorkflowGraphSchema.parse(s.graph);
    expect(has(g, 'flow', 'helper-1', 'change-checks')).toBe(true);
    expect(has(g, 'rework', 'change-checks', 'helper-1')).toBe(true);
    expect(has(g, 'flow', 'branch-checks', 'owner-merge')).toBe(true);
    const issues = validateWorkflowGraph(g, { harness: { checks: CHECKS } });
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(issues.filter((i) => i.nodeId?.endsWith('checks') === true)).toEqual([]);
    expect(isGraphRunnable(issues)).toBe(true);
  });

  it('an empty pick is a problem on the block, in words', () => {
    const g = parse(customGraph());
    const empty = {
      ...g,
      nodes: g.nodes.map((n) =>
        n.type === 'checks' ? { ...n, select: { kind: 'ids', ids: [] } } : n,
      ),
    } as WorkflowGraph;
    const issues = shapeIssues(empty);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ nodeId: 'checks', severity: 'error' });
    expect(issues[0]?.message).toContain('pick at least one check');
  });

  it('a check runs in every block that selects it, change first', () => {
    const g = run(
      parse(customGraph()),
      { type: 'add-checks', place: 'branch' },
      {
        type: 'update-node',
        id: 'branch-checks',
        patch: { select: { kind: 'labels', labels: ['full'] } },
      },
      { type: 'add-checks', place: 'change', near: 'helper-1' },
      {
        type: 'update-node',
        id: 'change-checks',
        patch: { select: { kind: 'ids', ids: ['lint'] } },
      },
    ).graph;
    const where = (id: string) =>
      blocksRunningCheck(g, CHECKS.find((c) => c.id === id) as HarnessCheck).map((b) => b.id);
    expect(where('lint')).toEqual(['change-checks', 'checks']);
    expect(where('e2e')).toEqual(['branch-checks']);
    expect(where('unit')).toEqual(['checks', 'branch-checks']);
  });
});

describe('check blocks: the editor', () => {
  it('the block before the lead’s merge is fixed: not removable, its place never changes', () => {
    const g = workflowTemplate('todays-setup');
    const merge = blockOf(g, 'checks');
    expect(merge).toBeDefined();
    expect(isRemovable(merge as WorkflowNode)).toBe(false);
    const s = run(g, { type: 'set-check-place', id: 'checks', place: 'branch' });
    expect(s.graph).toBe(g);
    const removed = run(g, { type: 'remove-node', id: 'checks' });
    expect(removed.graph.nodes.some((n) => n.id === 'checks')).toBe(true);
    // Only the lead or the owner may decide a failure before the lead's merge.
    const helper = run(g, { type: 'set-check-failure', id: 'checks', onFailure: 'helper' });
    expect(helper.graph).toBe(g);
    const owner = run(g, { type: 'set-check-failure', id: 'checks', onFailure: 'owner' });
    expect(blockOf(owner.graph, 'checks')?.onFailure).toBe('owner');
    expect(owner.graph.template).toBe('custom');
  });

  it('adds checks on a change, linked from the selected helper, and selects it', () => {
    const g = parse(customGraph());
    expect(checksAvailability(g, 'change')).toEqual({ ok: true });
    const s = run(g, { type: 'add-checks', place: 'change', near: 'helpers' });
    const block = blockOf(s.graph, 'change-checks');
    expect(block).toMatchObject({
      place: 'change',
      select: { kind: 'required' },
      onFailure: 'lead',
      label: 'Change checks',
    });
    expect(has(s.graph, 'flow', 'helpers', 'change-checks')).toBe(true);
    expect(s.selection).toEqual({ kind: 'node', id: 'change-checks' });
    expect(rowOf(block as WorkflowNode)).toBe(1);
    expect(kindWord(block as WorkflowNode)).toBe('Checks on a change');
    expect(selectionChip(block as ChecksNode)).toBe('Required');
  });

  it('one change block per editing block; none without helpers or testers', () => {
    let g = parse(customGraph());
    // Frontend helper, Helpers, Tester: three editing blocks.
    for (let i = 0; i < 3; i += 1) g = run(g, { type: 'add-checks', place: 'change' }).graph;
    const blocks = g.nodes.filter((n) => n.type === 'checks' && n.place === 'change');
    expect(blocks).toHaveLength(3);
    const avail = checksAvailability(g, 'change');
    expect(avail.ok).toBe(false);
    expect(run(g, { type: 'add-checks', place: 'change' }).graph).toBe(g);
    const lead = workflowTemplate('lead-only');
    const none = checksAvailability(
      { ...lead, nodes: lead.nodes.filter((n) => n.type !== 'helper-pool') },
      'change',
    );
    expect(none.ok).toBe(false);
  });

  it('“Back to the helper” adds the rework link (rounds 0–5); another route drops it', () => {
    let s = run(parse(customGraph()), { type: 'add-checks', place: 'change', near: 'helper-1' });
    s = run(s.graph, { type: 'set-check-failure', id: 'change-checks', onFailure: 'helper' });
    expect(has(s.graph, 'rework', 'change-checks', 'helper-1')).toBe(true);
    const rework = s.graph.edges.find((e) => e.type === 'rework' && e.from === 'change-checks');
    s = run(s.graph, { type: 'set-rounds', id: rework?.id ?? '', maxRounds: 9 });
    const rounds = s.graph.edges.find((e) => e.id === rework?.id);
    expect(rounds?.type === 'rework' ? rounds.maxRounds : null).toBe(5);
    s = run(s.graph, { type: 'set-check-failure', id: 'change-checks', onFailure: 'owner' });
    expect(has(s.graph, 'rework', 'change-checks', 'helper-1')).toBe(false);
    expect(checkFailureOf(blockOf(s.graph, 'change-checks') as ChecksNode)).toBe('owner');
  });

  it('adds checks on the branch just before your merge; removing it joins the chain again', () => {
    const g = parse(customGraph());
    const s = run(g, { type: 'add-checks', place: 'branch' });
    expect(blockOf(s.graph, 'branch-checks')).toMatchObject({
      place: 'branch',
      onFailure: 'owner',
    });
    expect(has(s.graph, 'flow', 'unit-tests', 'branch-checks')).toBe(true);
    expect(has(s.graph, 'flow', 'branch-checks', 'owner-merge')).toBe(true);
    expect(has(s.graph, 'flow', 'unit-tests', 'owner-merge')).toBe(false);
    expect(checksAvailability(s.graph, 'branch').ok).toBe(false);
    // On the merge chain, after the tester.
    const at = layoutGraph(s.graph);
    expect(at.get('branch-checks')?.x ?? 0).toBeGreaterThan(at.get('unit-tests')?.x ?? 0);
    // Only the owner decides a failure on the branch.
    const helper = run(s.graph, {
      type: 'set-check-failure',
      id: 'branch-checks',
      onFailure: 'lead',
    });
    expect(helper.graph).toBe(s.graph);
    const removed = run(s.graph, { type: 'remove-node', id: 'branch-checks' });
    expect(has(removed.graph, 'flow', 'unit-tests', 'owner-merge')).toBe(true);
    expect(removed.graph.nodes.some((n) => n.id === 'branch-checks')).toBe(false);
  });

  it('moves a block between a change and the branch with the other place’s wiring', () => {
    let s = run(parse(customGraph()), { type: 'add-checks', place: 'change', near: 'helper-1' });
    s = run(s.graph, { type: 'set-check-failure', id: 'change-checks', onFailure: 'helper' });
    s = run(s.graph, { type: 'set-check-place', id: 'change-checks', place: 'branch' });
    const moved = blockOf(s.graph, 'change-checks');
    expect(moved).toMatchObject({ place: 'branch', onFailure: 'owner' });
    expect(s.graph.edges.some((e) => e.from === 'change-checks' && e.type === 'rework')).toBe(
      false,
    );
    expect(has(s.graph, 'flow', 'change-checks', 'owner-merge')).toBe(true);
    s = run(s.graph, { type: 'set-check-place', id: 'change-checks', place: 'change' });
    expect(has(s.graph, 'flow', 'unit-tests', 'owner-merge')).toBe(true);
    expect(has(s.graph, 'flow', 'helper-1', 'change-checks')).toBe(true);
    expect(checkFailureOf(blockOf(s.graph, 'change-checks') as ChecksNode)).toBe('owner');
  });

  it('removing a helper removes the change block that checked only it', () => {
    let s = run(parse(customGraph()), { type: 'add-checks', place: 'change', near: 'helper-1' });
    s = run(s.graph, { type: 'remove-node', id: 'helper-1' });
    expect(s.graph.nodes.some((n) => n.id === 'change-checks')).toBe(false);
  });
});
