import {
  WorkflowGraphSchema,
  canConnect,
  validateWorkflowGraph,
  type WorkflowGraph,
} from '@acp/core';
import { describe, expect, it } from 'vitest';
import { customGraph, migratedGraph } from '../../e2e/workflow-fixtures';
import { finishView } from '../../src/features/workflow/finish';
import { linkTargets } from '../../src/features/workflow/editor/flow';
import {
  HISTORY_LIMIT,
  historyReducer,
  initialHistoryState,
  type HistoryAction,
  type HistoryState,
} from '../../src/features/workflow/editor/history';
import { layoutGraph } from '../../src/features/workflow/editor/layout';
import {
  anchorOn,
  distanceToBlock,
  linkChoices,
  linkOutcome,
  reconnectTargets,
  resolveReconnect,
  snapTarget,
  type BlockRect,
} from '../../src/features/workflow/editor/linking';
import { createLinkStore, IDLE } from '../../src/features/workflow/editor/link-store';
import {
  editorReducer,
  initialEditorState,
  resolveLink,
  sameGraph,
  tidyGraph,
} from '../../src/features/workflow/editor/state';

/*
 * v0.3.1 P-C: linking blocks, the pure parts. Where a dropped link ends (magnetic snapping), the
 * "Link to…" list, one fitting kind linking at once, moving a link's end, undo and redo, and Tidy
 * layout. Every rule is core's `canConnect`; these tests check that every way of linking goes
 * through it and makes only links core accepts.
 */

const parse = (g: unknown): WorkflowGraph => WorkflowGraphSchema.parse(g);
const migrated = () => parse(migratedGraph());
const custom = () => parse(customGraph());
const errors = (g: WorkflowGraph) => validateWorkflowGraph(g).filter((i) => i.severity === 'error');
const run = (graph: WorkflowGraph, ...actions: HistoryAction[]): HistoryState =>
  actions.reduce(historyReducer, initialHistoryState(graph));
const has = (g: WorkflowGraph, type: string, from: string, to: string) =>
  g.edges.some((e) => e.type === type && e.from === from && e.to === to);
/** The migrated graph with a named helper nobody links to yet. */
const withHelper = () =>
  editorReducer(initialEditorState(migrated()), { type: 'add', item: 'helper' }).graph;

describe('snapTarget: where a dropped link ends', () => {
  const rects: BlockRect[] = [
    { id: 'a', x: 0, y: 0, width: 100, height: 50 },
    { id: 'b', x: 300, y: 0, width: 100, height: 50 },
    { id: 'c', x: 0, y: 200, width: 100, height: 50 },
  ];
  const targets = new Map([
    ['a', 'source'],
    ['b', 'valid'],
    ['c', 'invalid'],
  ] as const);

  it('the block under the pointer wins, valid or not (so a refusal can say why)', () => {
    expect(snapTarget({ x: 350, y: 25 }, rects, targets, 80, 'a')).toEqual({
      id: 'b',
      under: true,
    });
    expect(snapTarget({ x: 50, y: 225 }, rects, targets, 80, 'a')).toEqual({
      id: 'c',
      under: true,
    });
  });

  it('a drop just outside a border still lands on the block (the slop)', () => {
    expect(snapTarget({ x: 297, y: 25 }, rects, targets, 0, 'a', 4)).toEqual({
      id: 'b',
      under: true,
    });
    expect(snapTarget({ x: 50, y: 197 }, rects, targets, 80, 'a', 4)).toEqual({
      id: 'c',
      under: true,
    });
  });

  it('over empty canvas: the nearest valid block within the radius, never an invalid one', () => {
    expect(snapTarget({ x: 240, y: 25 }, rects, targets, 80, 'a')).toEqual({
      id: 'b',
      under: false,
    });
    expect(snapTarget({ x: 200, y: 25 }, rects, targets, 80, 'a')).toBeNull();
    // Right next to the invalid block, but it never attracts a link.
    expect(snapTarget({ x: 50, y: 280 }, rects, targets, 80, 'a')).toBeNull();
  });

  it('never ends on the block the link starts from', () => {
    expect(snapTarget({ x: 50, y: 25 }, rects, targets, 80, 'a')).toBeNull();
  });

  it('distanceToBlock is 0 inside; anchorOn picks the side facing the start', () => {
    const b = rects[1] as BlockRect;
    expect(distanceToBlock({ x: 320, y: 10 }, b)).toBe(0);
    expect(distanceToBlock({ x: 290, y: 25 }, b)).toBe(10);
    expect(anchorOn(b, { x: 0, y: 25 })).toMatchObject({ side: 'left', x: 300, y: 25 });
    expect(anchorOn(b, { x: 350, y: 400 })).toMatchObject({ side: 'bottom', x: 350, y: 50 });
  });
});

