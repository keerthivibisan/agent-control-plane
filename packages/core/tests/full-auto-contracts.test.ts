// Contract tests for Full auto (ADR-0022, RL-G). Additive: every earlier shape still parses.
// Synthetic data only.
import { describe, expect, it } from 'vitest';
import {
  APPROVAL_MODES,
  ApprovalModeSchema,
  DEFAULT_APPROVAL_MODE,
  ProjectApprovalsSchema,
  TicketPlanDeciderSchema,
  TicketPlanSchema,
  approvalsFromLegacy,
} from '../src/index.js';
import type { ManagedAgentEvent, ManagedAgentSpec, ManagedFailureCode } from '../src/index.js';
import {
  RunDetailDtoSchema,
  StartTicketRequestSchema,
  TicketPlanDtoSchema,
  UpdateProjectSetupRequestSchema,
} from '../src/api/index.js';

const T = '2026-10-17T09:00:00.000Z';

const plan = {
  id: 'pl1',
  ticketId: 't1',
  runId: 'r1',
  version: 1,
  summary: 'Add a toggle',
  steps: [{ title: 'UI', role: 'Frontend', detail: '' }],
  plannedHelpers: 1,
  status: 'approved',
  createdAt: T,
  decidedAt: T,
};

describe('the full-auto approval mode (ADR-0022)', () => {
  it('is the fourth mode; the default for new projects stays auto edits', () => {
    expect(APPROVAL_MODES.at(-1)).toBe('full-auto');
    expect(ApprovalModeSchema.safeParse('full-auto').success).toBe(true);
    expect(DEFAULT_APPROVAL_MODE).toBe('auto-edits');
  });

  it('never comes from a legacy allowlist', () => {
    const modes = [true, false].flatMap((editInOwnWorktree) =>
      [true, false].map(
        (runHarnessChecks) => approvalsFromLegacy({ editInOwnWorktree, runHarnessChecks }).mode,
      ),
    );
    expect(modes).not.toContain('full-auto');
  });

  it('is accepted in project approvals, the Start request and the run detail', () => {
    expect(ProjectApprovalsSchema.parse({ mode: 'full-auto', commands: [] }).mode).toBe(
      'full-auto',
    );
    expect(StartTicketRequestSchema.parse({ approvalMode: 'full-auto' }).approvalMode).toBe(
      'full-auto',
    );
    const setup = UpdateProjectSetupRequestSchema.safeParse({
      projectKey: 'WEB',
      maxConcurrentHelpers: 2,
      maxDepth: 1,
      defaultBudgetTokensPerAgent: 100_000,
      model: null,
      approvals: { mode: 'full-auto', commands: [] },
      contextFiles: [],
    });
    expect(setup.success).toBe(true);
    expect(RunDetailDtoSchema.shape.approvalMode.safeParse('full-auto').success).toBe(true);
  });
});

describe('the plan decider (ADR-0022)', () => {
  it('is owner or auto, and optional: plans stored before it still parse', () => {
    expect(TicketPlanDeciderSchema.options).toEqual(['owner', 'auto']);
    expect(TicketPlanSchema.parse(plan).decidedBy).toBeUndefined();
    expect(TicketPlanDtoSchema.parse({ ...plan, decidedBy: 'auto' }).decidedBy).toBe('auto');
    expect(TicketPlanSchema.safeParse({ ...plan, decidedBy: 'lead' }).success).toBe(false);
  });
});

describe('the managed contract for Full auto (types only)', () => {
  it('a helper spec carries its sandbox paths; a finished event may carry a failure code', () => {
    const spec: ManagedAgentSpec = {
      agentRunId: 'a1',
      kind: 'worker',
      cwd: '/data/worktrees/r1/a1',
      prompt: 'Do the step',
      model: null,
      fullAuto: { tempDir: '/data/sandbox-tmp/r1', denyRead: ['/home/u/.ssh'] },
    };
    const code: ManagedFailureCode = 'auto-mode-unavailable';
    const finished: ManagedAgentEvent = {
      type: 'finished',
      outcome: 'error',
      reportedCostUsd: null,
      failure: code,
    };
    expect(spec.fullAuto?.denyRead).toEqual(['/home/u/.ssh']);
    expect(finished).toMatchObject({ failure: 'auto-mode-unavailable' });
  });

  it('a tightened Full auto block asks for the sandbox alone (ADR-0023 §5)', () => {
    const spec: ManagedAgentSpec = {
      agentRunId: 'a2',
      kind: 'tester',
      cwd: '/data/worktrees/r1/a2',
      prompt: 'Write the tests',
      model: null,
      sandbox: { tempDir: '/data/sandbox-tmp/r1', denyRead: ['/home/u/.aws'] },
    };
    expect(spec.fullAuto).toBeUndefined();
    expect(spec.sandbox?.tempDir).toBe('/data/sandbox-tmp/r1');
  });
});
