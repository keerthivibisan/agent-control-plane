import {
  CheckRunDtoSchema,
  TicketDetailDtoSchema,
  type CheckRunDto,
  type TicketDetailDto,
} from '@acp/core/api';
import { describe, expect, it } from 'vitest';
import {
  PLAN_V1,
  PLAN_V2,
  STORE,
  TICKET_ID,
  UI,
  doneScenario,
  inReviewScenario,
  planReviewScenario,
  workingScenario,
} from '../../e2e/ticket-fixtures';
import { buildAgentTree } from '../../src/features/control/run-state';
import { tabsFor } from '../../src/features/ticket/SidePanel';
import {
  agentBranch,
  agentChecks,
  canStopRun,
  commentsOnPlan,
  descendantsBudget,
  lastRunNote,
  mergeGate,
  pendingByAgent,
  planUnderReview,
  plansOfRun,
  runBudgetUsed,
  runNumber,
  startAction,
} from '../../src/features/ticket/ticket-state';

const detailOf = (sc: { routes: Record<string, unknown> }): TicketDetailDto =>
  TicketDetailDtoSchema.parse(sc.routes[`/api/tickets/${TICKET_ID}`]);

function check(over: Partial<CheckRunDto> & { id: string; checkId: string }): CheckRunDto {
  return CheckRunDtoSchema.parse({
    runId: 'run-2',
    agentRunId: UI,
    projectId: 'p',
    name: over.checkId,
    required: true,
    status: 'passed',
    exitCode: 0,
    durationMs: 10,
    outputTail: '',
    startedAt: '2026-10-15T10:00:00.000Z',
    ...over,
  });
}

describe('checks and the merge gate', () => {
  it('keeps the latest run of each check, required first, the rest as earlier runs', () => {
    const checks = [
      check({ id: 'a', checkId: 'lint', required: false }),
      check({ id: 'b', checkId: 'test', status: 'failed', startedAt: '2026-10-15T09:00:00.000Z' }),
      check({ id: 'c', checkId: 'test', status: 'passed' }),
      check({ id: 'd', checkId: 'build', agentRunId: STORE, status: 'failed' }),
    ];
    const { latest, earlier } = agentChecks(checks, UI);
    expect(latest.map((c) => c.id)).toEqual(['c', 'a']);
    expect(earlier.map((c) => c.id)).toEqual(['b']);
    expect(mergeGate(latest)).toEqual({ kind: 'passed', passed: 2, total: 2 });
  });

  it('blocks on a failed, timed-out or unrunnable required check, never on an optional one', () => {
    for (const status of ['failed', 'timed-out', 'error'] as const) {
      const gate = mergeGate([check({ id: 'x', checkId: 'build', status })]);
      expect(gate.kind).toBe('blocked');
    }
    expect(
      mergeGate([check({ id: 'x', checkId: 'lint', status: 'failed', required: false })]).kind,
    ).toBe('passed');
    expect(mergeGate([check({ id: 'x', checkId: 'e2e', status: 'skipped' })]).kind).toBe('passed');
    expect(mergeGate([])).toEqual({ kind: 'no-checks' });
  });

  it('reads the fixtures the same way: the Settings UI is blocked by Build', () => {
    const d = detailOf(inReviewScenario());
    const gate = mergeGate(agentChecks(d.checks, UI).latest);
    expect(gate.kind === 'blocked' && gate.failing.map((c) => c.name)).toEqual(['Build']);
    expect(mergeGate(agentChecks(d.checks, STORE).latest).kind).toBe('passed');
  });
});

