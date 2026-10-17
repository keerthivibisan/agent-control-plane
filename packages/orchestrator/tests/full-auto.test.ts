import type { ProjectApprovals } from '@acp/core';
import { describe, expect, it } from 'vitest';
import {
  FULL_AUTO_FAILURE_ACTIVITY,
  FULL_AUTO_LEAD_LINE,
  FULL_AUTO_PLAN_LINE,
  decidePlan,
  requestPermission,
  ticketBranchCreated,
  ticketLeadPrompt,
  ticketPlannerPrompt,
  ticketRunPrompts,
} from '../src/index.js';
import type { RunState } from '../src/index.js';
import { LEAD, agentOf, event, makeCtx, ok, submitPlanFor } from './helpers.js';
import {
  A,
  BRANCH,
  KEY,
  createLoopRun,
  effectsOf,
  helper,
  leadMessages,
  sealed,
  types,
} from './loop-helpers.js';
import { PLANNER, submitAs, workflow } from './workflow-helpers.js';

/** Full auto (ADR-0022): the plan is approved automatically; nothing asks the owner. Synthetic. */

const FULL_AUTO: ProjectApprovals = { mode: 'full-auto', commands: [] };
const TICKET = {
  key: KEY,
  title: 'Dark mode',
  type: 'feature',
  priority: 'medium',
  description: 'Add a dark theme.',
} as const;
const LIMITS = { maxConcurrentHelpers: 3, maxDepth: 1 };

/** A loop run whose lead (or planner) has started and is planning. */
function planning(approvals?: ProjectApprovals, separate = false): RunState {
  const wf = separate ? workflow({ plannerMode: 'separate' }) : undefined;
  let s = ok(
    createLoopRun({
      ...(approvals !== undefined ? { approvals } : {}),
      ...(wf !== undefined ? { workflow: wf } : {}),
    }),
  ).state;
  const author = separate ? PLANNER : LEAD;
  s = ok(
    event(s, author, { type: 'started', providerSessionId: `sess-${author}`, model: null }),
  ).state;
  return s;
}

describe('plan approval in Full auto (ADR-0022)', () => {
  it('approves the lead’s plan at once and records it as approved automatically', () => {
    const s = ok(submitViaTool(planning(FULL_AUTO))).state;
    expect(s.run.status).toBe('RUNNING');
    const plan = s.plans?.[0];
    expect(plan).toMatchObject({ status: 'approved', decidedBy: 'auto' });
    expect(plan?.decidedAt).not.toBeNull();
  });

  it('emits no plan-waiting notice, creates the ticket branch and tells the lead after it', () => {
    const again = ok(submitViaTool(planning(FULL_AUTO)));
    expect(types(again.effects)).not.toContain('plan-submitted');
    expect(types(again.effects)).toEqual(
      expect.arrayContaining(['plan-decided', 'create-ticket-branch', 'send-to-agent']),
    );
    expect(types(again.effects).indexOf('create-ticket-branch')).toBeLessThan(
      types(again.effects).indexOf('send-to-agent'),
    );
    expect(again.value).toContain('approved automatically (Full auto)');
    const [message] = leadMessages(again.effects);
    expect(message).toContain('Plan v1 was approved automatically (Full auto).');
    expect(message).toContain(FULL_AUTO_LEAD_LINE);
    expect(message).not.toContain('The owner approved');
  });

  it('separate planner mode: the planner ends and the lead starts with the approved plan', () => {
    const s0 = planning(FULL_AUTO, true);
    const r = ok(submitAs(s0, PLANNER));
    expect(r.state.run.status).toBe('RUNNING');
    expect(agentOf(r.state, PLANNER).status).toBe('SUCCEEDED');
    expect(agentOf(r.state, LEAD).status).toBe('STARTING');
    const [start] = effectsOf(r.effects, 'start-agent');
    expect(start?.prompt).toContain('approved automatically (Full auto)');
    expect(start?.prompt).toContain(FULL_AUTO_LEAD_LINE);
    expect(r.value).toContain('your work is done');
    expect(r.state.plans?.[0]?.decidedBy).toBe('auto');
  });

  it('other modes still wait for the owner, whose approval leaves decidedBy absent', () => {
    for (const mode of ['manual', 'auto-edits', 'auto'] as const) {
      const s0 = planning({ mode, commands: [] });
      const r = ok(submitViaTool(s0));
      expect(r.state.run.status).toBe('PLAN_REVIEW');
      expect(types(r.effects)).toContain('plan-submitted');
      const decided = ok(decidePlan(r.state, 'p-1', 'approve', makeCtx(1600, 'd')));
      expect(decided.value.decidedBy).toBeUndefined();
      expect(leadMessages(decided.effects)[0]).toContain('The owner approved plan v1.');
      expect(leadMessages(decided.effects)[0]).not.toContain(FULL_AUTO_LEAD_LINE);
    }
  });

  it('a lead over its budget leaves the plan for the owner, as in the other modes', () => {
    let s0 = planning(FULL_AUTO);
    s0 = ok(
      event(s0, LEAD, {
        type: 'usage',
        messageId: 'm-1',
        tokens: { input: 10, output: 1200, cacheCreation: 0, cacheRead: 0 },
      }),
    ).state;
    const r = ok(submitViaTool(s0));
    expect(r.state.run.status).toBe('PLAN_REVIEW');
    expect(types(r.effects)).toContain('plan-submitted');
    expect(r.state.plans?.[0]?.status).toBe('proposed');
    expect(r.state.plans?.[0]?.decidedBy).toBeUndefined();
  });
});

