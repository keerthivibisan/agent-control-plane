import { describe, expect, it } from 'vitest';
import type {
  MessageSighting,
  SessionEdge,
  SubagentMetaEvidence,
  ToolCallSighting,
} from '../src/index.js';
import { deriveContinuationEdges, deriveSubagentEdge, SessionEdgeSchema } from '../src/index.js';
import { at, key } from './helpers/builders.js';

/** Every derived edge must satisfy the v1 contract, including its evidence refinements. */
function valid(edge: SessionEdge | null): SessionEdge {
  expect(edge).not.toBeNull();
  return SessionEdgeSchema.parse(edge);
}

function meta(overrides: Partial<SubagentMetaEvidence> = {}): SubagentMetaEvidence {
  return {
    provider: 'claude-code',
    providerSessionId: 'sess-1',
    agentId: 'a1',
    spawnToolUseId: 'toolu_1',
    spawnDepth: 1,
    ...overrides,
  };
}

function call(
  session = key('sess-1'),
  toolUseId = 'toolu_1',
  toolName = 'Agent',
): ToolCallSighting {
  return { session, toolUseId, toolName };
}

describe('deriveSubagentEdge (provider-adapters §5, A5)', () => {
  it('meta plus a matched tool use gives an observed edge with both kinds of evidence', () => {
    const edge = valid(deriveSubagentEdge(meta(), [call()]));
    expect(edge).toEqual({
      kind: 'subagent',
      parent: key('sess-1'),
      child: key('sess-1', 'a1'),
      provenance: 'observed',
      evidence: ['subagent-metadata', 'spawn-tool-use'],
    });
  });

  it('accepts the older Task tool name', () => {
    const edge = valid(deriveSubagentEdge(meta(), [call(key('sess-1'), 'toolu_1', 'Task')]));
    expect(edge.evidence).toContain('spawn-tool-use');
  });

  it('meta only gives an edge to the root with metadata evidence', () => {
    for (const toolCalls of [[], [call(key('sess-1'), 'toolu_other')]]) {
      const edge = valid(deriveSubagentEdge(meta(), toolCalls));
      expect(edge.parent).toEqual(key('sess-1'));
      expect(edge.evidence).toEqual(['subagent-metadata']);
    }
    const noToolUse = valid(deriveSubagentEdge(meta({ spawnToolUseId: null }), [call()]));
    expect(noToolUse.evidence).toEqual(['subagent-metadata']);
  });

  it('no meta gives no edge, even with a matching tool call', () => {
    expect(deriveSubagentEdge(null, [call()])).toBeNull();
  });

  it('ignores matching ids on non-spawn tools and in other sessions (fork copies)', () => {
    const edge = valid(
      deriveSubagentEdge(meta(), [
        call(key('sess-1'), 'toolu_1', 'Bash'),
        call(key('sess-fork'), 'toolu_1', 'Agent'),
      ]),
    );
    expect(edge.evidence).toEqual(['subagent-metadata']);
  });

  it('adds hook evidence when a SubagentStart/Stop hook named the agent', () => {
    const edge = valid(deriveSubagentEdge(meta({ hookObserved: true }), [call()]));
    expect(edge.evidence).toEqual(['subagent-metadata', 'spawn-tool-use', 'subagent-hook']);
  });

  it('depth 2 is matched to the subagent whose transcript holds the tool call', () => {
    const nestedMeta = meta({ agentId: 'a2', spawnToolUseId: 'toolu_nested', spawnDepth: 2 });
    const edge = valid(
      deriveSubagentEdge(nestedMeta, [call(), call(key('sess-1', 'a1'), 'toolu_nested')]),
    );
    expect(edge.parent).toEqual(key('sess-1', 'a1'));
    expect(edge.child).toEqual(key('sess-1', 'a2'));
    expect(edge.evidence).toEqual(['subagent-metadata', 'spawn-tool-use']);
  });

  it('depth 2 unmatched gives no edge (parent unknown), never the root', () => {
    const nestedMeta = meta({ agentId: 'a2', spawnToolUseId: 'toolu_nested', spawnDepth: 2 });
    expect(deriveSubagentEdge(nestedMeta, [call()])).toBeNull();
    expect(deriveSubagentEdge({ ...nestedMeta, spawnToolUseId: null }, [call()])).toBeNull();
    // The child's own transcript cannot be its spawner.
    expect(deriveSubagentEdge(nestedMeta, [call(key('sess-1', 'a2'), 'toolu_nested')])).toBeNull();
  });

  it('depth 2 matched in two different sessions is ambiguous and gives no edge', () => {
    const nestedMeta = meta({ agentId: 'a3', spawnToolUseId: 'toolu_x', spawnDepth: 2 });
    expect(
      deriveSubagentEdge(nestedMeta, [
        call(key('sess-1', 'a1'), 'toolu_x'),
        call(key('sess-1', 'a2'), 'toolu_x'),
      ]),
    ).toBeNull();
    // The same session seen twice (re-read line) is still one match.
    const edge = valid(
      deriveSubagentEdge(nestedMeta, [
        call(key('sess-1', 'a1'), 'toolu_x'),
        call(key('sess-1', 'a1'), 'toolu_x'),
      ]),
    );
    expect(edge.parent).toEqual(key('sess-1', 'a1'));
  });
});

