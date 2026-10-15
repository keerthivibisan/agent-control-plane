import type { PlanStep, Ticket, TicketPlan } from '@acp/core';
import { applyCommand } from './commands.js';
import { refusal } from './errors.js';
import { runLimits } from './limits.js';
import { isAgentOverBudget } from './policy.js';
import type { EngineContext, EngineResult, RunLimits, RunState } from './state.js';
import { isLiveAgentStatus } from './transitions.js';

/**
 * Plan-first runs (ADR-0016, README §4.2): PLANNING → `submit_plan` → PLAN_REVIEW → the owner
 * approves (→ RUNNING) or requests changes (→ PLANNING, the comment goes to the lead, a new plan
 * version follows). Plans are owner-facing text and are stored (ADR-0016); they live in
 * `RunState.plans`, oldest first.
 */

/** The role name for steps the lead does itself; not counted as a helper. */
export const LEAD_ROLE = 'Lead';

/** Distinct helper roles in the steps, ignoring case and the lead's own steps. */
export function plannedHelpers(steps: readonly Pick<PlanStep, 'role'>[]): number {
  const roles = new Set(
    steps.map((s) => s.role.trim().toLowerCase()).filter((r) => r !== LEAD_ROLE.toLowerCase()),
  );
  return roles.size;
}

/** The plan waiting for the owner, if any. */
export function pendingPlan(state: Pick<RunState, 'plans'>): TicketPlan | undefined {
  return (state.plans ?? []).find((p) => p.status === 'proposed');
}

/** The approved plan of the run, if any. */
export function approvedPlan(state: Pick<RunState, 'plans'>): TicketPlan | undefined {
  return (state.plans ?? []).find((p) => p.status === 'approved');
}

/**
 * The lead's `submit_plan` (input already validated with `LeadToolInputs.submit_plan`). Allowed only
 * while the run is PLANNING; files the next plan version and moves the run to PLAN_REVIEW.
 */
export function submitPlan(
  state: RunState,
  callerAgentRunId: string,
  input: { summary: string; steps: readonly PlanStep[] },
  ctx: EngineContext,
): EngineResult<string> {
  return applyCommand(state, ctx, (d) => {
    const lead = d.lead();
    if (lead === undefined || lead.id !== callerAgentRunId) {
      return refusal('not-lead', 'Only the lead agent can submit a plan.');
    }
    if (d.run.status === 'CANCELLING' || d.run.status === 'CANCELLED') {
      return refusal('run-cancelling', 'The run is being stopped.');
    }
    if (d.run.status === 'PLAN_REVIEW') {
      return refusal(
        'run-not-active',
        'A plan is already waiting for the owner; wait for their decision.',
      );
    }
    const ticketId = d.run.ticketId;
    if (d.run.status !== 'PLANNING' || ticketId === null) {
      return refusal('run-not-active', 'This run is not planning; there is no plan to submit.');
    }
    // Defensive: a leftover proposal would make two plans wait at once.
    for (const p of d.plans) {
      if (p.status === 'proposed') {
        p.status = 'superseded';
        p.decidedAt = d.now;
      }
    }
    const version = d.plans.reduce((max, p) => Math.max(max, p.version), 0) + 1;
    const plan: TicketPlan = {
      id: d.freshId(),
      ticketId,
      runId: d.run.id,
      version,
      summary: input.summary,
      steps: input.steps.map((s) => ({ title: s.title, role: s.role, detail: s.detail })),
      plannedHelpers: plannedHelpers(input.steps),
      status: 'proposed',
      createdAt: d.now,
      decidedAt: null,
    };
    d.plans.push(plan);
    d.setRunStatus('PLAN_REVIEW');
    d.effects.push({ type: 'plan-submitted', planId: plan.id });
    return {
      value: `Plan v${version} submitted. Wait for the owner: you will get a message when they approve it or ask for changes.`,
    };
  });
}

export type PlanDecision = 'approve' | 'request-changes';

