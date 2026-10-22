// Synthetic data only: ids, branch names, URLs and texts are fake (G-A, ADR-0025, migration 0008).
import { branchStrategyPreset } from '@acp/core';
import { describe, expect, it } from 'vitest';
import { createReviewLoopRepositories } from '../../src/index.js';
import { thrown } from '../helpers.js';
import { setupInput, setupWorkspace, ticketWithRun } from '../workspace/setup.js';

const BASE = 'a'.repeat(40);
const TIP = 'b'.repeat(40);
const URL1 = 'https://github.com/acme/widgets/pull/12';

function setup() {
  const store = setupWorkspace();
  let n = 0;
  const loop = createReviewLoopRepositories(store.db, {
    now: () => new Date(Date.parse('2026-10-22T09:00:00.000Z') + n++ * 1000),
  });
  return { ...store, loop };
}

const stored = (db: ReturnType<typeof setupWorkspace>['db'], id: string) =>
  db.connection.prepare('SELECT branch_prefs FROM tickets WHERE id = ?').pluck().get(id) as
    string | null;

describe('ticket branch settings repository (ADR-0025 §4)', () => {
  it('creates a ticket with its own branch name, target and run options together', () => {
    const { db, ws, loop, projectId } = setup();
    const t = loop.ticketBranchPrefs.insert({
      projectId,
      title: 'Login crash',
      type: 'bug',
      runOptions: { approvalMode: 'manual' },
      branch: { name: 'fix/login-crash', target: 'develop' },
    });
    expect(t).toMatchObject({
      key: 'WEB-1',
      runOptions: { approvalMode: 'manual' },
      branch: { name: 'fix/login-crash', target: 'develop' },
    });
    expect(loop.ticketBranchPrefs.get(t.id)).toEqual({
      name: 'fix/login-crash',
      target: 'develop',
    });
    expect(JSON.parse(stored(db, t.id) ?? 'null')).toEqual(t.branch);
    expect(loop.ticketRunOptions.get(t.id)).toEqual({ approvalMode: 'manual' });
    // The Phase 4 repository never reads the column.
    expect(ws.tickets.getById(t.id)).not.toHaveProperty('branch');
    const plain = loop.ticketBranchPrefs.insert({ projectId, title: 'Plain' });
    expect(plain).not.toHaveProperty('branch');
    expect(stored(db, plain.id)).toBeNull();
    // `{}` is "follow the project" too and is stored as NULL.
    const empty = loop.ticketBranchPrefs.insert({ projectId, title: 'Empty', branch: {} });
    expect(stored(db, empty.id)).toBeNull();
    expect([...loop.ticketBranchPrefs.listForProject(projectId)]).toEqual([[t.id, t.branch]]);
  });

  it('replaces, clears with null or {}, bumps updatedAt, and adds or drops the field', () => {
    const { db, ws, loop, projectId } = setup();
    const t = loop.ticketBranchPrefs.insert({ projectId, title: 'T', branch: { target: 'main' } });
    const before = ws.tickets.getById(t.id)?.updatedAt;
    expect(loop.ticketBranchPrefs.set(t.id, { name: 'feature/x' })).toEqual({ name: 'feature/x' });
    expect(ws.tickets.getById(t.id)?.updatedAt).not.toBe(before);
    expect(loop.ticketBranchPrefs.set(t.id, null)).toBeUndefined();
    expect(stored(db, t.id)).toBeNull();
    loop.ticketBranchPrefs.set(t.id, { target: 'develop' });
    expect(loop.ticketBranchPrefs.set(t.id, {})).toBeUndefined();
    expect(stored(db, t.id)).toBeNull();
    const ticket = ws.tickets.getById(t.id);
    expect(ticket && loop.ticketBranchPrefs.withPrefs(ticket, { target: 'main' })).toMatchObject({
      branch: { target: 'main' },
    });
    expect(
      ticket && loop.ticketBranchPrefs.withPrefs({ ...ticket, branch: { name: 'x' } }),
    ).toEqual(ticket);
  });

  it('refuses unsafe names before the ticket number is taken, and unknown tickets', () => {
    const { ws, loop, projectId } = setup();
    for (const name of ['-D', 'a..b', 'HEAD', 'refs/heads/x', 'feature/x y', 'x.lock', '']) {
      expect(
        thrown(() => loop.ticketBranchPrefs.insert({ projectId, title: 'Bad', branch: { name } })),
        name,
      ).toMatchObject({ code: 'invalid_input' });
    }
    expect(
      thrown(() =>
        loop.ticketBranchPrefs.insert({ projectId, title: 'Bad', branch: { target: '../main' } }),
      ),
    ).toMatchObject({ code: 'invalid_input' });
    const t = loop.ticketBranchPrefs.insert({ projectId, title: 'Next' });
    expect(t.key).toBe('WEB-1');
    expect(thrown(() => loop.ticketBranchPrefs.set(t.id, { name: 'a b' }))).toMatchObject({
      code: 'invalid_input',
    });
    expect(thrown(() => loop.ticketBranchPrefs.set('missing', { name: 'x' }))).toMatchObject({
      code: 'not_found',
    });
    expect(ws.tickets.listForProject(projectId)).toHaveLength(1);
  });

  it('a failed insert stores nothing; a corrupt stored value is reported', () => {
    const { db, loop, projectId } = setup();
    expect(
      thrown(() =>
        loop.ticketBranchPrefs.insert({ projectId: 'missing', title: 'X', branch: { name: 'x' } }),
      ),
    ).toMatchObject({ code: 'not_found' });
    expect(db.connection.prepare('SELECT COUNT(*) FROM tickets').pluck().get()).toBe(0);
    const t = loop.ticketBranchPrefs.insert({ projectId, title: 'T' });
    db.connection
      .prepare('UPDATE tickets SET branch_prefs = ? WHERE id = ?')
      .run('{"name":"a b"}', t.id);
    expect(() => loop.ticketBranchPrefs.get(t.id)).toThrow(/branch_prefs/);
  });
});

