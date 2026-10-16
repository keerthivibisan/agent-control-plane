// Synthetic data only: ids, paths and texts are fake (R-G, migration 0004).
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checksumOf,
  createOrchestrationRepositories,
  createRedesignRepositories,
  createRepositories,
  createWorkspaceRepositories,
  DEFAULT_MIGRATIONS_DIR,
  loadMigrations,
  openDatabase,
} from '../../src/index.js';
import { tempDir } from '../helpers.js';
import { setupInput, setupWorkspace, ticketWithRun } from '../workspace/setup.js';

const SHIPPED = loadMigrations(DEFAULT_MIGRATIONS_DIR);
const OLD = ['0001_observability.sql', '0002_orchestration.sql', '0003_workspace.sql'];

function columns(db: ReturnType<typeof openDatabase>, table: string): string[] {
  return (db.connection.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name);
}

describe('migration 0004_redesign (R-G)', () => {
  it('ships as version 4 after untouched 0001-0003', () => {
    // 0005 (R-G Part 2) follows; the first four stay as shipped.
    expect(SHIPPED.slice(0, 4).map((m) => [m.version, m.name])).toEqual([
      [1, 'observability'],
      [2, 'orchestration'],
      [3, 'workspace'],
      [4, 'redesign'],
    ]);
    const sql = readFileSync(join(DEFAULT_MIGRATIONS_DIR, '0004_redesign.sql'), 'utf8');
    expect(SHIPPED[3]?.checksum).toBe(checksumOf(sql));
  });

  it('upgrades a 0003 database in place: data kept, new columns null, default workflow', () => {
    const dir = join(tempDir(), 'm');
    mkdirSync(dir);
    for (const file of OLD) copyFileSync(join(DEFAULT_MIGRATIONS_DIR, file), join(dir, file));
    const path = join(tempDir(), 'upgrade.sqlite');

    const v3 = openDatabase(path, { migrationsDir: dir });
    const store = {
      db: v3,
      repos: createRepositories(v3),
      orch: createOrchestrationRepositories(v3),
      ws: createWorkspaceRepositories(v3),
      projectId: '',
    };
    const project = store.repos.projects.insert({ name: 'keep', rootPath: '/home/user/keep' });
    store.projectId = project.id;
    store.ws.projectSetup.upsert(setupInput(project.id, 'KEEP'));
    const { ticket, run, lead } = ticketWithRun(store);
    const approval = store.orch.approvals.insert({
      runId: run.id,
      agentRunId: lead.id,
      kind: 'tool-use',
      toolName: 'Edit',
      summary: 'Edit src/app.ts',
    });
    store.orch.approvals.decide(approval.id, 'approved');
    store.ws.comments.insert({ ticketId: ticket.id, author: 'owner', body: 'Before 0004' });
    const v3Checksums = v3.connection
      .prepare('SELECT version, checksum FROM schema_migrations ORDER BY version')
      .all();
    expect(columns(v3, 'approvals')).not.toContain('decided_by');
    v3.close();

    const v4 = openDatabase(path);
    try {
      const recorded = v4.connection
        .prepare('SELECT version, checksum FROM schema_migrations ORDER BY version')
        .all() as { version: number; checksum: string }[];
      expect(recorded.map((r) => r.version).slice(0, 4)).toEqual([1, 2, 3, 4]);
      // The 0001-0003 rows are unchanged, so their files were not edited.
      expect(recorded.slice(0, 3)).toEqual(v3Checksums);
      expect(v4.connection.pragma('foreign_key_check')).toEqual([]);
      expect(columns(v4, 'agent_runs')).toContain('stage');
      expect(columns(v4, 'approvals')).toContain('decided_by');
      expect(columns(v4, 'orchestration_runs')).toContain('limits');

      // Old rows are kept and read back; the new columns are null for them.
      const orch = createOrchestrationRepositories(v4);
      expect(orch.approvals.getById(approval.id)).toMatchObject({ status: 'approved' });
      const audit = createRedesignRepositories(v4).runAudit;
      expect(audit.approvalDecidersForRun(run.id).get(approval.id)).toBeNull();
      expect(audit.getRunSnapshot(run.id)).toBeNull();
      expect([...audit.agentStagesForRun(run.id).values()]).toEqual([null, null]);
      expect(createWorkspaceRepositories(v4).comments.listForTicket(ticket.id)).toHaveLength(1);

      // A project with no saved workflow gets the default (the Phase 4 flow).
      const workflow = createRedesignRepositories(v4).workflow;
      expect(workflow.isStored(project.id)).toBe(false);
      expect(workflow.get(project.id)).toMatchObject({
        projectId: project.id,
        plannerMode: 'lead',
        updatedAt: project.createdAt,
      });

      // The upgraded database takes the 0004 writes, including reviewer comments.
      audit.setApprovalDecidedBy(approval.id, 'owner');
      audit.setRunSnapshot(run.id, { maxConcurrentHelpers: 2, maxDepth: 1 });
      audit.setAgentStage(lead.id, 'orchestrate');
      expect(audit.approvalDecidersForRun(run.id).get(approval.id)).toBe('owner');
      const reviewer = createWorkspaceRepositories(v4).comments.insert({
        ticketId: ticket.id,
        runId: run.id,
        author: 'reviewer',
        body: 'Synthetic finding',
      });
      expect(reviewer.author).toBe('reviewer');
    } finally {
      v4.close();
    }
  });

  it('adds a STRICT project_workflow table with no free-text columns', () => {
    const { db } = setupWorkspace();
    const sql = db.connection
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'project_workflow'")
      .pluck()
      .get() as string;
    expect(sql).toMatch(/\)\s*STRICT$/);
    expect(columns(db, 'project_workflow')).toEqual(['project_id', 'workflow', 'updated_at']);
  });

  it('rejects malformed JSON in the workflow and limits columns', () => {
    const store = setupWorkspace();
    const { db, projectId } = store;
    const at = '2026-10-16T08:00:00.000Z';
    const insert = db.connection.prepare(
      'INSERT INTO project_workflow (project_id, workflow, updated_at) VALUES (?, ?, ?)',
    );
    expect(() => insert.run(projectId, 'not json', at)).toThrow(/CHECK/);
    expect(() => insert.run(projectId, '[]', at)).toThrow(/CHECK/);
    const { run } = ticketWithRun(store);
    const setLimits = db.connection.prepare(
      'UPDATE orchestration_runs SET limits = ? WHERE id = ?',
    );
    expect(() => setLimits.run('[1]', run.id)).toThrow(/CHECK/);
    expect(() => setLimits.run('{', run.id)).toThrow(/CHECK/);
  });

  it('deletes a project workflow with its project', () => {
    const { db, repos, projectId } = setupWorkspace({ withSetup: false });
    const workflow = createRedesignRepositories(db).workflow;
    const saved = workflow.get(projectId);
    if (saved === undefined) throw new Error('project exists');
    workflow.put({ projectId, plannerMode: 'separate', stages: saved.stages });
    expect(repos.projects.remove(projectId)).toBe(true);
    expect(db.connection.prepare('SELECT COUNT(*) FROM project_workflow').pluck().get()).toBe(0);
  });
});