describe('plans', () => {
  it('shows the plan card only while the newest plan waits in PLAN_REVIEW', () => {
    const d = detailOf(planReviewScenario());
    const run = d.currentRun;
    expect(run).not.toBeNull();
    if (run === null) return;
    expect(planUnderReview(run, d.plans)?.id).toBe(PLAN_V2);
    expect(planUnderReview({ ...run, status: 'PLANNING' }, d.plans)).toBeNull();
    expect(plansOfRun(d.plans, run.id).map((p) => p.version)).toEqual([2, 1]);
    const w = detailOf(workingScenario());
    expect(w.currentRun && planUnderReview(w.currentRun, w.plans)).toBeNull();
  });

  it('attaches comments to the plan version they were written on', () => {
    const d = detailOf(planReviewScenario());
    expect(commentsOnPlan(d.comments, PLAN_V1).map((c) => c.id)).toEqual(['c-1']);
    expect(commentsOnPlan(d.comments, PLAN_V2)).toEqual([]);
  });
});

describe('header actions', () => {
  it('offers Re-run on Done and Cancelled, Start on a fresh Ready ticket, nothing mid-run', () => {
    const done = detailOf(doneScenario());
    expect(startAction(done)).toBe('rerun');
    expect(
      startAction({ ticket: { ...done.ticket, status: 'CANCELLED', stage: 'CANCELLED' } }),
    ).toBe('rerun');
    expect(
      startAction({
        ticket: { ...done.ticket, status: 'READY', stage: 'READY', currentRunId: null },
      }),
    ).toBe('start');
    expect(startAction(detailOf(workingScenario()))).toBeNull();
  });

  it('explains a ticket back in Ready after a failed or stopped run', () => {
    const w = detailOf(workingScenario());
    const failed = {
      ticket: { ...w.ticket, stage: 'READY' as const },
      runs: w.runs.map((r) => ({ ...r, status: 'FAILED' as const })),
    };
    expect(lastRunNote(failed)).toBe('FAILED');
    expect(startAction(failed)).toBe('rerun');
    expect(lastRunNote(w)).toBeNull();
  });

  it('allows Stop all while planning or working, not once the agents stopped', () => {
    expect(canStopRun('PLANNING')).toBe(true);
    expect(canStopRun('PLAN_REVIEW')).toBe(true);
    expect(canStopRun('RUNNING')).toBe(true);
    expect(canStopRun('REVIEW')).toBe(false);
    expect(canStopRun('COMPLETED')).toBe(false);
  });

  it('numbers runs from the oldest', () => {
    const d = detailOf(workingScenario());
    expect(runNumber(d.runs, 'run-2')).toBe(2);
    expect(runNumber(d.runs, 'run-1')).toBe(1);
    expect(runNumber(d.runs, 'nope')).toBeNull();
  });
});

describe('agents', () => {
  it('rolls budgets up for display only, and counts each agent once in the run total', () => {
    const d = detailOf(workingScenario());
    const agents = d.currentRun?.agents ?? [];
    const lead = buildAgentTree(agents)[0];
    expect(lead && descendantsBudget(lead)).toBe(12_000 + 8_200 + 22_500 + 3_100 + 4_800);
    expect(runBudgetUsed(agents)).toBe(92_700);
  });

  it('counts pending approvals per agent', () => {
    const d = detailOf(workingScenario());
    expect(d.currentRun && [...pendingByAgent(d.currentRun)]).toEqual([[STORE, 1]]);
  });

  it('gives the chat tab to the lead only', () => {
    expect(tabsFor({ kind: 'lead' })[0]).toBe('chat');
    expect(tabsFor({ kind: 'worker' })).not.toContain('chat');
  });
});

describe('agentBranch', () => {
  const review = { branch: 'acp/run-2/from-review' };
  it("prefers the agent's own branch, then the review's, else null", () => {
    expect(agentBranch({ kind: 'worker', branch: 'acp/run-2/own' }, review)).toBe('acp/run-2/own');
    expect(agentBranch({ kind: 'worker', branch: null }, review)).toBe('acp/run-2/from-review');
    expect(agentBranch({ kind: 'worker', branch: null }, undefined)).toBeNull();
  });
  it('never gives the lead a branch (it has no worktree)', () => {
    expect(agentBranch({ kind: 'lead', branch: 'acp/run-2/lead' }, review)).toBeNull();
  });
});
