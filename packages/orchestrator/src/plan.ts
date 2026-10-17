import type { PlanStep, ProjectWorkflow, Ticket, TicketPlan } from '@acp/core';
import { applyCommand } from './commands.js';
import { refusal } from './errors.js';
import { runLimits } from './limits.js';
import { isAgentOverBudget } from './policy.js';
import { isSeparatePlanner, launchFields } from './stages.js';
import type { EngineContext, EngineResult, RunLimits, RunState } from './state.js';
import { isLiveAgentStatus } from './transitions.js';

/**
 * Plan-first runs (ADR-0016, README §4.2): PLANNING → `submit_plan` → PLAN_REVIEW → the owner
 * approves (→ RUNNING) or requests changes (→ PLANNING, the comment goes to the lead, a new plan
 * version follows). Plans are owner-facing text and are stored (ADR-0016); they live in
 * `RunState.plans`, oldest first.
 *
 * Separate planner mode (ADR-0019): the planner, not the lead, submits and revises the plan. On
 * approval the planner stops and the lead starts with its brief plus the approved plan; the lead
 * cannot submit or change a plan.
 */

/** The role name for steps the lead does itself; not counted as a helper. */
export const LEAD_ROLE = 'Lead';

/**
 * Roles a plan step may not name: the lead and the planner are read-only coordinators, so a step
 * given to them would never be done (owner report, 2026-10-17). Compared trimmed, ignoring case.
 */
const NON_HELPER_ROLES: ReadonlySet<string> = new Set([
  'lead',
  'the lead',
  'lead agent',
  'planner',
  'orchestrator',
]);

/** True when a plan step names a coordinator instead of a helper role. */
export function isNonHelperRole(role: string): boolean {
  return NON_HELPER_ROLES.has(role.trim().toLowerCase());
}

/** Distinct helper roles in the steps, ignoring case and the lead's own steps (older plans). */
export function plannedHelpers(steps: readonly Pick<PlanStep, 'role'>[]): number {
  const roles = new Set(
    steps.map((s) => s.role.trim().toLowerCase()).filter((r) => r !== LEAD_ROLE.toLowerCase()),
  );
  return roles.size;
}

