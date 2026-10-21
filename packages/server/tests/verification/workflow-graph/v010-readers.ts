import { z } from 'zod';
import {
  ChangeReviewerModeSchema,
  PlanStepSchema,
  ProjectAgentSetupSchema,
  ProjectApprovalsSchema,
  ProjectWorkflowSchema,
  ReworkRoundsSchema,
  TicketBranchNameSchema,
  WorkflowStageIdSchema,
} from '@acp/core';
import {
  MAX_PAGE_SIZE,
  createOrchestrationRepositories,
  createRedesignRepositories,
  createRepositories,
  createReviewLoopRepositories,
  createWorkspaceRepositories,
  openDatabase,
} from '@acp/db';

/*
 * What v0.1.0 (`main` b6a1f27) can still read, frozen (WG-V, RESUME.md Step 4b items 3 and 5).
 * Vitest-free: the data-copy check uses it on the owner's copy too. Output is counts only.
 *
 * Which readers changed after v0.1.0 (derived on 2026-10-20 with
 * `git diff b6a1f27 -- packages/db/src packages/core/src`):
 *
 * - db: only `repositories/redesign/run-audit.ts` (the run snapshot gains `graph` and
 *   `graphContext`; `agent_runs.stage` accepts any node id) and `redesign/workflow.ts`
 *   (`project_workflow.workflow` may hold `{version: 2, graph}`). Every other repository is
 *   byte-identical to v0.1.0, so the current code reading a row IS the v0.1.0 read.
 * - core: the only non-additive schema changes a stored column uses are `ChangeDeciderSchema`
 *   (gains `reviewer`, `change_reviews.decided_by`) and `PlanStepSchema` (gains an optional
 *   `helper`, `ticket_plans.steps`). The other schemas below are unchanged since v0.1.0.
 *
 * So the v0.1.0 readers of exactly those five columns are frozen here (the snapshot parser copied
 * verbatim from b6a1f27), and the rest is read with today's repositories. A row v0.1.0 cannot
 * read makes its pages fail there (`StoredValueError`): the board's plans, a run's load.
 */

const fail = (message: string) => ({ success: false as const, error: new Error(message) });

/** v0.1.0 `StoredRunLimitsSchema`: strict, so any key v0.1.0 does not know fails the snapshot. */
const V010StoredRunLimitsSchema = ProjectAgentSetupSchema.pick({
  maxConcurrentHelpers: true,
  maxDepth: true,
}).strict();

function v010ParseIntegration(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { reviewer, maxReworkRounds, handedOver, ticketKey, ticketBranch, ...extra } =
    value as Record<string, unknown>;
  if (Object.keys(extra).length > 0) return false;
  const r = ChangeReviewerModeSchema.safeParse(reviewer);
  const m = ReworkRoundsSchema.safeParse(maxReworkRounds);
  if (!r.success || !m.success || typeof handedOver !== 'boolean') return false;
  if (
    typeof ticketKey !== 'string' ||
    !TicketBranchNameSchema.safeParse(`acp/${ticketKey}`).success
  ) {
    return false;
  }
  const branch = ticketBranch === null ? null : TicketBranchNameSchema.safeParse(ticketBranch);
  return branch === null || branch.success;
}

/** v0.1.0 `StoredRunSnapshotParser` (b6a1f27 `run-audit.ts`), returning only pass or fail. */
export const V010RunSnapshotParser = {
  safeParse(value: unknown): { success: boolean; error?: Error } {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return fail('expected an object');
    }
    const { workflow, stagesHeld, approvals, integration, autoApprovedPlanId, ...rest } =
      value as Record<string, unknown>;
    if (!V010StoredRunLimitsSchema.safeParse(rest).success) return fail('invalid limits');
    if (workflow !== undefined && !ProjectWorkflowSchema.safeParse(workflow).success) {
      return fail('invalid workflow');
    }
    if (stagesHeld !== undefined && stagesHeld !== true) {
      return fail('stagesHeld must be true when present');
    }
    if (approvals !== undefined && !ProjectApprovalsSchema.safeParse(approvals).success) {
      return fail('invalid approvals');
    }
    if (integration !== undefined && !v010ParseIntegration(integration)) {
      return fail('invalid integration');
    }
    if (
      autoApprovedPlanId !== undefined &&
      (typeof autoApprovedPlanId !== 'string' ||
        autoApprovedPlanId.length === 0 ||
        autoApprovedPlanId.length > 100)
    ) {
      return fail('invalid autoApprovedPlanId');
    }
    return { success: true };
  },
};

