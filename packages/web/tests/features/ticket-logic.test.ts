import {
  CheckRunDtoSchema,
  ProjectWorkflowDtoSchema,
  RunWorkflowDtoSchema,
  TicketDetailDtoSchema,
  type CheckRunDto,
  type TicketDetailDto,
} from '@acp/core/api';
import { describe, expect, it } from 'vitest';
import {
  PLAN_V1,
  PLAN_V2,
  PROJECT_WORKFLOW_PATH,
  RUN_WORKFLOW_PATH,
  STORE,
  TICKET_ID,
  UI,
  doneScenario,
  heldScenario,
  inReviewScenario,
  planReviewScenario,
  reviewedScenario,
  stagesScenario,
  workingScenario,
} from '../../e2e/ticket-fixtures';
import { buildAgentTree } from '../../src/features/control/run-state';
import { liveGraph } from '../../src/features/ticket/LiveWorkflow';
import { tabsFor } from '../../src/features/ticket/SidePanel';
import {
  agentBranch,
  agentChecks,
  canStopRun,
  chatAgent,
  chatSpeaker,
  commentsOnPlan,
  descendantsBudget,
  hasWorktree,
  heldStage,
  lastRunNote,
  mergeGate,
  pendingByAgent,
  planUnderReview,
  plansOfRun,
  runBudgetUsed,
  runNumber,
  runPlannerMode,
  showRunStatus,
  stageStates,
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

  it('gives the chat tab to the lead and a separate planner only', () => {
    expect(tabsFor({ kind: 'lead' })[0]).toBe('chat');
    expect(tabsFor({ kind: 'planner' })[0]).toBe('chat');
    for (const kind of ['worker', 'reviewer', 'tester'] as const) {
      expect(tabsFor({ kind })).not.toContain('chat');
    }
  });
});

