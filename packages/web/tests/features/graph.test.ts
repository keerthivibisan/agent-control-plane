import { describe, expect, it } from 'vitest';
import { buildGraph } from '../../src/features/sessions/graph';
import { buildGantt } from '../../src/features/sessions/gantt';
import { edge, session, T0, T1, T2, tree } from '../fixtures/dto';

const root = session({ id: 'root', title: 'Main' });
const a = session({ id: 'a', agentType: 'Explore', providerAgentId: 'ag-a', childCount: 1 });
const b = session({ id: 'b', agentType: 'Plan', providerAgentId: 'ag-b' });
const fork = session({ id: 'fork', title: 'Forked' });
// Same provider session id, same cwd, overlapping time and a childCount claim: none of these may
// create an edge. Only `edges` does.
const lookalike = session({
  id: 'lookalike',
  providerSessionId: root.providerSessionId,
  providerAgentId: 'ag-x',
  childCount: 4,
});

describe('buildGraph', () => {
  const t = tree(
    'root',
    [root, a, b, fork, lookalike],
    [edge('root', 'a'), edge('a', 'b'), edge('root', 'fork', 'continuation')],
  );

  it('builds edges only from the DTO edges', () => {
    const g = buildGraph(t);
    expect(g.edges.map((e) => [e.source, e.target, e.data?.kind])).toEqual([
      ['root', 'a', 'subagent'],
      ['a', 'b', 'subagent'],
      ['root', 'fork', 'continuation'],
    ]);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'fork', 'lookalike', 'root']);
  });

  it('marks parent unknown exactly for nodes no edge points at', () => {
    const g = buildGraph(t);
    const parent = Object.fromEntries(g.nodes.map((n) => [n.id, n.data.parent]));
    expect(parent).toEqual({
      root: 'unknown',
      a: 'known',
      b: 'known',
      fork: 'known',
      lookalike: 'unknown',
    });
  });

  it('styles subagent and continuation edges differently', () => {
    const g = buildGraph(t);
    const sub = g.edges.find((e) => e.data?.kind === 'subagent');
    const cont = g.edges.find((e) => e.data?.kind === 'continuation');
    expect(sub?.className).toBe('edge-subagent');
    expect(cont?.className).toBe('edge-continuation');
    expect(cont?.style?.strokeDasharray).toBeDefined();
    expect(sub?.style?.strokeDasharray).toBeUndefined();
    expect(cont?.label).toBe('continuation (fork)');
  });

  it('collapse hides descendants and reports how many', () => {
    const g = buildGraph(t, new Set(['root']));
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['lookalike', 'root']);
    expect(g.edges).toHaveLength(0);
    const r = g.nodes.find((n) => n.id === 'root');
    expect(r?.data.collapsed).toBe(true);
    expect(r?.data.hiddenDescendants).toBe(3);

    const partial = buildGraph(t, new Set(['a']));
    expect(partial.nodes.map((n) => n.id).sort()).toEqual(['a', 'fork', 'lookalike', 'root']);
  });

  it('drops edges whose endpoints are not in the tree instead of guessing', () => {
    const g = buildGraph(tree('root', [root, a], [edge('root', 'a'), edge('ghost', 'a')]));
    expect(g.edges).toHaveLength(1);
    expect(g.danglingEdges).toBe(1);
  });

  it('lays children to the right of their parent and marks the focus', () => {
    const g = buildGraph(t, new Set(), 'b');
    const pos = Object.fromEntries(g.nodes.map((n) => [n.id, n.position]));
    expect(pos.a?.x).toBeGreaterThan(pos.root?.x ?? Infinity);
    expect(pos.b?.x).toBeGreaterThan(pos.a?.x ?? Infinity);
    expect(g.nodes.find((n) => n.id === 'b')?.data.isFocus).toBe(true);
  });
});

describe('buildGantt', () => {
  it('spans first seen to last event and computes peak overlap', () => {
    const g = buildGantt([
      session({ id: 's1', firstSeenAt: T0, lastEventAt: T2 }),
      session({ id: 's2', firstSeenAt: T1, lastEventAt: T2 }),
      session({ id: 's3', firstSeenAt: T2, lastEventAt: null }),
    ]);
    expect(g?.rows.map((r) => r.session.id)).toEqual(['s1', 's2', 's3']);
    expect(g?.rows[0]?.leftPct).toBe(0);
    expect(g?.rows[0]?.widthPct).toBe(100);
    expect(g?.rows[2]?.noEvents).toBe(true);
    expect(g?.rows[2]?.widthPct).toBe(0);
    expect(g?.peakConcurrency).toBe(3);
  });

  it('returns null for no sessions', () => {
    expect(buildGantt([])).toBeNull();
  });
});