/** v0.1.0 `project_workflow.workflow`: the version 1 JSON only (`WorkflowJsonSchema`). */
export const V010WorkflowJsonSchema = ProjectWorkflowSchema.omit({
  projectId: true,
  updatedAt: true,
});
/** v0.1.0 `agent_runs.stage`: a version 1 stage id, or null. */
export const V010StageSchema = WorkflowStageIdSchema.nullable();
/** v0.1.0 `change_reviews.decided_by`: the lead or the owner, or null. */
export const V010DeciderSchema = z.enum(['lead', 'owner']).nullable();
/** v0.1.0 `ticket_plans.steps` (a non-strict object then: an unknown `helper` key is dropped). */
export const V010PlanStepsSchema = z.array(PlanStepSchema.omit({ helper: true }));

export interface ReadabilityReport {
  /** Rows checked per frozen column. */
  rows: Record<V010Column, number>;
  /** Rows v0.1.0 cannot read, per column (0 everywhere: v0.1.0 reads the whole database). */
  unreadable: Record<V010Column, number>;
  /** Why, per column: the failing reason (a fixed parser message or a Zod path), counted. */
  reasons: Record<string, number>;
  /** The ids of unreadable rows, for tests on synthetic data only. Never printed by scripts. */
  unreadableIds: Record<V010Column, string[]>;
}

export const V010_COLUMNS = [
  'orchestration_runs.limits',
  'project_workflow.workflow',
  'agent_runs.stage',
  'change_reviews.decided_by',
  'ticket_plans.steps',
] as const;
export type V010Column = (typeof V010_COLUMNS)[number];

const zero = (): Record<V010Column, number> =>
  Object.fromEntries(V010_COLUMNS.map((c) => [c, 0])) as Record<V010Column, number>;

function reasonOf(error: unknown): string {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    // Schema paths only, with array positions blanked; never a value. The data-copy check prints
    // these for the owner's copy.
    const path = issue?.path.slice(0, 2).map((p) => (typeof p === 'number' ? '#' : String(p)));
    return issue === undefined ? 'invalid' : `${issue.code}@${(path ?? []).join('.')}`;
  }
  // The frozen snapshot parser's own fixed messages (`fail(...)` above), never a value.
  return error instanceof Error ? error.message : 'invalid';
}

function parsesJson(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return Symbol.for('not-json');
  }
}

/**
 * Runs the frozen v0.1.0 readers over the five changed columns of the database at `path`
 * (opened without migrations; nothing is written).
 */
export function v010Readability(path: string): ReadabilityReport {
  const db = openDatabase(path, { migrate: false });
  const report: ReadabilityReport = {
    rows: zero(),
    unreadable: zero(),
    reasons: {},
    unreadableIds: Object.fromEntries(V010_COLUMNS.map((c) => [c, []])) as unknown as Record<
      V010Column,
      string[]
    >,
  };
  const check = (column: V010Column, id: string, result: { success: boolean; error?: unknown }) => {
    report.rows[column]++;
    if (result.success) return;
    report.unreadable[column]++;
    report.unreadableIds[column].push(id);
    const key = `${column}: ${reasonOf(result.error)}`;
    report.reasons[key] = (report.reasons[key] ?? 0) + 1;
  };
  try {
    const c = db.connection;
    for (const row of c.prepare('SELECT id, limits FROM orchestration_runs').all() as {
      id: string;
      limits: string | null;
    }[]) {
      // A null snapshot is a Phase 3 or 4 run: v0.1.0 reads it as "no snapshot".
      if (row.limits === null) continue;
      check(
        'orchestration_runs.limits',
        row.id,
        V010RunSnapshotParser.safeParse(parsesJson(row.limits)),
      );
    }
    for (const row of c.prepare('SELECT project_id, workflow FROM project_workflow').all() as {
      project_id: string;
      workflow: string;
    }[]) {
      check(
        'project_workflow.workflow',
        row.project_id,
        V010WorkflowJsonSchema.safeParse(parsesJson(row.workflow)),
      );
    }
    for (const row of c.prepare('SELECT id, stage FROM agent_runs').all() as {
      id: string;
      stage: string | null;
    }[]) {
      check('agent_runs.stage', row.id, V010StageSchema.safeParse(row.stage));
    }
    for (const row of c.prepare('SELECT id, decided_by FROM change_reviews').all() as {
      id: string;
      decided_by: string | null;
    }[]) {
      check('change_reviews.decided_by', row.id, V010DeciderSchema.safeParse(row.decided_by));
    }
    for (const row of c.prepare('SELECT id, steps FROM ticket_plans').all() as {
      id: string;
      steps: string;
    }[]) {
      check('ticket_plans.steps', row.id, V010PlanStepsSchema.safeParse(parsesJson(row.steps)));
    }
  } finally {
    db.close();
  }
  return report;
}

export interface SweepReport {
  /** Rows read per repository list (counts only). */
  read: Record<string, number>;
  /** Reads that threw, per repository list (a stored value today's code cannot parse). */
  failed: Record<string, number>;
}

