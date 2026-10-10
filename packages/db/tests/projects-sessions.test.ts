import { describe, expect, it } from 'vitest';
import { DbError, StoredValueError, type SessionRow } from '../src/index.js';
import { at, key, sessionInput, setupStore, T0 } from './fixtures.js';
import { thrown } from './helpers.js';

describe('projects repository (B4)', () => {
  it('inserts, reads, lists, renames, and removes projects', () => {
    const { repos } = setupStore();
    const b = repos.projects.insert({ name: 'beta', rootPath: '/home/user/beta' });
    const a = repos.projects.insert({ name: 'alpha', rootPath: '/home/user/alpha' });
    expect(a).toEqual({
      id: 'id-0002',
      name: 'alpha',
      rootPath: '/home/user/alpha',
      createdAt: '2026-10-10T12:00:01.000Z',
      updatedAt: '2026-10-10T12:00:01.000Z',
    });
    expect(repos.projects.getById(b.id)).toEqual(b);
    expect(repos.projects.getByRootPath('/home/user/alpha')).toEqual(a);
    expect(repos.projects.getById('missing')).toBeUndefined();
    expect(repos.projects.list().map((p) => p.name)).toEqual(['alpha', 'beta']);

    const renamed = repos.projects.rename(a.id, 'alpha-2');
    expect(renamed).toMatchObject({ name: 'alpha-2', createdAt: a.createdAt });
    expect((renamed?.updatedAt ?? '') > a.updatedAt).toBe(true);
    expect(repos.projects.rename('missing', 'x')).toBeUndefined();

    expect(repos.projects.remove(b.id)).toBe(true);
    expect(repos.projects.remove(b.id)).toBe(false);
  });

  it('rejects a duplicate root path with a typed conflict error, and invalid input', () => {
    const { repos } = setupStore();
    repos.projects.insert({ name: 'a', rootPath: '/repo' });
    expect(thrown(() => repos.projects.insert({ name: 'b', rootPath: '/repo' }))).toMatchObject({
      code: 'conflict',
    });
    expect(() => repos.projects.insert({ name: 'c', rootPath: 'relative/path' })).toThrow(DbError);
  });

  it('detaches sessions when a project is removed', () => {
    const { repos } = setupStore();
    const p = repos.projects.insert({ name: 'a', rootPath: '/repo' });
    const s = repos.sessions.upsert(sessionInput(key('s1'), { projectId: p.id }));
    repos.projects.remove(p.id);
    expect(repos.sessions.getById(s.id)?.projectId).toBeNull();
    expect(repos.sessions.listUnassigned().map((r) => r.id)).toEqual([s.id]);
  });
});