describe('the link store', () => {
  it('notifies only on a real change and resets to idle', () => {
    const store = createLinkStore();
    let calls = 0;
    const off = store.subscribe(() => (calls += 1));
    store.set({ from: 'a', mode: 'drag' });
    store.set({ from: 'a', mode: 'drag' });
    store.set({ snap: 'b' });
    expect(calls).toBe(2);
    store.reset();
    store.reset();
    expect(store.get()).toBe(IDLE);
    expect(calls).toBe(3);
    off();
  });
});

describe('linkChoices: the "Link to…" list', () => {
  it('lists only blocks core allows, each fitting kind once, and every one connects', () => {
    for (const graph of [migrated(), custom(), withHelper()]) {
      const drawn = finishView(graph).graph.nodes;
      for (const from of drawn) {
        const choices = linkChoices(graph, from.id);
        for (const c of choices) {
          expect(c.to).not.toBe(from.id);
          expect(canConnect(graph, c.link.from, c.link.to, c.type).ok).toBe(true);
          expect(drawn.some((n) => n.id === c.to)).toBe(true);
        }
        // Every drawn block core allows is offered, and none it refuses.
        const offered = new Set(choices.map((c) => c.to));
        for (const to of drawn) {
          if (to.id === from.id) continue;
          expect(offered.has(to.id)).toBe(resolveLink(graph, from.id, to.id) !== null);
        }
        // The same blocks light up while a link is dragged from it.
        const lit = linkTargets(graph, from.id);
        for (const [id, t] of lit ?? []) {
          if (t !== 'source') expect(t === 'valid').toBe(offered.has(id));
        }
      }
    }
  });

  it('the lead → a new helper offers both kinds that fit; Done offers nothing', () => {
    const g = withHelper();
    const toHelper = linkChoices(g, 'orchestrate').filter((c) => c.to === 'helper-1');
    expect(toHelper.map((c) => c.type)).toEqual(['assigns', 'rework']);
    expect(toHelper[0]?.label).toBe('Helper 1');
    expect(linkChoices(g, 'done')).toEqual([]);
    expect(linkChoices(g, 'no-such-block')).toEqual([]);
  });
});

describe('linkOutcome: a drop or a click on a block', () => {
  it('one fitting kind links at once', () => {
    const g = withHelper();
    expect(linkOutcome(g, 'helper-1', 'review')).toEqual({
      kind: 'link',
      from: 'helper-1',
      to: 'review',
      type: 'review',
    });
  });

  it('several kinds ask; none is refused in core’s words; nothing or itself does nothing', () => {
    const g = withHelper();
    const choose = linkOutcome(g, 'orchestrate', 'helper-1');
    expect(choose.kind).toBe('choose');
    if (choose.kind === 'choose') expect(choose.option.types).toEqual(['assigns', 'rework']);
    const refused = linkOutcome(g, 'helper-1', 'checks');
    expect(refused.kind).toBe('refused');
    if (refused.kind === 'refused') {
      expect(refused.message).toContain('cannot send its change for review to "Checks"');
    }
    expect(linkOutcome(g, 'helper-1', null)).toEqual({ kind: 'none' });
    expect(linkOutcome(g, 'helper-1', 'helper-1')).toEqual({ kind: 'none' });
  });

  it('a link drawn to the Finish block ends on the step core allows (the ticket merge)', () => {
    const g = migrated();
    const finish = finishView(g).finish?.ownerMerge ?? '';
    // Checks → Finish already exists: refused as a duplicate, in core's words.
    const outcome = linkOutcome(g, 'checks', finish);
    expect(outcome.kind).toBe('refused');
  });
});

