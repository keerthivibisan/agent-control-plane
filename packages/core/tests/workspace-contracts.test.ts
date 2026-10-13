import { describe, expect, it } from 'vitest';
import {
  HARD_MAX_DEPTH,
  HARD_MAX_HELPERS,
  HARNESS_TICKET_TEMPLATE,
  HarnessManifestSchema,
  LeadToolInputs,
  OrchestrationRunSchema,
  ProjectAgentSetupSchema,
  RepoRelativePathSchema,
  TICKET_STAGES,
  TicketPlanSchema,
  TicketSchema,
  ticketStage,
  type RunStatus,
} from '../src/index.js';
import {
  BoardDtoSchema,
  CreateRepoProjectRequestSchema,
  CreateTicketRequestSchema,
  PlanDecisionRequestSchema,
  ReviewActionRequestSchema,
  StreamNoticeDtoSchema,
  UpdateProjectSetupRequestSchema,
} from '../src/api/index.js';

const T = '2026-10-13T08:00:00.000Z';

describe('ticketStage (README §6.2)', () => {
  const run = (status: RunStatus, pendingApprovals = 0) => ({ status, pendingApprovals });
  it('follows owner-set statuses before any run', () => {
    expect(ticketStage({ ticket: { status: 'BACKLOG' }, run: null })).toBe('BACKLOG');
    expect(ticketStage({ ticket: { status: 'READY' }, run: null })).toBe('READY');
    expect(ticketStage({ ticket: { status: 'DONE' }, run: run('RUNNING') })).toBe('DONE');
    expect(ticketStage({ ticket: { status: 'CANCELLED' }, run: run('RUNNING') })).toBe('CANCELLED');
  });
  it('maps an active run to the board column', () => {
    const active = { status: 'ACTIVE' as const };
    expect(ticketStage({ ticket: active, run: null })).toBe('READY');
    expect(ticketStage({ ticket: active, run: run('QUEUED') })).toBe('PLANNING');
    expect(ticketStage({ ticket: active, run: run('PLANNING') })).toBe('PLANNING');
    expect(ticketStage({ ticket: active, run: run('PLAN_REVIEW') })).toBe('PLAN_REVIEW');
    expect(ticketStage({ ticket: active, run: run('RUNNING') })).toBe('WORKING');
    expect(ticketStage({ ticket: active, run: run('BLOCKED') })).toBe('WORKING');
    expect(ticketStage({ ticket: active, run: run('RUNNING', 2) })).toBe('NEEDS_YOU');
    expect(ticketStage({ ticket: active, run: run('REVIEW') })).toBe('IN_REVIEW');
    expect(ticketStage({ ticket: active, run: run('NEEDS_REVIEW') })).toBe('IN_REVIEW');
    expect(ticketStage({ ticket: active, run: run('COMPLETED') })).toBe('DONE');
    expect(ticketStage({ ticket: active, run: run('FAILED') })).toBe('READY');
    expect(ticketStage({ ticket: active, run: run('CANCELLED') })).toBe('READY');
  });
  it('has exactly the board columns of the plan', () => {
    expect(TICKET_STAGES).toEqual([
      'BACKLOG',
      'READY',
      'PLANNING',
      'PLAN_REVIEW',
      'WORKING',
      'NEEDS_YOU',
      'IN_REVIEW',
      'DONE',
      'CANCELLED',
    ]);
  });
});

describe('harness manifest (ADR-0017)', () => {
  const check = {
    id: 'test',
    name: 'Unit tests',
    argv: ['pnpm', 'test'],
    timeoutSec: 300,
    required: true,
  };
  it('accepts argv arrays with a bare command name', () => {
    expect(HarnessManifestSchema.safeParse({ version: 1, checks: [check] }).success).toBe(true);
  });
  it('refuses shells, paths as commands, duplicate ids and escaping paths', () => {
    const bad = (c: object) =>
      HarnessManifestSchema.safeParse({ version: 1, checks: [{ ...check, ...c }] }).success;
    expect(bad({ argv: ['/bin/sh', '-c', 'x'] })).toBe(false);
    expect(bad({ argv: ['./run.sh'] })).toBe(false);
    expect(bad({ argv: [] })).toBe(false);
    expect(bad({ timeoutSec: 0 })).toBe(false);
    expect(bad({ cwd: '../outside' })).toBe(false);
    expect(HarnessManifestSchema.safeParse({ version: 1, checks: [check, check] }).success).toBe(
      false,
    );
  });
  it('validates repo-relative paths', () => {
    for (const ok of ['CLAUDE.md', 'docs/a.md'])
      expect(RepoRelativePathSchema.safeParse(ok).success).toBe(true);
    for (const no of ['/etc/passwd', '../x', 'a//b', 'C:\\x', 'a\\b']) {
      expect(RepoRelativePathSchema.safeParse(no).success).toBe(false);
    }
  });
});