export { approvedPlan, pendingPlan } from './plan-read.js';

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
    const author = d.planningAgent();
    if (author === undefined || author.id !== callerAgentRunId) {
      if (!isSeparatePlanner(d)) {
        return refusal('not-lead', 'Only the lead agent can submit a plan.');
      }
      return refusal(
        'not-lead',
        d.lead()?.id === callerAgentRunId
          ? 'The planner writes the plan in this project; the approved plan cannot be changed.'
          : 'Only the planner can submit a plan.',
      );
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
    const coordinatorStep = input.steps.find((s) => isNonHelperRole(s.role));
    if (coordinatorStep !== undefined) {
      return refusal(
        'invalid-input',
        `Step "${coordinatorStep.title}" is given to "${coordinatorStep.role.trim()}". The lead and the planner only coordinate and cannot edit files: give every step the helper role that will do it, then submit the plan again.`,
      );
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
    const separate = isSeparatePlanner(d);
    const author = d.planningAgent();
    const who = separate ? 'planner' : 'lead';
    if (author === undefined || !isLiveAgentStatus(author.status)) {
      return refusal(
        'agent-not-live',
        separate ? 'The planner has ended.' : 'The lead agent has ended.',
      );
    }
    if (isAgentOverBudget(author)) {
      return refusal('over-budget', `The ${who} reached its budget; raise it before deciding.`);
    }
    // Separate mode: the lead waits (QUEUED) for the approved plan and starts with it.
    const lead = d.lead();
    if (separate && (lead === undefined || lead.status !== 'QUEUED')) {
      return refusal('agent-not-live', 'The lead agent has ended.');
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
        agentRunId: author.id,
        text: `The owner asked for changes to plan v${plan.version}:\n\n${note}\n\nRevise the plan and call submit_plan again.`,
      });
      return { value: { ...plan } };
    }

    plan.status = 'approved';
    plan.decidedAt = d.now;
    d.setRunStatus('RUNNING');
    d.effects.push({ type: 'plan-decided', planId: plan.id, status: 'approved' });
    const limits = runLimits(d);
    const { maxConcurrentHelpers } = limits;
    if (separate && lead !== undefined) {
      // The planner's work is done (it is read-only, so it never waits for a tool decision).
      d.endAgent(author, author.status === 'WAITING_APPROVAL' ? 'CANCELLED' : 'SUCCEEDED', true);
      d.setAgentStatus(lead, 'STARTING');
      const brief = d.leadBrief ?? `Ticket run: ${d.run.title}`;
      d.leadBrief = undefined;
      d.effects.push({
        type: 'start-agent',
        agentRunId: lead.id,
        kind: 'lead',
        role: lead.role,
        ...launchFields(approvedPlanBrief(brief, plan, note, limits), d.workflow, 'lead'),
      });
      return { value: { ...plan } };
    }
    d.effects.push({
      type: 'send-to-agent',
      agentRunId: author.id,
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

type TicketBriefFields = Pick<Ticket, 'key' | 'title' | 'type' | 'priority' | 'description'>;

function ticketHeader(ticket: TicketBriefFields): string[] {
  const description = ticket.description.trim();
  return [
    `Ticket ${ticket.key} (${ticket.type}, ${ticket.priority} priority): ${ticket.title}`,
    description.length > 0 ? description : '(No description.)',
  ];
}

function depthLine(limits: RunLimits): string {
  return limits.maxDepth >= 2
    ? 'Helpers may start helpers of their own.'
    : 'Helpers cannot start helpers of their own.';
}

/**
 * The planner's first message in separate planner mode (ADR-0019): the ticket, then how to plan.
 * The planner only reads and only has `submit_plan`.
 */
export function ticketPlannerPrompt(ticket: TicketBriefFields, limits: RunLimits): string {
  return [
    ...ticketHeader(ticket),
    [
      'You are the planner. Read the code you need; you cannot edit files, run commands or start helpers.',
      `Call submit_plan with a short summary and 1 to 12 steps. Give every step the helper role that will do it (for example "API builder" or "Tests"). The lead only coordinates and cannot edit files, so reading the code and coordinating are not steps, and no step may be given to "${LEAD_ROLE}".`,
      'If the owner asks for changes, you will get their comment: revise the plan and call submit_plan again.',
      'Once the owner approves the plan, a lead agent carries it out and your work is done.',
      `Up to ${limits.maxConcurrentHelpers} helpers can work at once.`,
      depthLine(limits),
    ].join(' '),
  ].join('\n\n');
}

/**
 * The lead's brief in separate planner mode (ADR-0019), kept until approval. The engine adds the
 * approved plan and the owner's note when it starts the lead.
 */
export function ticketOrchestratorPrompt(ticket: TicketBriefFields, limits: RunLimits): string {
  return [
    ...ticketHeader(ticket),
    [
      'You are the lead. A planner wrote the plan below and the owner approved it: carry it out. You cannot change the plan.',
      `Up to ${limits.maxConcurrentHelpers} helpers can work at once.`,
      depthLine(limits),
    ].join(' '),
  ].join('\n\n');
}

/** The lead's first message after approval in separate mode: its brief and the approved plan. */
function approvedPlanBrief(
  brief: string,
  plan: TicketPlan,
  note: string,
  limits: RunLimits,
): string {
  return [
    brief,
    `The approved plan (v${plan.version}): ${plan.summary}`,
    plan.steps
      .map((s, i) => {
        const detail = s.detail.trim();
        return `${i + 1}. ${s.title} (${s.role})${detail.length > 0 ? `: ${detail}` : ''}`;
      })
      .join('\n'),
    note.length > 0 ? `Owner's note: ${note}` : null,
    `Start the helpers the plan needs with start_agent (at most ${limits.maxConcurrentHelpers} at once), then call request_review when their work is done.`,
  ]
    .filter((l) => l !== null)
    .join('\n\n');
}

/**
 * The prompts `createRun` needs for a ticket under a workflow: `leadPrompt` (and, in separate
 * planner mode, `plannerPrompt`). Without a workflow, or in `lead` mode, this is
 * `ticketLeadPrompt`, as in Phase 4.
 */
export function ticketRunPrompts(
  ticket: TicketBriefFields,
  limits: RunLimits,
  workflow?: Pick<ProjectWorkflow, 'plannerMode'>,
): { leadPrompt: string; plannerPrompt?: string } {
  if (workflow?.plannerMode !== 'separate') return { leadPrompt: ticketLeadPrompt(ticket, limits) };
  return {
    leadPrompt: ticketOrchestratorPrompt(ticket, limits),
    plannerPrompt: ticketPlannerPrompt(ticket, limits),
  };
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
      `Then call submit_plan with a short summary and 1 to 12 steps. Give every step the helper role that will do it (for example "API builder" or "Tests"). You only coordinate and cannot edit files, so reading the code and coordinating are not steps, and no step may be given to "${LEAD_ROLE}".`,
      'If the owner asks for changes, you will get their comment: revise the plan and call submit_plan again.',
      `After approval, up to ${limits.maxConcurrentHelpers} helpers can work at once.`,
      limits.maxDepth >= 2
        ? 'Helpers may start helpers of their own.'
        : 'Helpers cannot start helpers of their own.',
    ].join(' '),
  ].join('\n\n');
}
