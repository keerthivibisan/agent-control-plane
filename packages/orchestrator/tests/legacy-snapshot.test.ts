import { describe, expect, it } from 'vitest';
import {
  cancelRun,
  controlToolsFor,
  decideApproval,
  decidePlan,
  deriveRunWorkflow,
  evaluateAllowlist,
  leadToolCall,
  recordReview,
  recoverAfterRestart,
  requestPermission,
} from '../src/index.js';
import type { EngineResult, RunState } from '../src/index.js';
import {
  LEAD,
  REGISTERED,
  event,
  makeCtx,
  planningRun,
  runningRun,
  startWorker,
  submitPlanFor,
  tokens,
} from './helpers.js';
import {
  PLANNER,
  finish,
  merged,
  planning,
  postReview,
  submitAs,
  workflow,
} from './workflow-helpers.js';

/**
 * ADR-0021 / RL-A: runs without the review loop (no `integration`, no `approvalPolicy`) behave
 * exactly as before RL-A. This snapshot was recorded on the engine before any RL-A change
 * (feature/ui-refresh 06f540d) and must never change. Synthetic data only.
 */

type Step = { step: string; result: unknown };

function record<T>(trace: Step[], step: string, result: EngineResult<T>): RunState {
  trace.push({ step, result });
  if (!result.ok) throw new Error(`${step}: ${result.refusal.code}`);
  return result.state;
}

function tool(state: RunState, caller: string, name: string, input: unknown, prefix: string) {
  return leadToolCall(
    state,
    { callerAgentRunId: caller, name, input, registeredProjectIds: REGISTERED },
    makeCtx(2500, prefix),
  );
}

