// Synthetic data only: ids, paths, commits and texts are fake (RL-0, migration 0006, ADR-0021).
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checksumOf,
  createOrchestrationRepositories,
  createRepositories,
  createWorkspaceRepositories,
  DEFAULT_MIGRATIONS_DIR,
  loadMigrations,
  openDatabase,
  type AcpDatabase,
} from '../../src/index.js';
import { tempDir } from '../helpers.js';
import {
  setupInput,
  setupWorkspace,
  ticketWithRun,
  type WorkspaceStore,
} from '../workspace/setup.js';

const SHIPPED = loadMigrations(DEFAULT_MIGRATIONS_DIR);
const BEFORE = [
  '0001_observability.sql',
  '0002_orchestration.sql',
  '0003_workspace.sql',
  '0004_redesign.sql',
  '0005_stage_agents.sql',
];
const AT = '2026-10-17T09:00:00.000Z';
const BASE = 'a'.repeat(40);
const TIP = 'b'.repeat(40);

function columns(db: AcpDatabase, table: string): string[] {
  return (db.connection.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name);
}

function insertBranch(
  db: AcpDatabase,
  row: { runId: string; projectId: string } & Partial<Record<string, string | null>>,
) {
  db.connection
    .prepare(
      `INSERT INTO ticket_branches (run_id, project_id, branch, base_branch, base_commit,
         head_commit, state, merged_commit, created_at, updated_at)
       VALUES (@runId, @projectId, @branch, @baseBranch, @baseCommit, @headCommit, @state,
         @mergedCommit, @at, @at)`,
    )
    .run({
      branch: 'acp/WEB-1',
      baseBranch: 'main',
      baseCommit: BASE,
      headCommit: TIP,
      state: 'open',
      mergedCommit: null,
      at: AT,
      ...row,
    });
}

function insertReview(
  db: AcpDatabase,
  row: { id: string; runId: string; agentRunId: string } & Partial<
    Record<string, string | number | null>
  >,
) {
  db.connection
    .prepare(
      `INSERT INTO change_reviews (id, run_id, agent_run_id, round, reviewer,
         reviewer_agent_run_id, verdict, decision, decided_by, comment_id, created_at, decided_at)
       VALUES (@id, @runId, @agentRunId, @round, @reviewer, @reviewerAgentRunId, @verdict,
         @decision, @decidedBy, @commentId, @at, @decidedAt)`,
    )
    .run({
      round: 0,
      reviewer: 'agent',
      reviewerAgentRunId: null,
      verdict: null,
      decision: null,
      decidedBy: null,
      commentId: null,
      decidedAt: null,
      at: AT,
      ...row,
    });
}

/** A ticket run with a lead, a helper with a worktree, and a change reviewer. */
function loopRun(store: WorkspaceStore) {
  const { ticket, run, lead, helper } = ticketWithRun(store);
  const reviewer = store.orch.agentRuns.insert({
    runId: run.id,
    kind: 'reviewer',
    parentAgentRunId: null,
    role: 'Change reviewer',
    task: null,
  });
  const workspace = store.orch.workspaces.insert({
    runId: run.id,
    agentRunId: helper.id,
    worktreePath: `/data/worktrees/${run.id}/${helper.id}`,
    branch: `acp/${run.id}/${helper.id}`,
    baseBranch: 'acp/WEB-1',
    baseCommit: BASE,
  });
  return { ticket, run, lead, helper, reviewer, workspace };
}

const count = (db: AcpDatabase, table: string) =>
  db.connection.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get() as number;