function seen(sessionId: string, messageIds: string[], startSecond: number): MessageSighting[] {
  return messageIds.map((messageId, i) => ({
    messageId,
    session: key(sessionId),
    occurredAt: at(startSecond + i),
  }));
}

describe('deriveContinuationEdges (provider-adapters §5, A5)', () => {
  it('links a fork to the session whose messages it copied', () => {
    const edges = deriveContinuationEdges([
      ...seen('sess-a', ['m1', 'm2'], 0),
      // The fork's copies carry later timestamps here; its own message m3 is new.
      ...seen('sess-b', ['m1', 'm2', 'm3'], 10),
    ]);
    expect(edges.map(valid)).toEqual([
      {
        kind: 'continuation',
        parent: key('sess-a'),
        child: key('sess-b'),
        provenance: 'derived',
        evidence: ['shared-message-history'],
      },
    ]);
  });

  it('gives no edges without shared history', () => {
    expect(
      deriveContinuationEdges([...seen('sess-a', ['m1'], 0), ...seen('sess-b', ['m2'], 0)]),
    ).toEqual([]);
  });

  it('picks the nearest ancestor in a fork chain', () => {
    const edges = deriveContinuationEdges([
      ...seen('sess-z', ['z1'], 0),
      ...seen('sess-a', ['z1', 'a1'], 10),
      ...seen('sess-b', ['z1', 'a1', 'b1'], 20),
    ]);
    expect(edges.map((e) => [e.parent.providerSessionId, e.child.providerSessionId])).toEqual([
      ['sess-z', 'sess-a'],
      ['sess-a', 'sess-b'],
    ]);
  });

  it('gives no edge when no single session holds all inherited messages', () => {
    const edges = deriveContinuationEdges([
      ...seen('sess-a', ['a1'], 0),
      ...seen('sess-c', ['c1'], 0),
      ...seen('sess-b', ['a1', 'c1', 'b1'], 10),
    ]);
    expect(edges).toEqual([]);
  });

  it('never links a top-level session with its own subagents', () => {
    const edges = deriveContinuationEdges([
      { messageId: 'm1', session: key('sess-a'), occurredAt: at(0) },
      { messageId: 'm1', session: key('sess-a', 'agent1'), occurredAt: at(1) },
    ]);
    expect(edges).toEqual([]);
  });

  it('drops edges that would form a cycle', () => {
    // m1 is first seen in A and m2 in B; both files hold both, so each looks like the other's parent.
    const edges = deriveContinuationEdges([
      { messageId: 'm1', session: key('sess-a'), occurredAt: at(0) },
      { messageId: 'm2', session: key('sess-a'), occurredAt: at(9) },
      { messageId: 'm1', session: key('sess-b'), occurredAt: at(9) },
      { messageId: 'm2', session: key('sess-b'), occurredAt: at(0) },
    ]);
    expect(edges).toEqual([]);
  });

  it('does not depend on input order', () => {
    const input = [
      ...seen('sess-z', ['z1'], 0),
      ...seen('sess-a', ['z1', 'a1'], 10),
      ...seen('sess-b', ['z1', 'a1', 'b1'], 20),
    ];
    expect(deriveContinuationEdges([...input].reverse())).toEqual(deriveContinuationEdges(input));
  });
});