describe('sessions repository (B4)', () => {
  it('creates a session and maps a top-level key to providerAgentId null', () => {
    const { repos } = setupStore();
    const result = repos.sessions.upsert(
      sessionInput(key('sess-1'), { launchCwd: '/repo', lastEventAt: at(1) }),
    );
    expect(result).toEqual({ id: 'id-0001', created: true });
    expect(repos.sessions.getById(result.id)).toEqual({
      id: 'id-0001',
      provider: 'claude-code',
      providerSessionId: 'sess-1',
      providerAgentId: null,
      projectId: null,
      origin: 'external',
      launchCwd: '/repo',
      gitBranch: null,
      entrypoint: null,
      providerVersion: null,
      title: null,
      agentType: null,
      description: null,
      firstSeenAt: T0,
      lastObservedAt: T0,
      lastEventAt: at(1),
      endedAt: null,
      endReason: null,
      lastAttentionAt: null,
      metadata: {},
    });
    expect(repos.sessions.getByKey(key('sess-1'))?.id).toBe(result.id);
  });

  it('keeps a subagent distinct from its parent session', () => {
    const { repos } = setupStore();
    const parent = repos.sessions.upsert(sessionInput(key('sess-1')));
    const child = repos.sessions.upsert(
      sessionInput(key('sess-1', 'agent-a'), { agentType: 'Explore' }),
    );
    expect(child.id).not.toBe(parent.id);
    expect(repos.sessions.getByKey(key('sess-1', 'agent-a'))?.agentType).toBe('Explore');
    expect(
      repos.sessions.listByProviderSession('claude-code', 'sess-1').map((s) => s.providerAgentId),
    ).toEqual([null, 'agent-a']);
  });

  it('merges by key: min firstSeenAt, max lastObservedAt/lastEventAt, never clearing values', () => {
    const { repos } = setupStore();
    const k = key('sess-1');
    const first = repos.sessions.upsert(
      sessionInput(k, {
        firstSeenAt: at(10),
        lastObservedAt: at(10),
        lastEventAt: at(10),
        launchCwd: '/repo',
        entrypoint: 'cli',
        gitBranch: 'main',
        title: 'First title',
      }),
    );
    // Out-of-order arrival: an older record shows up later with partial data.
    const second = repos.sessions.upsert(
      sessionInput(k, {
        firstSeenAt: at(2),
        lastObservedAt: at(5),
        lastEventAt: at(3),
        launchCwd: '/repo/sub',
        entrypoint: null,
        gitBranch: null,
        title: null,
      }),
    );
    expect(second).toEqual({ id: first.id, created: false });
    const row = repos.sessions.getById(first.id);
    expect(row).toMatchObject({
      firstSeenAt: at(2),
      lastObservedAt: at(10),
      lastEventAt: at(10),
      // First non-null wins for the launch cwd and entrypoint.
      launchCwd: '/repo',
      entrypoint: 'cli',
      // Nulls never clear mutable fields.
      gitBranch: 'main',
      title: 'First title',
    });

    repos.sessions.upsert(
      sessionInput(k, { lastEventAt: null, gitBranch: 'feature', title: 'Renamed' }),
    );
    expect(repos.sessions.getById(first.id)).toMatchObject({
      lastEventAt: at(10),
      gitBranch: 'feature',
      title: 'Renamed',
    });
  });

  it('gives the same result regardless of arrival order', () => {
    const inputs = [
      { firstSeenAt: at(5), lastObservedAt: at(5), lastEventAt: at(5) },
      {
        firstSeenAt: at(1),
        lastObservedAt: at(9),
        lastEventAt: null,
        endedAt: at(7),
        endReason: 'exit',
      },
      { firstSeenAt: at(3), lastObservedAt: at(3), lastEventAt: at(8), lastAttentionAt: at(4) },
    ];
    const results = [inputs, [...inputs].reverse()].map((order) => {
      const { repos } = setupStore();
      for (const input of order) repos.sessions.upsert(sessionInput(key('s'), input));
      const { id: _id, ...rest } = repos.sessions.getByKey(key('s')) as SessionRow;
      return rest;
    });
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({
      firstSeenAt: at(1),
      lastObservedAt: at(9),
      lastEventAt: at(8),
      endedAt: at(7),
      endReason: 'exit',
      lastAttentionAt: at(4),
    });
  });

  it('keeps the end reason of the latest observed end', () => {
    const { repos } = setupStore();
    const k = key('s');
    repos.sessions.upsert(sessionInput(k, { endedAt: at(10), endReason: 'logout' }));
    repos.sessions.upsert(sessionInput(k, { endedAt: at(5), endReason: 'clear' }));
    expect(repos.sessions.getByKey(k)).toMatchObject({ endedAt: at(10), endReason: 'logout' });
    repos.sessions.upsert(sessionInput(k, { endedAt: at(20), endReason: 'other' }));
    expect(repos.sessions.getByKey(k)).toMatchObject({ endedAt: at(20), endReason: 'other' });
  });

  it('normalizes timestamps with offsets to UTC Z so ordering is correct', () => {
    const { repos } = setupStore();
    const k = key('s');
    // 08:30+05:30 is 03:00Z, earlier than T0 (08:00Z) even though it sorts later as text.
    repos.sessions.upsert(sessionInput(k, { firstSeenAt: '2026-10-10T08:30:00+05:30' }));
    expect(repos.sessions.getByKey(k)?.firstSeenAt).toBe('2026-10-10T03:00:00.000Z');
    expect(() => repos.sessions.upsert(sessionInput(k, { firstSeenAt: 'yesterday' }))).toThrow(
      DbError,
    );
  });

  it('first projectId wins on upsert; setProject reassigns explicitly', () => {
    const { repos } = setupStore();
    const p1 = repos.projects.insert({ name: 'one', rootPath: '/one' });
    const p2 = repos.projects.insert({ name: 'two', rootPath: '/two' });
    const s = repos.sessions.upsert(sessionInput(key('s'), { projectId: p1.id }));
    repos.sessions.upsert(sessionInput(key('s'), { projectId: p2.id }));
    expect(repos.sessions.getById(s.id)?.projectId).toBe(p1.id);
    expect(repos.sessions.setProject(s.id, p2.id)).toBe(true);
    expect(repos.sessions.getById(s.id)?.projectId).toBe(p2.id);
    expect(repos.sessions.setProject(s.id, null)).toBe(true);
    expect(repos.sessions.getById(s.id)?.projectId).toBeNull();
  });

  it('merges metadata with JSON merge-patch and round-trips it', () => {
    const { repos } = setupStore();
    const k = key('s');
    repos.sessions.upsert(sessionInput(k, { metadata: { a: 1, nested: { x: true } } }));
    repos.sessions.upsert(sessionInput(k, { metadata: { b: 'two', a: null } }));
    expect(repos.sessions.getByKey(k)?.metadata).toEqual({ nested: { x: true }, b: 'two' });
  });

  it('validates the key, origin, and stored values', () => {
    const { db, repos } = setupStore();
    expect(() => repos.sessions.upsert(sessionInput(key('')))).toThrow(DbError);
    expect(() =>
      repos.sessions.upsert({ ...sessionInput(key('s')), origin: 'guess' as 'external' }),
    ).toThrow(DbError);
    const s = repos.sessions.upsert(sessionInput(key('s')));
    db.connection.prepare("UPDATE sessions SET provider = 'mystery' WHERE id = ?").run(s.id);
    expect(() => repos.sessions.getById(s.id)).toThrow(StoredValueError);
  });

  it('getByIds returns known sessions only', () => {
    const { repos } = setupStore();
    const a = repos.sessions.upsert(sessionInput(key('a')));
    const b = repos.sessions.upsert(sessionInput(key('b')));
    expect(
      repos.sessions
        .getByIds([a.id, 'missing', b.id])
        .map((s) => s.id)
        .sort(),
    ).toEqual([a.id, b.id]);
    expect(repos.sessions.getByIds([])).toEqual([]);
  });
});
