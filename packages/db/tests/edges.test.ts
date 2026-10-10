import { describe, expect, it } from 'vitest';
import { DbError, StoredValueError } from '../src/index.js';
import { at, key, sessionInput, setupStore } from './fixtures.js';
import { thrown } from './helpers.js';

function threeSessions() {
  const store = setupStore();
  const s = store.repos.sessions;
  const parent = s.upsert(sessionInput(key('sess-1'))).id;
  const other = s.upsert(sessionInput(key('sess-2'))).id;
  const child = s.upsert(sessionInput(key('sess-1', 'agent-a'))).id;
  return { ...store, parent, other, child };
}

describe('edges repository (B4)', () => {
  it('inserts an edge and reads it back', () => {
    const { repos, parent, child } = threeSessions();
    const result = repos.edges.upsert({
      kind: 'subagent',
      parentSessionId: parent,
      childSessionId: child,
      provenance: 'observed',
      evidence: ['subagent-metadata'],
      observedAt: at(1),
    });
    expect(result.outcome).toBe('inserted');
    expect(result.edge).toMatchObject({
      kind: 'subagent',
      parentSessionId: parent,
      childSessionId: child,
      provenance: 'observed',
      evidence: ['subagent-metadata'],
      createdAt: at(1),
      updatedAt: at(1),
    });
    expect(repos.edges.getByChild('subagent', child)).toEqual(result.edge);
    expect(repos.edges.getByChild('continuation', child)).toBeUndefined();
    expect(repos.edges.listChildren(parent).map((e) => e.childSessionId)).toEqual([child]);
    expect(repos.edges.listChildren(parent, 'continuation')).toEqual([]);
  });

  it('unions evidence for the same parent and is idempotent on re-ingestion', () => {
    const { repos, parent, child } = threeSessions();
    const base = {
      kind: 'subagent' as const,
      parentSessionId: parent,
      childSessionId: child,
      observedAt: at(1),
    };
    repos.edges.upsert({ ...base, provenance: 'derived', evidence: ['spawn-tool-use'] });
    const added = repos.edges.upsert({
      ...base,
      provenance: 'observed',
      evidence: ['subagent-metadata', 'spawn-tool-use'],
      observedAt: at(2),
    });
    expect(added.outcome).toBe('evidence-added');
    expect(added.edge).toMatchObject({
      evidence: ['spawn-tool-use', 'subagent-metadata'],
      // observed is stronger than derived and is kept.
      provenance: 'observed',
      createdAt: at(1),
      updatedAt: at(2),
    });
    const again = repos.edges.upsert({
      ...base,
      provenance: 'derived',
      evidence: ['subagent-metadata'],
      observedAt: at(3),
    });
    expect(again.outcome).toBe('unchanged');
    expect(again.edge).toEqual(added.edge);
  });

  it('records a different parent as a conflict and leaves the edge unchanged', () => {
    const { repos, parent, other, child } = threeSessions();
    const original = repos.edges.upsert({
      kind: 'subagent',
      parentSessionId: parent,
      childSessionId: child,
      provenance: 'observed',
      evidence: ['subagent-metadata'],
      observedAt: at(1),
    });
    const conflicting = {
      kind: 'subagent' as const,
      parentSessionId: other,
      childSessionId: child,
      provenance: 'derived' as const,
      evidence: ['subagent-hook' as const],
      observedAt: at(2),
    };
    const result = repos.edges.upsert(conflicting);
    expect(result.outcome).toBe('conflict');
    expect(result.edge).toEqual(original.edge);
    expect(repos.edges.getByChild('subagent', child)).toEqual(original.edge);

    // The same conflicting evidence again does not create a second diagnostic row.
    const repeat = repos.edges.upsert({
      ...conflicting,
      evidence: ['subagent-hook', 'spawn-tool-use'],
      observedAt: at(3),
    });
    expect(repeat.conflictId).toBe(result.conflictId);
    expect(repos.edges.listConflicts()).toEqual([
      {
        id: result.conflictId,
        edgeId: original.edge.id,
        kind: 'subagent',
        childSessionId: child,
        existingParentSessionId: parent,
        conflictingParentSessionId: other,
        provenance: 'derived',
        evidence: ['spawn-tool-use', 'subagent-hook'],
        firstSeenAt: at(2),
        lastSeenAt: at(3),
      },
    ]);
    expect(repos.edges.listConflicts(parent)).toEqual([]);
  });

  it('enforces core edge rules: evidence per kind, no self-loops, existing sessions', () => {
    const { repos, parent, child, other } = threeSessions();
    // Shared history alone never justifies a subagent edge.
    expect(
      thrown(() =>
        repos.edges.upsert({
          kind: 'subagent',
          parentSessionId: parent,
          childSessionId: child,
          provenance: 'derived',
          evidence: ['shared-message-history'],
          observedAt: at(1),
        }),
      ),
    ).toMatchObject({ code: 'invalid_input' });
    // A continuation edge requires shared-message-history evidence.
    expect(() =>
      repos.edges.upsert({
        kind: 'continuation',
        parentSessionId: parent,
        childSessionId: other,
        provenance: 'derived',
        evidence: ['subagent-metadata'],
        observedAt: at(1),
      }),
    ).toThrow(DbError);
    expect(() =>
      repos.edges.upsert({
        kind: 'subagent',
        parentSessionId: parent,
        childSessionId: child,
        provenance: 'observed',
        evidence: [],
        observedAt: at(1),
      }),
    ).toThrow(DbError);
    expect(() =>
      repos.edges.upsert({
        kind: 'continuation',
        parentSessionId: parent,
        childSessionId: parent,
        provenance: 'derived',
        evidence: ['shared-message-history'],
        observedAt: at(1),
      }),
    ).toThrow(DbError);
    expect(
      thrown(() =>
        repos.edges.upsert({
          kind: 'subagent',
          parentSessionId: 'missing',
          childSessionId: child,
          provenance: 'observed',
          evidence: ['subagent-metadata'],
          observedAt: at(1),
        }),
      ),
    ).toMatchObject({ code: 'not_found' });
    expect(repos.edges.listForSessions([parent, child, other])).toEqual([]);
  });

  it('allows one edge per kind for the same child and lists edges for sessions', () => {
    const { repos, parent, other, child } = threeSessions();
    repos.edges.upsert({
      kind: 'subagent',
      parentSessionId: parent,
      childSessionId: child,
      provenance: 'observed',
      evidence: ['subagent-metadata'],
      observedAt: at(1),
    });
    repos.edges.upsert({
      kind: 'continuation',
      parentSessionId: other,
      childSessionId: child,
      provenance: 'derived',
      evidence: ['shared-message-history'],
      observedAt: at(1),
    });
    expect(
      repos.edges
        .listForSessions([child])
        .map((e) => e.kind)
        .sort(),
    ).toEqual(['continuation', 'subagent']);
    expect(repos.edges.listForSessions([other]).map((e) => e.kind)).toEqual(['continuation']);
  });

  it('validates the evidence JSON on read', () => {
    const { db, repos, parent, child } = threeSessions();
    repos.edges.upsert({
      kind: 'subagent',
      parentSessionId: parent,
      childSessionId: child,
      provenance: 'observed',
      evidence: ['subagent-metadata'],
      observedAt: at(1),
    });
    db.connection.prepare(`UPDATE session_edges SET evidence = '["timing-guess"]'`).run();
    expect(() => repos.edges.getByChild('subagent', child)).toThrow(StoredValueError);
  });
});