describe('continuation direction on timestamp ties (provider-adapters §5 amendment, A9)', () => {
  /** A fork copy keeps the original line's timestamp, which is the normal case locally. */
  function copy(from: MessageSighting[], sessionId: string): MessageSighting[] {
    return from.map((s) => ({ ...s, session: key(sessionId) }));
  }

  it('a fork copy with identical timestamps gives no edge: the direction is unknown', () => {
    const original = seen('sess-a', ['m1', 'm2'], 0);
    const edges = deriveContinuationEdges([
      ...original,
      ...copy(original, 'sess-b'),
      ...seen('sess-b', ['b1'], 30),
      ...seen('sess-a', ['a9'], 31),
    ]);
    expect(edges).toEqual([]);
  });

  it('a parent that saw the shared messages strictly earlier gives an edge', () => {
    const edges = deriveContinuationEdges([
      { messageId: 'm1', session: key('sess-a'), occurredAt: '2026-10-10T08:00:00.000Z' },
      { messageId: 'm1', session: key('sess-b'), occurredAt: '2026-10-10T08:00:00.001Z' },
    ]);
    expect(edges.map(valid).map((e) => [e.parent, e.child])).toEqual([
      [key('sess-a'), key('sess-b')],
    ]);
  });

  it('tied messages are ignored as evidence while strictly earlier ones still count', () => {
    const tiedPart = seen('sess-a', ['m1'], 0);
    const edges = deriveContinuationEdges([
      ...tiedPart,
      ...copy(tiedPart, 'sess-b'),
      { messageId: 'm2', session: key('sess-a'), occurredAt: at(5) },
      { messageId: 'm2', session: key('sess-b'), occurredAt: at(6) },
    ]);
    expect(edges.map((e) => [e.parent, e.child])).toEqual([[key('sess-a'), key('sess-b')]]);
  });

  it('equal instants in different string forms are a tie', () => {
    const edges = deriveContinuationEdges([
      { messageId: 'm1', session: key('sess-a'), occurredAt: '2026-10-10T08:00:00Z' },
      { messageId: 'm1', session: key('sess-b'), occurredAt: '2026-10-10T08:00:00.000Z' },
    ]);
    expect(edges).toEqual([]);
  });

  it('a null timestamp is never strictly earlier or later', () => {
    expect(
      deriveContinuationEdges([
        { messageId: 'm1', session: key('sess-a'), occurredAt: null },
        { messageId: 'm1', session: key('sess-b'), occurredAt: null },
      ]),
    ).toEqual([]);
    expect(
      deriveContinuationEdges([
        { messageId: 'm1', session: key('sess-a'), occurredAt: at(0) },
        { messageId: 'm1', session: key('sess-b'), occurredAt: null },
      ]),
    ).toEqual([]);
  });

  it('a strictly earlier origin whose copy in the candidate ties with the child gives no edge', () => {
    // Z -> A -> B, but A and B hold Z's message with the same (copied) time: A is not provably
    // earlier than B for everything B inherited, so B's parent stays unknown.
    const edges = deriveContinuationEdges([
      { messageId: 'z1', session: key('sess-z'), occurredAt: at(0) },
      { messageId: 'z1', session: key('sess-a'), occurredAt: at(10) },
      { messageId: 'z1', session: key('sess-b'), occurredAt: at(10) },
      { messageId: 'a1', session: key('sess-a'), occurredAt: at(11) },
      { messageId: 'a1', session: key('sess-b'), occurredAt: at(12) },
    ]);
    expect(edges.map((e) => [e.parent.providerSessionId, e.child.providerSessionId])).toEqual([
      ['sess-z', 'sess-a'],
    ]);
  });
});