/**
 * The owner's decision on the plan waiting in PLAN_REVIEW. Approve → RUNNING and the lead is told
 * to start; request changes (a comment is required) → PLANNING and the comment is sent to the lead.
 * The server stores the owner's comment as a ticket comment; the engine only sends it.
 */
export function decidePlan(
  state: RunState,
  planId: string,
  decision: PlanDecision,
  ctx: EngineContext,
  comment?: string,
): EngineResult<TicketPlan> {
  return applyCommand(state, ctx, (d) => {
    const plan = d.plans.find((p) => p.id === planId);
    if (plan === undefined) return refusal('plan-not-found', 'Unknown plan.');
    if (d.run.status === 'CANCELLING' || d.run.status === 'CANCELLED') {
      return refusal('run-cancelling', 'The run is being stopped.');
    }
    if (plan.status !== 'proposed' || d.run.status !== 'PLAN_REVIEW') {
      return refusal(
        'plan-not-pending',
        plan.status === 'proposed'
          ? 'This plan is not waiting for a decision.'
          : `This plan was already ${plan.status === 'changes-requested' ? 'sent back' : plan.status}.`,
      );
    }
    const lead = d.lead();
    if (lead === undefined || !isLiveAgentStatus(lead.status)) {
      return refusal('agent-not-live', 'The lead agent has ended.');
    }
    if (isAgentOverBudget(lead)) {
      return refusal('over-budget', 'The lead reached its budget; raise it before deciding.');
    }
    const note = comment?.trim() ?? '';

    if (decision === 'request-changes') {
      if (note.length === 0) return refusal('invalid-input', 'Say what should change.');
      plan.status = 'changes-requested';
      plan.decidedAt = d.now;
      d.setRunStatus('PLANNING');
      d.effects.push({ type: 'plan-decided', planId: plan.id, status: 'changes-requested' });
      d.effects.push({
        type: 'send-to-agent',
        agentRunId: lead.id,
        text: `The owner asked for changes to plan v${plan.version}:\n\n${note}\n\nRevise the plan and call submit_plan again.`,
      });
      return { value: { ...plan } };
    }

    plan.status = 'approved';
    plan.decidedAt = d.now;
    d.setRunStatus('RUNNING');
    d.effects.push({ type: 'plan-decided', planId: plan.id, status: 'approved' });
    const { maxConcurrentHelpers } = runLimits(d);
    d.effects.push({
      type: 'send-to-agent',
      agentRunId: lead.id,
      text: [
        `The owner approved plan v${plan.version}.`,
        note.length > 0 ? `Owner's note: ${note}` : null,
        `Start the helpers the plan needs with start_agent (at most ${maxConcurrentHelpers} at once), then call request_review when their work is done.`,
      ]
        .filter((l) => l !== null)
        .join('\n\n'),
    });
    return { value: { ...plan } };
  });
}

/**
 * The lead's first message for a ticket run: the ticket, then the plan-first instructions with the
 * run's limits. Owner text only (title and description are stored per ADR-0016).
 */
export function ticketLeadPrompt(
  ticket: Pick<Ticket, 'key' | 'title' | 'type' | 'priority' | 'description'>,
  limits: RunLimits,
): string {
  const description = ticket.description.trim();
  return [
    `Ticket ${ticket.key} (${ticket.type}, ${ticket.priority} priority): ${ticket.title}`,
    description.length > 0 ? description : '(No description.)',
    [
      'Plan first. Read the code you need; edits, commands and helpers are refused until the owner approves your plan.',
      `Then call submit_plan with a short summary and 1 to 12 steps. Give each step the helper role that will do it, or "${LEAD_ROLE}" for steps you do yourself.`,
      'If the owner asks for changes, you will get their comment: revise the plan and call submit_plan again.',
      `After approval, up to ${limits.maxConcurrentHelpers} helpers can work at once.`,
      limits.maxDepth >= 2
        ? 'Helpers may start helpers of their own.'
        : 'Helpers cannot start helpers of their own.',
    ].join(' '),
  ].join('\n\n');
}