describe('legacy runs are unchanged by the review loop', () => {
  it('a control-panel run from chat to COMPLETED', () => {
    const trace: Step[] = [];
    let s = runningRun(5000);
    const a = startWorker(s, 'API builder', 'wa');
    s = a.state;
    const b = startWorker(s, 'UI builder', 'wb');
    s = b.state;
    s = record(
      trace,
      'ask',
      requestPermission(
        s,
        { agentRunId: a.id, toolName: 'Edit', toolUseId: 't1', summary: 'Edit api.ts' },
        makeCtx(3100, 'ap'),
      ),
    );
    s = record(trace, 'approve', decideApproval(s, 'ap-1', 'approve', makeCtx(3200)));
    s = record(
      trace,
      'allowlisted',
      requestPermission(
        s,
        { agentRunId: b.id, toolName: 'Bash', toolUseId: 't2', summary: 'npm test' },
        makeCtx(3300, 'al'),
        { allowlist: { allowed: true, rule: 'run-harness-check', checkId: 'test' } },
      ),
    );
    s = record(
      trace,
      'usage',
      event(s, a.id, { type: 'usage', messageId: 'm1', tokens: tokens(100) }, 3400),
    );
    s = record(trace, 'activity', event(s, a.id, { type: 'activity', summary: 'Edit api.ts' }));
    trace.push({ step: 'tools-lead', result: controlToolsFor(s, LEAD) });
    trace.push({ step: 'tools-worker', result: controlToolsFor(s, a.id) });
    trace.push({ step: 'status', result: tool(s, LEAD, 'agent_status', { agentId: a.id }, 'x') });
    trace.push({ step: 'list', result: tool(s, LEAD, 'list_agents', {}, 'x') });
    for (const name of ['view_change', 'merge_change', 'submit_review']) {
      trace.push({ step: name, result: tool(s, LEAD, name, { agentId: a.id }, 'x') });
    }
    trace.push({ step: 'review-early', result: tool(s, LEAD, 'request_review', {}, 'rr') });
    s = record(trace, 'a-done', finish(s, a.id));
    s = record(trace, 'b-done', finish(s, b.id, 'error'));
    s = record(trace, 'review', tool(s, LEAD, 'request_review', {}, 'rr'));
    trace.push({ step: 'workflow-review', result: deriveRunWorkflow(s) });
    s = record(trace, 'merge-a', recordReview(s, a.id, 'merged', makeCtx(9000)));
    s = record(trace, 'discard-b', recordReview(s, b.id, 'discarded', makeCtx(9100)));
    trace.push({ step: 'workflow-done', result: deriveRunWorkflow(s) });
    expect(trace).toMatchSnapshot();
  });

  it('a ticket run with code review and unit tests', () => {
    const trace: Step[] = [];
    const wf = workflow({ codeReview: true, unitTests: true, skills: { helpers: 'tdd' } });
    let s = record(trace, 'merged', merged(wf));
    trace.push({ step: 'workflow', result: deriveRunWorkflow(s) });
    s = record(trace, 'post', postReview(s, 'm-1', 'One finding.'));
    s = record(trace, 'reviewer-done', finish(s, 'm-1'));
    const tester = s.agents.find((a) => a.kind === 'tester')?.id ?? 'none';
    trace.push({ step: 'tools-tester', result: controlToolsFor(s, tester) });
    s = record(trace, 'tester-done', finish(s, tester));
    s = record(trace, 'tester-merged', recordReview(s, tester, 'merged', makeCtx(12_000)));
    trace.push({ step: 'workflow-done', result: deriveRunWorkflow(s) });
    expect(trace).toMatchSnapshot();
  });

  it('plan-first, separate planner, Stop all and restart', () => {
    const trace: Step[] = [];
    let p = planningRun({ maxConcurrentHelpers: 2, maxDepth: 2 });
    const submitted = submitPlanFor(p);
    p = record(
      trace,
      'approve',
      decidePlan(submitted.state, submitted.planId, 'approve', makeCtx(1600, 'd')),
    );
    const parent = startWorker(p, 'Parent', 'wp');
    p = parent.state;
    const child = ok2(tool(p, parent.id, 'start_agent', { role: 'Child', task: 'Sub' }, 'wc'));
    p = record(trace, 'child', child);
    p = record(
      trace,
      'child-started',
      event(p, 'wc-1', { type: 'started', providerSessionId: 's-c', model: null }),
    );
    p = record(trace, 'parent-done', finish(p, parent.id));
    p = record(trace, 'child-done', finish(p, 'wc-1'));
    trace.push({ step: 'stop-all', result: cancelRun(p, makeCtx(20_000)) });

    const wf = workflow({ plannerMode: 'separate', codeReview: true });
    let q = planning(wf);
    q = record(trace, 'planner-submit', submitAs(q, PLANNER));
    q = record(trace, 'planner-approve', decidePlan(q, 'p-1', 'approve', makeCtx(1600, 'd')));
    q = record(
      trace,
      'lead-started',
      event(q, LEAD, { type: 'started', providerSessionId: 'sess-lead', model: null }),
    );
    const w = startWorker(q, 'UI', 'w');
    trace.push({ step: 'restart', result: recoverAfterRestart(w.state, makeCtx(30_000)) });
    expect(trace).toMatchSnapshot();
  });

  it('the legacy allowlist verdicts', () => {
    const base = {
      agentKind: 'worker' as const,
      resolvedPath: '/repo/wt/src/a.ts',
      worktreeRoot: '/repo/wt',
      checks: [{ id: 'test', argv: ['npm', 'test'] }],
    };
    const trace = [
      evaluateAllowlist({
        ...base,
        allowlist: { editInOwnWorktree: true, runHarnessChecks: true },
        target: { kind: 'edit', toolName: 'Edit', path: 'src/a.ts' },
      }),
      evaluateAllowlist({
        ...base,
        allowlist: { editInOwnWorktree: true, runHarnessChecks: true },
        target: { kind: 'bash', command: 'npm test' },
      }),
      evaluateAllowlist({
        ...base,
        allowlist: { editInOwnWorktree: false, runHarnessChecks: false },
        target: { kind: 'bash', command: 'npm test' },
      }),
      evaluateAllowlist({
        ...base,
        agentKind: 'lead',
        allowlist: { editInOwnWorktree: true, runHarnessChecks: true },
        target: { kind: 'bash', command: 'npm test' },
      }),
    ];
    expect(trace).toMatchSnapshot();
  });
});

function ok2<T>(r: EngineResult<T>): EngineResult<T> {
  if (!r.ok) throw new Error(r.refusal.code);
  return r;
}