/**
 * Reads every row the repositories can list, with today's code (byte-identical to v0.1.0's for
 * every table but the two redesign columns above). Opened without migrations; nothing is written.
 */
export function sweepRepositories(path: string): SweepReport {
  const db = openDatabase(path, { migrate: false });
  const report: SweepReport = { read: {}, failed: {} };
  const read = <T>(what: string, f: () => T[] | T | undefined | null): T[] => {
    try {
      const value = f();
      const rows =
        value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
      report.read[what] = (report.read[what] ?? 0) + rows.length;
      return rows;
    } catch {
      report.failed[what] = (report.failed[what] ?? 0) + 1;
      return [];
    }
  };
  try {
    const repos = createRepositories(db);
    const orch = createOrchestrationRepositories(db);
    const ws = createWorkspaceRepositories(db);
    const redesign = createRedesignRepositories(db);
    const loop = createReviewLoopRepositories(db);
    for (const project of read('projects', () => repos.projects.list())) {
      read('project_setup', () => ws.projectSetup.get(project.id));
      read('project_workflow', () => redesign.workflow.stored(project.id));
      read('ticket_run_options', () => [
        ...loop.ticketRunOptions.listForProject(project.id).values(),
      ]);
      read('ticket_branches', () => loop.ticketBranches.listForProject(project.id));
      read('main_check_runs', () => ws.checkRuns.listForProjectMain(project.id));
      for (const ticket of read('tickets', () => ws.tickets.listForProject(project.id))) {
        read('ticket_plans', () => ws.plans.listForTicket(ticket.id));
        read('ticket_comments', () => ws.comments.listForTicket(ticket.id));
      }
    }
    const runs: { id: string }[] = [];
    let before: { createdAt: string; id: string } | undefined;
    for (;;) {
      const page = read('orchestration_runs', () =>
        orch.runs.list({ limit: MAX_PAGE_SIZE, ...(before !== undefined && { before }) }),
      );
      runs.push(...page);
      const last = page.at(-1);
      if (page.length < MAX_PAGE_SIZE || last === undefined) break;
      before = { createdAt: last.createdAt, id: last.id };
    }
    for (const run of runs) {
      read('run_snapshot', () => redesign.runAudit.getRunSnapshot(run.id));
      read('agent_stages', () => [...redesign.runAudit.agentStagesForRun(run.id).values()]);
      read('approval_deciders', () => [
        ...redesign.runAudit.approvalDecidersForRun(run.id).values(),
      ]);
      read('approval_rules', () => [...loop.approvalRules.forRun(run.id).values()]);
      read('approvals', () => orch.approvals.listForRun(run.id));
      read('artifacts', () => orch.artifacts.listForRun(run.id));
      read('messages', () => orch.messages.list(run.id));
      read('managed_workspaces', () => orch.workspaces.listForRun(run.id));
      read('workspace_changes', () => loop.workspaceChanges.listForRun(run.id));
      read('change_reviews', () => loop.changeReviews.listForRun(run.id));
      read('check_runs', () => ws.checkRuns.listForRun(run.id));
      read('check_commits', () => loop.checkCommits.listForRun(run.id));
      read('ticket_branch', () => loop.ticketBranches.getByRun(run.id));
      read('run_plans', () => ws.plans.listForRun(run.id));
      for (const agent of read('agent_runs', () => orch.agentRuns.listForRun(run.id))) {
        read('agent_run_sessions', () => orch.agentRunSessions.listForAgentRun(agent.id));
      }
    }
  } finally {
    db.close();
  }
  return report;
}

/** Row count and a content digest per table, to tell which tables a server start changed. */
export function tableDigests(path: string): Record<string, { rows: number; digest: string }> {
  const db = openDatabase(path, { migrate: false });
  try {
    const c = db.connection;
    const tables = c
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .pluck()
      .all() as string[];
    const out: Record<string, { rows: number; digest: string }> = {};
    for (const t of tables) {
      // A cheap, stable digest (FNV-1a over each row's JSON, in rowid order where there is one);
      // never printed with any row content. Rows are streamed: the owner's copy may hold large
      // tables (the observed sessions and events) that would not fit in one JSON string.
      let h = 0x811c9dc5;
      let rows = 0;
      const withoutRowid = /\bWITHOUT\s+ROWID\b/i.test(
        (c.prepare('SELECT sql FROM sqlite_master WHERE name = ?').pluck().get(t) as
          string | null) ?? '',
      );
      const order = withoutRowid ? '' : ' ORDER BY rowid';
      for (const row of c.prepare(`SELECT * FROM "${t}"${order}`).iterate()) {
        rows++;
        for (const ch of JSON.stringify(row)) {
          h ^= ch.charCodeAt(0);
          h = Math.imul(h, 0x01000193) >>> 0;
        }
      }
      out[t] = { rows, digest: h.toString(16) };
    }
    return out;
  } finally {
    db.close();
  }
}