describe('project agent setup (ADR-0013 amendment)', () => {
  const setup = {
    projectId: 'p1',
    projectKey: 'WEB',
    planFirst: true,
    maxConcurrentHelpers: 3,
    maxDepth: 1,
    defaultBudgetTokensPerAgent: 50_000,
    model: null,
    allowlist: { editInOwnWorktree: false, runHarnessChecks: true },
    contextFiles: ['CLAUDE.md'],
    updatedAt: T,
  };
  it('enforces the hard ceilings', () => {
    expect(ProjectAgentSetupSchema.safeParse(setup).success).toBe(true);
    expect(
      ProjectAgentSetupSchema.safeParse({ ...setup, maxConcurrentHelpers: HARD_MAX_HELPERS + 1 })
        .success,
    ).toBe(false);
    expect(
      ProjectAgentSetupSchema.safeParse({ ...setup, maxDepth: HARD_MAX_DEPTH + 1 }).success,
    ).toBe(false);
    expect(ProjectAgentSetupSchema.safeParse({ ...setup, planFirst: false }).success).toBe(false);
    expect(ProjectAgentSetupSchema.safeParse({ ...setup, projectKey: 'web' }).success).toBe(false);
    expect(UpdateProjectSetupRequestSchema.safeParse({ ...setup, maxDepth: 3 }).success).toBe(
      false,
    );
  });
});

describe('tickets, plans and requests (ADR-0016)', () => {
  it('parses a ticket and a plan', () => {
    expect(
      TicketSchema.safeParse({
        id: 't1',
        projectId: 'p1',
        key: 'WEB-12',
        title: 'Dark mode',
        description: '',
        type: 'feature',
        priority: 'high',
        labels: ['ui'],
        status: 'ACTIVE',
        currentRunId: 'r1',
        createdAt: T,
        updatedAt: T,
      }).success,
    ).toBe(true);
    expect(
      TicketPlanSchema.safeParse({
        id: 'pl1',
        ticketId: 't1',
        runId: 'r1',
        version: 1,
        summary: 'Add a toggle',
        steps: [{ title: 'UI', role: 'Frontend', detail: '' }],
        plannedHelpers: 1,
        status: 'proposed',
        createdAt: T,
        decidedAt: null,
      }).success,
    ).toBe(true);
  });
  it('fills ticket request defaults and requires a comment to request plan changes', () => {
    expect(CreateTicketRequestSchema.parse({ title: 'Fix login' })).toMatchObject({
      type: 'feature',
      priority: 'medium',
      labels: [],
      description: '',
    });
    expect(PlanDecisionRequestSchema.safeParse({ decision: 'approve' }).success).toBe(true);
    expect(PlanDecisionRequestSchema.safeParse({ decision: 'request-changes' }).success).toBe(
      false,
    );
  });
  it('requires a reason for merge-anyway and validates new repo names', () => {
    expect(
      ReviewActionRequestSchema.safeParse({ agentRunId: 'a', action: 'merge-anyway' }).success,
    ).toBe(false);
    expect(
      ReviewActionRequestSchema.safeParse({
        agentRunId: 'a',
        action: 'merge-anyway',
        reason: 'flaky test',
      }).success,
    ).toBe(true);
    expect(
      CreateRepoProjectRequestSchema.safeParse({ parentDir: '/work', name: 'app' }).success,
    ).toBe(true);
    expect(
      CreateRepoProjectRequestSchema.safeParse({ parentDir: '/work', name: '../app' }).success,
    ).toBe(false);
    expect(
      CreateRepoProjectRequestSchema.safeParse({ parentDir: 'work', name: 'app' }).success,
    ).toBe(false);
  });
  it('keeps Phase 3 runs valid (no ticket) and adds submit_plan and ticket notices', () => {
    const r = OrchestrationRunSchema.parse({
      id: 'r1',
      projectId: 'p1',
      title: 'x',
      status: 'PLANNING',
      budget: { maxTokensPerAgent: 1, softCostUsdPerRun: null },
      createdAt: T,
      updatedAt: T,
      endedAt: null,
    });
    expect(r.ticketId).toBeNull();
    expect(LeadToolInputs.submit_plan.safeParse({ summary: 's', steps: [] }).success).toBe(false);
    expect(
      StreamNoticeDtoSchema.parse({
        kind: 'tickets-changed',
        lastEventId: 0,
        sessionIds: [],
        projectIds: [],
        ticketIds: ['t1'],
      }).ticketIds,
    ).toEqual(['t1']);
  });
  it('has a harness ticket template and an empty-but-valid board shape', () => {
    expect(HARNESS_TICKET_TEMPLATE.type).toBe('harness');
    expect(HARNESS_TICKET_TEMPLATE.description).toContain('.acp/harness.json');
    expect(BoardDtoSchema.shape.columns).toBeDefined();
  });
});
