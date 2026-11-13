// Synthetic data only: ids, paths, SHAs and texts are fake (ADR-0036, RM-1).
import { defaultProjectWorkflow } from '@acp/core';
import { describe, expect, it } from 'vitest';
import { createCodeMapRepositories, createRedesignRepositories } from '../../src/index.js';
import { usageEvent } from '../fixtures.js';
import { count, setupInput, setupWorkspace, STEPS, type WorkspaceStore } from './setup.js';

const sha = (c: string) => c.repeat(64);
const COUNTS = {
  files: 1,
  indexed: 1,
  skipped: { 'too-large': 0, binary: 0, generated: 0, 'file-cap': 0 },
  symbols: 0,
  imports: 0,
  unresolved: 0,
};

/** ACP's own records for a project: every one of them goes with the project. */
const HISTORY_TABLES = [
  'tickets',
  'orchestration_runs',
  'agent_runs',
  'agent_run_sessions',
  'approvals',
  'artifacts',
  'managed_workspaces',
  'ticket_plans',
  'ticket_comments',
  'ticket_attachments',
  'check_runs',
  'project_setup',
  'project_workflow',
  'code_map_manifests',
  'code_map_blobs',
  'code_map_entries',
];
/** Observed data: kept (ADR-0036 §3). */
const KEPT_TABLES = ['sessions', 'events', 'usage_records'];

/** A project with a ticket, a run with agents, and a row in every history table. */
function populate(store: WorkspaceStore, projectId: string, tag: string, attachmentSha: string) {
  const { ws, orch, repos, db } = store;
  if (!ws.projectSetup.get(projectId)) {
    ws.projectSetup.upsert(setupInput(projectId, tag.toUpperCase().slice(0, 4)));
  }
  createRedesignRepositories(db).workflow.put({
    ...defaultProjectWorkflow(projectId, '2026-10-13T12:00:00.000Z'),
    plannerMode: 'separate',
  });
  const ticket = ws.tickets.insert({ projectId, title: `Ticket ${tag}` });
  const run = orch.runs.insert({
    projectId,
    ticketId: ticket.id,
    title: `Run ${tag}`,
    budget: { maxTokensPerAgent: 500_000, softCostUsdPerRun: null },
    status: 'COMPLETED',
  });
  ws.tickets.setStatus(ticket.id, 'ACTIVE', { currentRunId: run.id });
  const lead = orch.agentRuns.insert({
    runId: run.id,
    kind: 'lead',
    parentAgentRunId: null,
    role: 'Lead',
    task: null,
  });
  const worker = orch.agentRuns.insert({
    runId: run.id,
    kind: 'worker',
    parentAgentRunId: lead.id,
    role: 'Frontend',
    task: 'Synthetic task',
  });
  orch.workspaces.insert({
    runId: run.id,
    agentRunId: worker.id,
    worktreePath: `/data/worktrees/${run.id}/${worker.id}`,
    branch: `acp/${run.id}/${worker.id}`,
    baseBranch: 'main',
    baseCommit: null,
  });
  orch.artifacts.insert({
    runId: run.id,
    agentRunId: worker.id,
    kind: 'patch',
    storagePath: `artifacts/${run.id}/${worker.id}/patch.diff`,
    sha256: sha('a'),
    sizeBytes: 10,
  });
  orch.approvals.insert({
    runId: run.id,
    agentRunId: worker.id,
    kind: 'tool-use',
    toolName: 'Bash',
    summary: 'Synthetic approval',
  });
  const plan = ws.plans.insert({
    ticketId: ticket.id,
    runId: run.id,
    summary: 'Synthetic plan',
    steps: STEPS,
  });
  const comment = ws.comments.insert({
    ticketId: ticket.id,
    planId: plan.id,
    author: 'owner',
    body: 'Synthetic',
  });
  ws.attachments.insert({
    ticketId: ticket.id,
    commentId: comment.id,
    name: 'notes.txt',
    mimeType: 'text/plain',
    sizeBytes: 4,
    sha256: attachmentSha,
  });
  ws.checkRuns.insert({
    projectId,
    runId: null,
    agentRunId: null,
    checkId: 'test',
    name: 'Unit tests',
    required: true,
    status: 'passed',
    exitCode: 0,
    durationMs: 10,
    outputTail: 'ok',
    startedAt: '2026-10-13T12:00:00.000Z',
  });
  const codeMap = createCodeMapRepositories(db).codeMap;
  codeMap.putBlobs(projectId, [
    {
      blobSha: '2'.repeat(40),
      blob: {
        language: 'typescript',
        sizeBytes: 1,
        lineCount: 1,
        symbols: [],
        imports: [],
        skipped: null,
      },
    },
  ]);
  codeMap.insertManifest({
    projectId,
    commit: '1'.repeat(40),
    builtAt: '2026-10-13T12:00:00.000Z',
    indexerVersion: 1,
    counts: COUNTS,
    entries: [
      {
        path: 'src/a.ts',
        blobSha: '2'.repeat(40),
        sizeBytes: 1,
        data: { resolved: [], skipped: null },
      },
    ],
  });

  // An observed session of the project, used by the run, with an event and a usage record.
  const key = {
    provider: 'claude-code' as const,
    providerSessionId: `sess-${tag}`,
    providerAgentId: null,
  };
  const sessionId = repos.sessions.upsert({
    key,
    origin: 'managed',
    projectId,
    firstSeenAt: '2026-10-13T12:00:00.000Z',
    lastObservedAt: '2026-10-13T12:00:00.000Z',
  }).id;
  orch.agentRunSessions.link({
    agentRunId: lead.id,
    provider: 'claude-code',
    providerSessionId: `sess-${tag}`,
    relation: 'primary',
  });
  const event = repos.events.insertIfNew({
    event: usageEvent(`dedup-${tag}`, key, `msg-${tag}`, {
      input: 1,
      output: 2,
      cacheCreation: null,
      cacheRead: null,
    }),
    sessionId,
    projectId,
  });
  repos.usage.upsertRecord({
    provider: 'claude-code',
    messageId: `msg-${tag}`,
    sessionId,
    selectedEventId: event.id,
    occurredAt: '2026-10-13T12:00:00.000Z',
    requestId: null,
    model: null,
    tokens: { input: 1, output: 2, cacheCreation: null, cacheRead: null },
    observationCount: 1,
    conflict: false,
    attributionAmbiguous: false,
  });
  return { ticket, run, worker, sessionId };
}

