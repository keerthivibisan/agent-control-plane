import { describe, expect, it } from 'vitest';
import { groupSessions } from '../../src/features/sessions/grouping';
import { edge, session, T0, T1, T2 } from '../fixtures/dto';

const parent = session({ id: 'p', title: 'Main', childCount: 2 });
const late = session({ id: 'h-late', providerAgentId: 'ag-1', agentType: 'Plan', firstSeenAt: T2 });
const early = session({
  id: 'h-early',
  providerAgentId: 'ag-2',
  agentType: 'Explore',
  firstSeenAt: T1,
});
const other = session({ id: 'o', title: 'Other', firstSeenAt: T0 });

const order = (rows: ReturnType<typeof groupSessions>) => rows.map((r) => [r.session.id, r.depth]);

describe('groupSessions', () => {
  it('puts helper agents under their parent, in start order, from subagent edges', () => {
    const rows = groupSessions(
      [late, other, parent, early],
      [edge('p', 'h-late'), edge('p', 'h-early')],
    );
    expect(order(rows)).toEqual([
      ['o', 0],
      ['p', 0],
      ['h-early', 1],
      ['h-late', 1],
    ]);
  });

  it('never nests without an edge, even with the same provider session id', () => {
    const lookalike = session({
      id: 'look',
      providerSessionId: parent.providerSessionId,
      providerAgentId: 'ag-x',
    });
    const rows = groupSessions([parent, lookalike], []);
    expect(order(rows)).toEqual([
      ['p', 0],
      ['look', 0],
    ]);
  });

  it('ignores continuation edges and edges to sessions on other pages', () => {
    const rows = groupSessions(
      [parent, other],
      [edge('p', 'o', 'continuation'), edge('p', 'not-on-page'), edge('elsewhere', 'o')],
    );
    expect(order(rows)).toEqual([
      ['p', 0],
      ['o', 0],
    ]);
  });

  it('keeps every session exactly once, even when the edges form a cycle', () => {
    const rows = groupSessions([parent, early], [edge('p', 'h-early'), edge('h-early', 'p')]);
    expect(rows.map((r) => r.session.id).sort()).toEqual(['h-early', 'p']);
  });
});