describe('migration 0006_review_loop (RL-0, ADR-0021)', () => {
  it('ships as version 6 after untouched 0001-0005', () => {
    // 0007 (RL-H) and 0008 (ADR-0025) follow; the first six stay as shipped.
    expect(SHIPPED.slice(0, 6).map((m) => [m.version, m.name])).toEqual([
      [1, 'observability'],
      [2, 'orchestration'],
      [3, 'workspace'],
      [4, 'redesign'],
      [5, 'stage_agents'],
      [6, 'review_loop'],
    ]);
    const sql = readFileSync(join(DEFAULT_MIGRATIONS_DIR, '0006_review_loop.sql'), 'utf8');
    expect(SHIPPED[5]?.checksum).toBe(checksumOf(sql));
  });

  it('adds STRICT ticket_branches and change_reviews with no free-text columns', () => {
    const { db } = setupWorkspace();
    for (const table of ['ticket_branches', 'change_reviews']) {
      const sql = db.connection
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
        .pluck()
        .get(table) as string;
      expect(sql, table).toMatch(/\)\s*STRICT$/);
    }
    // 0008 (ADR-0025) rebuilt the table with the same columns first, then the pull request's.
    expect(columns(db, 'ticket_branches').slice(0, 10)).toEqual([
      'run_id',
      'project_id',
      'branch',
      'base_branch',
      'base_commit',
      'head_commit',
      'state',
      'merged_commit',
      'created_at',
      'updated_at',
    ]);
    expect(columns(db, 'change_reviews')).toEqual([
      'id',
      'run_id',
      'agent_run_id',
      'round',
      'reviewer',
      'reviewer_agent_run_id',
      'verdict',
      'decision',
      'decided_by',
      'comment_id',
      'created_at',
      'decided_at',
    ]);
    expect(columns(db, 'managed_workspaces')).toEqual(
      expect.arrayContaining(['change_state', 'rework_rounds', 'head_commit']),
    );
    expect(columns(db, 'check_runs')).toContain('commit_sha');
    expect(columns(db, 'approvals')).toContain('allow_rule');
  });

  it('keeps one open ticket branch per name and checks commits, names and the merged state', () => {
    const store = setupWorkspace();
    const { db, projectId } = store;
    const first = ticketWithRun(store, 'First').run;
    const second = ticketWithRun(store, 'Second').run;
    insertBranch(db, { runId: first.id, projectId });
    expect(() => insertBranch(db, { runId: second.id, projectId })).toThrow(/UNIQUE/);
    // Once the first is merged, the name is free again (a re-run of the ticket).
    db.connection
      .prepare("UPDATE ticket_branches SET state = 'merged', merged_commit = ? WHERE run_id = ?")
      .run(TIP, first.id);
    insertBranch(db, { runId: second.id, projectId });
    expect(count(db, 'ticket_branches')).toBe(2);

    const third = ticketWithRun(store, 'Third').run;
    const bad = (row: Record<string, string | null>) =>
      insertBranch(db, { runId: third.id, projectId, branch: 'acp/WEB-3', ...row });
    // 0008 (ADR-0025) dropped the `acp/*` name check: names are checked in Zod, and the server's
    // guard refuses long-lived branches (migration-0008.test.ts covers the length check left).
    expect(() => bad({ baseCommit: 'HEAD' })).toThrow(/CHECK/);
    expect(() => bad({ headCommit: 'ABCDEF1' })).toThrow(/CHECK/);
    expect(() => bad({ headCommit: 'abc12' })).toThrow(/CHECK/);
    expect(() => bad({ state: 'merged' })).toThrow(/CHECK/);
    expect(() => bad({ mergedCommit: TIP })).toThrow(/CHECK/);
    expect(() => bad({ baseBranch: '' })).toThrow(/CHECK/);
    bad({});
  });

  it("ties a ticket branch to its run's project and deletes it with the run", () => {
    const store = setupWorkspace();
    const { db, repos, ws } = store;
    const { run } = ticketWithRun(store);
    const other = repos.projects.insert({ name: 'other', rootPath: '/home/user/other' }).id;
    ws.projectSetup.upsert(setupInput(other, 'OTH'));
    expect(() => insertBranch(db, { runId: run.id, projectId: other })).toThrow(/FOREIGN KEY/);
    expect(() => insertBranch(db, { runId: 'missing', projectId: store.projectId })).toThrow(
      /FOREIGN KEY/,
    );
    insertBranch(db, { runId: run.id, projectId: store.projectId });
    db.connection.prepare('DELETE FROM orchestration_runs WHERE id = ?').run(run.id);
    expect(count(db, 'ticket_branches')).toBe(0);
  });

  it('records review rounds of a change inside its run, decided all at once', () => {
    const store = setupWorkspace();
    const { db } = store;
    const { ticket, run, helper, reviewer, lead } = loopRun(store);
    const comment = store.ws.comments.insert({
      ticketId: ticket.id,
      runId: run.id,
      author: 'reviewer',
      body: 'Synthetic finding',
    });
    insertReview(db, {
      id: 'cr-0',
      runId: run.id,
      agentRunId: helper.id,
      reviewerAgentRunId: reviewer.id,
      verdict: 'rework',
      decision: 'rework',
      decidedBy: 'lead',
      commentId: comment.id,
      decidedAt: AT,
    });
    insertReview(db, { id: 'cr-1', runId: run.id, agentRunId: helper.id, round: 1 });
    expect(count(db, 'change_reviews')).toBe(2);

    const bad = (row: Record<string, string | number | null>) =>
      insertReview(db, { id: 'cr-x', runId: run.id, agentRunId: helper.id, ...row });
    expect(() => bad({ round: -1 })).toThrow(/CHECK/);
    expect(() => bad({ reviewer: '' })).toThrow(/CHECK/);
    expect(() => bad({ decision: 'merge' })).toThrow(/CHECK/);
    expect(() => bad({ decision: 'merge', decidedBy: 'lead' })).toThrow(/CHECK/);
    expect(() => bad({ decidedAt: AT })).toThrow(/CHECK/);
    expect(() => bad({ reviewerAgentRunId: helper.id })).toThrow(/CHECK/);
    expect(() => bad({ agentRunId: 'missing' })).toThrow(/FOREIGN KEY/);
    expect(() => bad({ reviewerAgentRunId: 'missing' })).toThrow(/FOREIGN KEY/);
    expect(() => bad({ commentId: 'missing' })).toThrow(/FOREIGN KEY/);
    // An agent of another run is refused too.
    const otherRun = ticketWithRun(store, 'Other').run;
    expect(() => bad({ runId: otherRun.id })).toThrow(/FOREIGN KEY/);
    bad({ reviewer: 'owner', decision: 'merge', decidedBy: 'owner', decidedAt: AT });
    bad({ id: 'cr-y', reviewer: 'lead', reviewerAgentRunId: null, agentRunId: lead.id });

    // A deleted comment leaves the review; deleting the run deletes the reviews.
    db.connection.prepare('DELETE FROM ticket_comments WHERE id = ?').run(comment.id);
    expect(
      db.connection
        .prepare("SELECT comment_id FROM change_reviews WHERE id = 'cr-0'")
        .pluck()
        .get(),
    ).toBeNull();
    db.connection.prepare('DELETE FROM orchestration_runs WHERE id = ?').run(run.id);
    expect(
      db.connection
        .prepare('SELECT COUNT(*) FROM change_reviews WHERE run_id = ?')
        .pluck()
        .get(run.id),
    ).toBe(0);
  });

  it('checks the new workspace, check-run and approval columns', () => {
    const store = setupWorkspace();
    const { db } = store;
    const { run, helper, workspace } = loopRun(store);
    const row = db.connection
      .prepare(
        'SELECT change_state, rework_rounds, head_commit FROM managed_workspaces WHERE id = ?',
      )
      .get(workspace.id);
    expect(row).toEqual({ change_state: null, rework_rounds: 0, head_commit: null });
    const setWs = (sql: string, ...args: (string | number | null)[]) =>
      db.connection
        .prepare(`UPDATE managed_workspaces SET ${sql} WHERE id = ?`)
        .run(...args, workspace.id);
    setWs('change_state = ?, rework_rounds = ?, head_commit = ?', 'decision', 2, TIP);
    expect(() => setWs('rework_rounds = ?', -1)).toThrow(/CHECK/);
    expect(() => setWs('head_commit = ?', 'not-a-commit')).toThrow(/CHECK/);
    expect(() => setWs('change_state = ?', '')).toThrow(/CHECK/);
    expect(() => setWs('rework_rounds = ?', null)).toThrow(/NOT NULL/);

    const check = store.ws.checkRuns.insert({
      runId: run.id,
      agentRunId: helper.id,
      projectId: store.projectId,
      checkId: 'test',
      name: 'Unit tests',
      required: true,
      status: 'passed',
      exitCode: 0,
      durationMs: 10,
      outputTail: '',
      startedAt: AT,
    });
    const setCommit = (sha: string | null) =>
      db.connection.prepare('UPDATE check_runs SET commit_sha = ? WHERE id = ?').run(sha, check.id);
    setCommit(TIP);
    setCommit(null);
    expect(() => setCommit('main')).toThrow(/CHECK/);

    const approval = store.orch.approvals.insert({
      runId: run.id,
      agentRunId: helper.id,
      kind: 'tool-use',
      toolName: 'Bash',
      summary: 'Bash npm test',
    });
    const setRule = (rule: string | null) =>
      db.connection
        .prepare('UPDATE approvals SET allow_rule = ? WHERE id = ?')
        .run(rule, approval.id);
    setRule('command-allowlist');
    expect(() => setRule('')).toThrow(/CHECK/);
    expect(() => setRule('x'.repeat(41))).toThrow(/CHECK/);
  });

  it('upgrades a 0005 database in place: data kept, new columns empty', () => {
    const dir = join(tempDir(), 'm');
    mkdirSync(dir);
    for (const file of BEFORE) copyFileSync(join(DEFAULT_MIGRATIONS_DIR, file), join(dir, file));
    const path = join(tempDir(), 'upgrade.sqlite');

    const v5 = openDatabase(path, { migrationsDir: dir });
    const store: WorkspaceStore = {
      db: v5,
      repos: createRepositories(v5),
      orch: createOrchestrationRepositories(v5),
      ws: createWorkspaceRepositories(v5),
      projectId: '',
    };
    store.projectId = store.repos.projects.insert({ name: 'keep', rootPath: '/home/user/k' }).id;
    store.ws.projectSetup.upsert(setupInput(store.projectId, 'KEEP'));
    const { ticket, run, helper, workspace } = loopRun(store);
    store.orch.workspaces.setReview(workspace.id, { reviewState: 'pending', changedFiles: 2 });
    const check = store.ws.checkRuns.insert({
      runId: run.id,
      agentRunId: helper.id,
      projectId: store.projectId,
      checkId: 'test',
      name: 'Unit tests',
      required: true,
      status: 'failed',
      exitCode: 1,
      durationMs: 10,
      outputTail: 'Synthetic output',
      startedAt: AT,
    });
    const approval = store.orch.approvals.insert({
      runId: run.id,
      agentRunId: helper.id,
      kind: 'tool-use',
      toolName: 'Edit',
      summary: 'Edit src/app.ts',
    });
    store.orch.approvals.decide(approval.id, 'approved');
    store.ws.comments.insert({ ticketId: ticket.id, author: 'owner', body: 'Before 0006' });
    const before = v5.connection
      .prepare('SELECT version, checksum FROM schema_migrations ORDER BY version')
      .all();
    expect(columns(v5, 'approvals')).not.toContain('allow_rule');
    v5.close();

    const v6 = openDatabase(path);
    try {
      const recorded = v6.connection
        .prepare('SELECT version, checksum FROM schema_migrations ORDER BY version')
        .all() as { version: number; checksum: string }[];
      expect(recorded.map((r) => r.version).slice(0, 6)).toEqual([1, 2, 3, 4, 5, 6]);
      // The 0001-0005 rows are unchanged, so their files were not edited.
      expect(recorded.slice(0, 5)).toEqual(before);
      expect(v6.connection.pragma('foreign_key_check')).toEqual([]);

      // Old rows are kept and read back through the repositories as before.
      const orch = createOrchestrationRepositories(v6);
      const ws = createWorkspaceRepositories(v6);
      expect(orch.workspaces.getById(workspace.id)).toMatchObject({
        reviewState: 'pending',
        changedFiles: 2,
      });
      expect(ws.checkRuns.getById(check.id)).toMatchObject({ status: 'failed' });
      expect(ws.checkRuns.getById(check.id)?.commit).toBeUndefined();
      expect(orch.approvals.getById(approval.id)).toMatchObject({ status: 'approved' });
      expect(ws.comments.listForTicket(ticket.id)).toHaveLength(1);
      expect(orch.agentRuns.listForRun(run.id)).toHaveLength(3);

      // The new columns are empty for them: no run before 0006 has the review loop.
      expect(
        v6.connection
          .prepare(
            'SELECT change_state, rework_rounds, head_commit FROM managed_workspaces WHERE id = ?',
          )
          .get(workspace.id),
      ).toEqual({ change_state: null, rework_rounds: 0, head_commit: null });
      expect(
        v6.connection
          .prepare('SELECT commit_sha FROM check_runs WHERE id = ?')
          .pluck()
          .get(check.id),
      ).toBeNull();
      expect(
        v6.connection
          .prepare('SELECT allow_rule FROM approvals WHERE id = ?')
          .pluck()
          .get(approval.id),
      ).toBeNull();
      expect(count(v6, 'ticket_branches')).toBe(0);
      expect(count(v6, 'change_reviews')).toBe(0);

      // The upgraded database takes the 0006 writes.
      insertBranch(v6, { runId: run.id, projectId: store.projectId, branch: 'acp/KEEP-1' });
      insertReview(v6, { id: 'cr-0', runId: run.id, agentRunId: helper.id });
      expect(count(v6, 'ticket_branches')).toBe(1);
      expect(count(v6, 'change_reviews')).toBe(1);
    } finally {
      v6.close();
    }
  });
});