describe('Full auto briefs (ADR-0022)', () => {
  it('the planning brief says the plan is approved automatically', () => {
    const lead = ticketLeadPrompt(TICKET, LIMITS, { fullAuto: true });
    expect(lead).toContain(FULL_AUTO_PLAN_LINE);
    expect(lead).not.toContain('the owner approves your plan');
    expect(lead).not.toContain('If the owner asks for changes');
    const planner = ticketPlannerPrompt(TICKET, LIMITS, { fullAuto: true });
    expect(planner).toContain(FULL_AUTO_PLAN_LINE);
    const both = ticketRunPrompts(TICKET, LIMITS, { plannerMode: 'separate' }, { fullAuto: true });
    expect(both.plannerPrompt).toContain(FULL_AUTO_PLAN_LINE);
  });

  it('without Full auto the briefs are unchanged', () => {
    expect(ticketLeadPrompt(TICKET, LIMITS)).toBe(ticketLeadPrompt(TICKET, LIMITS, {}));
    expect(ticketLeadPrompt(TICKET, LIMITS)).toContain('the owner approves your plan');
    expect(ticketLeadPrompt(TICKET, LIMITS)).not.toContain(FULL_AUTO_PLAN_LINE);
  });
});

/** A Full auto run with the plan approved, the branch created and helper A working. */
function fullAutoWorking(): RunState {
  let s = submitPlanFor(planning(FULL_AUTO)).state;
  s = ok(ticketBranchCreated(s, BRANCH, makeCtx(1700))).state;
  return helper(s, 'API builder', 'wa');
}

describe('a Full auto helper whose protections are unavailable (ADR-0022)', () => {
  for (const code of ['auto-mode-unavailable', 'sandbox-unavailable'] as const) {
    it(`${code}: says why, tells the lead, and ends FAILED with no change`, () => {
      const s0 = fullAutoWorking();
      const r = ok(
        event(
          s0,
          A,
          { type: 'finished', outcome: 'error', reportedCostUsd: null, failure: code },
          4000,
        ),
      );
      const agent = agentOf(r.state, A);
      expect(agent.latestActivity).toBe(FULL_AUTO_FAILURE_ACTIVITY[code]);
      expect(effectsOf(r.effects, 'diagnostic')).toEqual([
        { type: 'diagnostic', code: 'full-auto-unavailable', agentRunId: A },
      ]);
      const note = leadMessages(r.effects).find((m) => m.includes('could not start in Full auto'));
      expect(note).toContain('never ran unprotected');
      expect(note).toContain('do not start more helpers');
      // It goes through the loop like any failed turn: sealed, no change, FAILED.
      expect(agent.status).toBe('AWAITING_REVIEW');
      const done = ok(sealed(r.state, A, 'rv', false, null));
      expect(agentOf(done.state, A).status).toBe('FAILED');
      expect(agentOf(done.state, A).latestActivity).toBe(FULL_AUTO_FAILURE_ACTIVITY[code]);
    });
  }

  it('an error without a failure code is reported as before', () => {
    const r = ok(
      event(fullAutoWorking(), A, { type: 'finished', outcome: 'error', reportedCostUsd: null }),
    );
    expect(effectsOf(r.effects, 'diagnostic')).toEqual([]);
    expect(leadMessages(r.effects).some((m) => m.includes('Full auto'))).toBe(false);
  });
});

describe('the gate’s rules in Full auto (ADR-0022)', () => {
  it('a request the auto rules allow is recorded as allowed, without parking the helper', () => {
    const s = fullAutoWorking();
    const r = ok(
      requestPermission(
        s,
        { agentRunId: A, toolName: 'Bash', toolUseId: 'tu-1', summary: 'Bash npm test' },
        makeCtx(3000, 'ap'),
        { allowlist: { allowed: true, rule: 'run-harness-check', checkId: 'test' } },
      ),
    );
    expect(r.value).toMatchObject({
      status: 'approved',
      decidedBy: 'allowlist',
      allowRule: 'run-harness-check',
    });
    expect(agentOf(r.state, A).status).toBe('RUNNING');
  });
});

/** The lead's `submit_plan` on `state`: the full engine result (effects and tool reply). */
function submitViaTool(state: RunState) {
  return submitAs(state, LEAD);
}