describe('moving a link end (reconnect)', () => {
  it('every lit block takes the moved end (checked by core); every other one snaps back', () => {
    let g = withHelper();
    g = editorReducer(initialEditorState(g), {
      type: 'connect',
      from: 'helper-1',
      to: 'review',
      edgeType: 'review',
    }).graph;
    const link = g.edges.find((e) => e.type === 'review' && e.from === 'helper-1');
    if (link === undefined) throw new Error('no link');
    for (const moving of ['source', 'target'] as const) {
      const lit = reconnectTargets(g, link.id, moving);
      if (lit === null) throw new Error('no targets');
      expect(lit.get(moving === 'source' ? 'review' : 'helper-1')).toBe('source');
      // Dropped back on the end it had: nothing changes.
      expect(
        resolveReconnect(g, link.id, moving, moving === 'source' ? 'helper-1' : 'review'),
      ).toEqual({ kind: 'same' });
      for (const [id, t] of lit) {
        if (t === 'source') continue;
        const result = resolveReconnect(g, link.id, moving, id);
        // The end it has now is lit too (the link may stay); dropped there, nothing changes.
        if (id === (moving === 'source' ? 'helper-1' : 'review')) {
          expect(t).toBe('valid');
          expect(result).toEqual({ kind: 'same' });
          continue;
        }
        if (t === 'invalid') {
          // Refused in core's words; the reducer keeps the link where it was, nothing recorded.
          expect(result.kind).toBe('refused');
          const kept = run(g, {
            type: 'reconnect',
            id: link.id,
            from: moving === 'source' ? id : 'helper-1',
            to: moving === 'source' ? 'review' : id,
            edgeType: 'review',
          });
          expect(kept.graph).toBe(g);
          expect(kept.past).toHaveLength(0);
          continue;
        }
        expect(result.kind).toBe('ok');
        if (result.kind !== 'ok') continue;
        const [type] = result.types;
        if (type === undefined) throw new Error('no kind');
        const moved = run(g, {
          type: 'reconnect',
          id: link.id,
          from: result.from,
          to: result.to,
          edgeType: type,
        });
        expect(moved.past).toHaveLength(1);
        expect(moved.graph.edges).toHaveLength(g.edges.length);
        expect(has(moved.graph, type, result.from, result.to)).toBe(true);
        expect(moved.graph.edges.some((e) => e.id === link.id)).toBe(
          result.from === link.from && result.to === link.to,
        );
      }
    }
    // The pool already sends its review to the reviewer: moving the start there is a duplicate.
    expect(reconnectTargets(g, link.id, 'source')?.get('helpers')).toBe('invalid');
    expect(resolveReconnect(g, link.id, 'source', 'checks').kind).toBe('refused');
    expect(reconnectTargets(g, 'no-such-link', 'source')).toBeNull();
  });

  it('the target end of a rework link moves to another helper, keeping its rounds', () => {
    let g = withHelper();
    g = editorReducer(initialEditorState(g), {
      type: 'connect',
      from: 'orchestrate',
      to: 'helper-1',
      edgeType: 'assigns',
    }).graph;
    const rework = g.edges.find((e) => e.type === 'rework' && e.from === 'orchestrate');
    if (rework === undefined || rework.type !== 'rework') throw new Error('no rework');
    const result = resolveReconnect(g, rework.id, 'target', 'helper-1');
    expect(result).toEqual({ kind: 'ok', from: 'orchestrate', to: 'helper-1', types: ['rework'] });
    const moved = run(g, {
      type: 'reconnect',
      id: rework.id,
      from: 'orchestrate',
      to: 'helper-1',
      edgeType: 'rework',
    });
    expect(has(moved.graph, 'rework', 'orchestrate', 'helper-1')).toBe(true);
    expect(has(moved.graph, 'rework', 'orchestrate', 'helpers')).toBe(false);
    const after = moved.graph.edges.find((e) => e.type === 'rework' && e.to === 'helper-1');
    expect(after && 'maxRounds' in after ? after.maxRounds : null).toBe(rework.maxRounds);
    // Same number of links, at the same place in the list.
    expect(moved.graph.edges).toHaveLength(g.edges.length);
    expect(moved.graph.edges.findIndex((e) => e.id === after?.id)).toBe(
      g.edges.findIndex((e) => e.id === rework.id),
    );
    expect(moved.selection).toEqual({ kind: 'edge', id: after?.id });
  });
});