describe("the ticket branch's pull request (ADR-0025 §4)", () => {
  function withBranch() {
    const s = setup();
    const { run } = ticketWithRun(s);
    const row = s.loop.ticketBranches.insert({
      runId: run.id,
      projectId: s.projectId,
      branch: 'feature/WEB-1-dark-mode',
      baseBranch: 'develop',
      baseCommit: BASE,
      headCommit: BASE,
    });
    return { ...s, run, row };
  }

  it('records the pull request, then each state the host reports, on any branch state', () => {
    const { loop, run, row } = withBranch();
    expect(row.pullRequest).toBeNull();
    const opened = loop.ticketBranches.setPullRequest(run.id, {
      provider: 'github',
      number: 12,
      url: URL1,
      state: 'open',
    });
    expect(opened?.pullRequest).toEqual({
      provider: 'github',
      number: 12,
      url: URL1,
      state: 'open',
      checkedAt: opened?.updatedAt,
    });
    expect(loop.ticketBranches.getByRun(run.id)).toEqual(opened);
    loop.ticketBranches.markMerged(run.id, TIP);
    const merged = loop.ticketBranches.setPullRequest(run.id, {
      provider: 'github',
      number: 12,
      url: URL1,
      state: 'merged',
      checkedAt: '2026-10-22T10:00:00+00:00',
    });
    expect(merged).toMatchObject({
      state: 'merged',
      mergedCommit: TIP,
      pullRequest: { state: 'merged', checkedAt: '2026-10-22T10:00:00.000Z' },
    });
    expect(
      loop.ticketBranches.setPullRequest('missing', {
        provider: 'github',
        number: 1,
        url: URL1,
        state: 'open',
      }),
    ).toBeUndefined();
  });

  it('refuses a bad provider, number, URL (or one with a user) and state', () => {
    const { loop, run } = withBranch();
    const good = { provider: 'github' as const, number: 12, url: URL1, state: 'open' as const };
    for (const bad of [
      { ...good, provider: 'gitlab' },
      { ...good, number: 0 },
      { ...good, number: 1.5 },
      { ...good, url: 'http://github.com/acme/widgets/pull/12' },
      { ...good, url: 'https://user:token@github.com/acme/widgets/pull/12' },
      { ...good, url: 'not a url' },
      { ...good, state: 'draft' },
    ]) {
      expect(
        // @ts-expect-error: invalid values are refused at the boundary as well.
        thrown(() => loop.ticketBranches.setPullRequest(run.id, bad)),
        JSON.stringify(bad),
      ).toMatchObject({ code: 'invalid_input' });
    }
    expect(loop.ticketBranches.getByRun(run.id)?.pullRequest).toBeNull();
  });

  it('a corrupt stored pull request is reported, not ignored', () => {
    const { db, loop, run } = withBranch();
    loop.ticketBranches.setPullRequest(run.id, {
      provider: 'github',
      number: 12,
      url: URL1,
      state: 'open',
    });
    db.connection
      .prepare("UPDATE ticket_branches SET pr_state = 'draft' WHERE run_id = ?")
      .run(run.id);
    expect(() => loop.ticketBranches.getByRun(run.id)).toThrow(/pr_state/);
  });
});

describe('the branching strategy in the project setup (ADR-0025 §3)', () => {
  it('round-trips through the setup JSON, and an older setup has none', () => {
    const store = setupWorkspace();
    const branching = branchStrategyPreset('git-flow');
    const saved = store.ws.projectSetup.upsert({ ...setupInput(store.projectId), branching });
    expect(saved.branching).toEqual(branching);
    expect(store.ws.projectSetup.get(store.projectId)?.branching).toEqual(branching);
    const without = store.ws.projectSetup.upsert(setupInput(store.projectId));
    expect(without).not.toHaveProperty('branching');
    expect(
      thrown(() =>
        store.ws.projectSetup.upsert({
          ...setupInput(store.projectId),
          branching: { ...branching, ticketBranchTemplate: 'feature/{slug}' },
        }),
      ),
    ).toMatchObject({ code: 'invalid_input' });
  });
});