function counts(store: WorkspaceStore, tables: string[]) {
  return Object.fromEntries(tables.map((t) => [t, count(store.db, t)]));
}

describe('project removal with history (ADR-0036, RM-1)', () => {
  it('deletes every ACP record of the project and keeps sessions, events and usage', () => {
    const store = setupWorkspace();
    const other = store.repos.projects.insert({ name: 'api', rootPath: '/home/user/api' }).id;
    const a = populate(store, store.projectId, 'web', sha('b'));
    const b = populate(store, other, 'api', sha('c'));
    const before = counts(store, [...HISTORY_TABLES, ...KEPT_TABLES]);
    for (const table of HISTORY_TABLES) expect(before[table], table).toBeGreaterThan(0);

    expect(store.repos.projects.historyCounts(store.projectId)).toEqual({
      tickets: 1,
      runs: 1,
      attachments: 1,
    });
    const removal = store.repos.projects.removeWithHistory(store.projectId);
    expect(removal).toEqual({
      runIds: [a.run.id],
      workspacePaths: [`/data/worktrees/${a.run.id}/${a.worker.id}`],
      artifactPaths: [`artifacts/${a.run.id}/${a.worker.id}/patch.diff`],
      attachmentSha256s: [sha('b')],
    });

    expect(store.repos.projects.getById(store.projectId)).toBeUndefined();
    const after = counts(store, [...HISTORY_TABLES, ...KEPT_TABLES]);
    // Both projects had the same shape, so exactly half of every history table is left: the
    // other project's rows.
    for (const table of HISTORY_TABLES) expect(after[table], table).toBe(before[table]! / 2);
    for (const table of KEPT_TABLES) expect(after[table], table).toBe(before[table]);
    expect(store.repos.projects.historyCounts(other)).toEqual({
      tickets: 1,
      runs: 1,
      attachments: 1,
    });
    expect(store.orch.runs.getById(b.run.id)).toBeDefined();
    expect(store.ws.tickets.getById(b.ticket.id)).toBeDefined();

    // The observed session stays, detached; so do its events.
    expect(store.repos.sessions.getById(a.sessionId)?.projectId).toBeNull();
    expect(store.repos.sessions.getById(b.sessionId)?.projectId).toBe(other);
    const orphanEvents = store.db.connection
      .prepare('SELECT COUNT(*) FROM events WHERE session_id = ? AND project_id IS NULL')
      .pluck()
      .get(a.sessionId);
    expect(orphanEvents).toBe(1);
  });

  it('removes a project without history, and answers undefined for an unknown one', () => {
    const store = setupWorkspace();
    expect(store.repos.projects.removeWithHistory(store.projectId)).toEqual({
      runIds: [],
      workspacePaths: [],
      artifactPaths: [],
      attachmentSha256s: [],
    });
    expect(count(store.db, 'projects')).toBe(0);
    expect(count(store.db, 'project_setup')).toBe(0);
    expect(store.repos.projects.removeWithHistory('missing')).toBeUndefined();
  });

  it('rolls back everything when a delete fails part-way', () => {
    const store = setupWorkspace();
    populate(store, store.projectId, 'web', sha('b'));
    const before = counts(store, HISTORY_TABLES);
    // A trigger that fails the final delete proves the earlier deletes are rolled back with it.
    store.db.connection.exec(
      `CREATE TRIGGER fail_project_delete BEFORE DELETE ON projects
       BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END`,
    );
    expect(() => store.repos.projects.removeWithHistory(store.projectId)).toThrow(/synthetic/);
    expect(counts(store, HISTORY_TABLES)).toEqual(before);
    expect(store.repos.projects.getById(store.projectId)).toBeDefined();
  });
});