describe('redesign roles and stages (R-H)', () => {
  const runOf = (sc: { routes: Record<string, unknown> }) => {
    const run = detailOf(sc).currentRun;
    if (run === null) throw new Error('no run');
    return run;
  };
  const workflowOf = (sc: { routes: Record<string, unknown> }) =>
    RunWorkflowDtoSchema.parse(sc.routes[RUN_WORKFLOW_PATH]);
  const T = (min: number) => new Date(Date.UTC(2026, 9, 15, 9, min)).toISOString();
  const msg = (role: 'owner' | 'lead', createdAt: string) => ({ role, createdAt });

  it('tells planner chat from lead chat only by what the run proves (decision C)', () => {
    const agents = runOf(stagesScenario()).agents; // the planner ended at 09:09
    expect(chatSpeaker(msg('lead', T(5)), agents)).toBe('planner');
    expect(chatSpeaker(msg('lead', T(11)), agents)).toBe('lead');
    expect(chatSpeaker(msg('lead', T(9)), agents)).toBe('lead-or-planner');
    expect(chatSpeaker(msg('owner', T(5)), agents)).toBe('owner');
    // No planner: every reply is the lead's.
    expect(chatSpeaker(msg('lead', T(5)), runOf(workingScenario()).agents)).toBe('lead');
    // A planner still at work while the lead waits: the planner.
    const planning = [
      { kind: 'planner' as const, status: 'RUNNING' as const, endedAt: null },
      { kind: 'lead' as const, status: 'QUEUED' as const, endedAt: null },
    ];
    expect(chatSpeaker(msg('lead', T(5)), planning)).toBe('planner');
    // Not ended, yet the lead no longer waits: can't be told apart.
    const unclear = [
      { kind: 'planner' as const, status: 'RUNNING' as const, endedAt: null },
      { kind: 'lead' as const, status: 'RUNNING' as const, endedAt: null },
    ];
    expect(chatSpeaker(msg('lead', T(5)), unclear)).toBe('lead-or-planner');
  });

  it('the chat reaches the planner while it plans, else the lead', () => {
    const stages = runOf(stagesScenario());
    expect(chatAgent(stages)?.kind).toBe('lead');
    expect(chatAgent({ ...stages, status: 'PLAN_REVIEW' })?.kind).toBe('planner');
    expect(chatAgent(runOf(planReviewScenario()))?.kind).toBe('lead');
  });

  it('finds a stage held after a restart, never the tester’s own change waiting for review', () => {
    expect(heldStage(workflowOf(heldScenario()), runOf(heldScenario()))).toBe('code-review');
    expect(heldStage(workflowOf(reviewedScenario()), runOf(reviewedScenario()))).toBeNull();
    expect(heldStage(workflowOf(inReviewScenario()), runOf(inReviewScenario()))).toBeNull();
    expect(heldStage(undefined, runOf(heldScenario()))).toBeNull();
    // A held unit-tests stage: no tester yet.
    const held = workflowOf(heldScenario());
    const tests = {
      stages: held.stages.map((s) =>
        s.stage === 'code-review'
          ? { ...s, state: 'done' as const }
          : s.stage === 'unit-tests'
            ? { ...s, state: 'needs-you' as const }
            : s,
      ),
    };
    expect(heldStage(tests, runOf(heldScenario()))).toBe('unit-tests');
    // Only while the run is in review.
    expect(heldStage(held, { ...runOf(heldScenario()), status: 'RUNNING' })).toBeNull();
  });

  it('reads the planner mode from the run’s agents', () => {
    expect(runPlannerMode(runOf(stagesScenario()), 'lead')).toBe('separate');
    expect(runPlannerMode(runOf(workingScenario()), 'separate')).toBe('lead');
    expect(runPlannerMode({ agents: [] }, 'separate')).toBe('separate');
  });

  it('drops the run status under the header for the current run, keeps it for an earlier one', () => {
    expect(showRunStatus(true, 'PLAN_REVIEW')).toBe(false);
    expect(showRunStatus(true, 'RUNNING')).toBe(false);
    expect(showRunStatus(true, 'NEEDS_REVIEW')).toBe(true);
    expect(showRunStatus(false, 'PLAN_REVIEW')).toBe(true);
  });

  it('only helpers and the tester have a worktree branch', () => {
    expect(hasWorktree('worker')).toBe(true);
    expect(hasWorktree('tester')).toBe(true);
    for (const kind of ['lead', 'planner', 'reviewer'] as const) {
      expect(hasWorktree(kind)).toBe(false);
      expect(agentBranch({ kind, branch: 'x' }, { branch: 'y' })).toBeNull();
    }
  });

  it('builds the live graph from the run: its planner mode, its optional stages, one helper row', () => {
    const sc = stagesScenario();
    const project = ProjectWorkflowDtoSchema.parse(sc.routes[PROJECT_WORKFLOW_PATH]);
    const g = liveGraph(runOf(sc), project, workflowOf(sc));
    const node = (id: string) => g.nodes.find((n) => n.id === id);
    expect(node('plan')?.data).toMatchObject({ role: 'planner', sameAgentAs: null });
    expect(node('code-review')?.data).toMatchObject({ enabled: true });
    expect(g.nodes.filter((n) => n.type === 'helper')).toHaveLength(1);
    // The helpers box still states the project's limit.
    expect(node('helpers')?.data).toMatchObject({ maxHelpers: 3 });
    // A run whose optional stages are off draws them off, whatever the project says now.
    const off = liveGraph(runOf(planReviewScenario()), project, workflowOf(planReviewScenario()));
    expect(off.nodes.find((n) => n.id === 'unit-tests')?.data).toMatchObject({ enabled: false });
    expect(off.nodes.find((n) => n.id === 'plan')?.data).toMatchObject({ role: 'lead' });
  });

  it('reads every stage state, and a missing one as waiting', () => {
    const states = stageStates({
      stages: [{ stage: 'plan', state: 'done', agentRunIds: [] }],
    });
    expect(states.plan).toBe('done');
    expect(states.helpers).toBe('waiting');
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