describe('undo and redo', () => {
  const g0 = migrated();

  it('a link added, then undone and redone', () => {
    const s = run(withHelper(), {
      type: 'connect',
      from: 'helper-1',
      to: 'review',
      edgeType: 'review',
    });
    expect(has(s.graph, 'review', 'helper-1', 'review')).toBe(true);
    const undone = historyReducer(s, { type: 'undo' });
    expect(has(undone.graph, 'review', 'helper-1', 'review')).toBe(false);
    expect(undone.future).toHaveLength(1);
    const redone = historyReducer(undone, { type: 'redo' });
    expect(has(redone.graph, 'review', 'helper-1', 'review')).toBe(true);
    expect(redone.future).toHaveLength(0);
  });

  it('a link removed and a block added, removed and moved: each one step', () => {
    const rework = g0.edges.find((e) => e.type === 'rework');
    if (rework === undefined) throw new Error('no rework');
    const steps: HistoryAction[] = [
      { type: 'remove-edge', id: rework.id },
      { type: 'add', item: 'tester' },
      { type: 'move-node', id: 'orchestrate', position: { x: 40, y: 400 } },
      { type: 'remove-node', id: 'unit-tests' },
    ];
    const states = [initialHistoryState(g0)];
    for (const a of steps) {
      const prev = states[states.length - 1] as HistoryState;
      const next = historyReducer(prev, a);
      expect(next.graph).not.toBe(prev.graph);
      states.push(next);
    }
    let s = states[states.length - 1] as HistoryState;
    expect(s.past).toHaveLength(steps.length);
    for (let i = states.length - 2; i >= 0; i -= 1) {
      s = historyReducer(s, { type: 'undo' });
      expect(sameGraph(s.graph, (states[i] as HistoryState).graph)).toBe(true);
    }
    expect(sameGraph(s.graph, g0)).toBe(true);
    // Nothing more to undo.
    expect(historyReducer(s, { type: 'undo' })).toBe(s);
    for (let i = 1; i < states.length; i += 1) {
      s = historyReducer(s, { type: 'redo' });
      expect(sameGraph(s.graph, (states[i] as HistoryState).graph)).toBe(true);
    }
    expect(historyReducer(s, { type: 'redo' })).toBe(s);
  });

  it('a block and its links deleted with one key are one step', () => {
    const g = custom();
    const s = run(g, {
      type: 'batch',
      actions: [
        { type: 'remove-node', id: 'helper-1' },
        { type: 'remove-edge', id: 'no-such-edge' },
      ],
    });
    expect(s.graph.nodes.some((n) => n.id === 'helper-1')).toBe(false);
    expect(s.past).toHaveLength(1);
    expect(sameGraph(historyReducer(s, { type: 'undo' }).graph, g)).toBe(true);
  });

  it('a link end moved is one step; undo puts it back', () => {
    let g = withHelper();
    g = editorReducer(initialEditorState(g), {
      type: 'connect',
      from: 'orchestrate',
      to: 'helper-1',
      edgeType: 'assigns',
    }).graph;
    const rework = g.edges.find((e) => e.type === 'rework');
    if (rework === undefined) throw new Error('no rework');
    const s = run(g, {
      type: 'reconnect',
      id: rework.id,
      from: 'orchestrate',
      to: 'helper-1',
      edgeType: 'rework',
    });
    expect(s.past).toHaveLength(1);
    expect(sameGraph(historyReducer(s, { type: 'undo' }).graph, g)).toBe(true);
  });

  it('typing in one field is one step; another field or block starts a new one', () => {
    const s = run(
      g0,
      { type: 'update-node', id: 'orchestrate', patch: { label: 'L' } },
      { type: 'update-node', id: 'orchestrate', patch: { label: 'Le' } },
      { type: 'update-node', id: 'orchestrate', patch: { label: 'Lead 2' } },
    );
    expect(s.past).toHaveLength(1);
    const more = run(
      s.graph,
      { type: 'update-node', id: 'orchestrate', patch: { label: 'A' } },
      { type: 'update-node', id: 'orchestrate', patch: { model: 'claude-opus-4' } },
      { type: 'update-node', id: 'review', patch: { label: 'B' } },
    );
    expect(more.past).toHaveLength(3);
    expect(sameGraph(historyReducer(s, { type: 'undo' }).graph, g0)).toBe(true);
  });

  it('selecting, refusing or a no-op leaves the stacks alone and keeps the graph’s identity', () => {
    const s = run(
      g0,
      { type: 'select', selection: { kind: 'node', id: 'orchestrate' } },
      { type: 'refuse', message: 'no' },
      { type: 'move-node', id: 'orchestrate', position: { x: 0, y: 0 } },
    );
    const moved = run(s.graph, { type: 'move-node', id: 'orchestrate', position: { x: 0, y: 0 } });
    expect(s.past.length).toBeLessThanOrEqual(1);
    expect(moved.past).toHaveLength(0);
    expect(moved.graph).toBe(s.graph);
    const selected = run(g0, { type: 'select', selection: { kind: 'node', id: 'review' } });
    expect(selected.graph).toBe(g0);
    expect(selected.past).toHaveLength(0);
  });

  it('a new edit clears redo; undo drops a selection that is gone', () => {
    let s = run(g0, { type: 'add', item: 'tester' });
    expect(s.selection).toEqual({ kind: 'node', id: 'unit-tests' });
    s = historyReducer(s, { type: 'undo' });
    expect(s.selection).toBeNull();
    expect(s.future).toHaveLength(1);
    s = historyReducer(s, { type: 'add', item: 'planner' });
    expect(s.future).toHaveLength(0);
  });

  it(`keeps at most ${HISTORY_LIMIT} steps`, () => {
    let s = initialHistoryState(g0);
    for (let i = 0; i < HISTORY_LIMIT + 15; i += 1) {
      s = historyReducer(s, { type: 'move-node', id: 'orchestrate', position: { x: i + 1, y: 0 } });
    }
    expect(s.past).toHaveLength(HISTORY_LIMIT);
    for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) s = historyReducer(s, { type: 'undo' });
    expect(s.past).toHaveLength(0);
    expect(s.future).toHaveLength(HISTORY_LIMIT);
    // The oldest steps went: the earliest graph left is after the 15th move.
    expect(s.graph.nodes.find((n) => n.id === 'orchestrate')?.position).toEqual({ x: 15, y: 0 });
  });

  it('undoing back to the saved graph is the saved graph again (no "unsaved changes")', () => {
    const s = run(g0, { type: 'add', item: 'tester' }, { type: 'undo' });
    expect(sameGraph(s.graph, g0)).toBe(true);
  });
});

describe('Tidy layout', () => {
  it('drops every moved position: the same blocks and links, still valid, the automatic layout', () => {
    for (const graph of [migrated(), custom()]) {
      const moved = run(
        graph,
        { type: 'move-node', id: 'orchestrate', position: { x: 900, y: 900 } },
        { type: 'move-node', id: 'review', position: { x: -300, y: 40 } },
      ).graph;
      const s = run(moved, { type: 'tidy' });
      const tidy = s.graph;
      expect(tidy.nodes.map((n) => n.id)).toEqual(graph.nodes.map((n) => n.id));
      expect(tidy.edges).toEqual(moved.edges);
      expect(tidy.nodes.every((n) => n.position === undefined)).toBe(true);
      expect(errors(tidy)).toEqual(errors(graph));
      expect(layoutGraph(tidy)).toEqual(layoutGraph(graph));
      // One undo step, and undo puts the moved blocks back.
      expect(s.past).toHaveLength(1);
      expect(sameGraph(historyReducer(s, { type: 'undo' }).graph, moved)).toBe(true);
      // Already tidy: nothing to do, nothing recorded.
      expect(tidyGraph(tidy)).toBe(tidy);
      expect(historyReducer(s, { type: 'tidy' })).toEqual(s);
    }
  });
});
