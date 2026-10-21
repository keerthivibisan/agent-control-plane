import { MAX_SESSION_TITLE } from '@acp/core';
import type { AgentRoleKind, WorkflowProgram } from '@acp/core';
import {
  agentNodeId,
  helperNodeOf,
  programNode,
  programOf,
  testerNodeOf,
  type EngineAgent,
  type RunState,
} from '@acp/orchestrator';

/**
 * Names of the agents the app starts (ADR-0024 §1–§2): the session title passed to the Agent SDK
 * at launch (`ManagedAgentSpec.title`) and the name the app shows (`SessionSummaryDto.managed`).
 * Built from app data only: the ticket key and the workflow block's label, or the agent's role
 * word when there is no block. Never prompt, ticket, task or chat text (the helper's `role` is the
 * lead's own words, so it is not used either). Pure.
 *
 * - a ticket run: `<KEY> · <label>`, e.g. `WEB-12 · Frontend helper`, `WEB-12 · Lead`;
 * - a change reviewer: `<KEY> · <reviewer label> → <helper label>`;
 * - a run without a ticket (control panel): `Run · <role word>`, e.g. `Run · Helper`;
 * - a second agent with the same label and role gets a number: `WEB-12 · Helpers 2`;
 * - at most `MAX_SESSION_TITLE` characters, cut with `…` and never inside a surrogate pair.
 */

/** The role word when an agent has no workflow block (control-panel runs, unknown nodes). */
export const ROLE_WORDS: Readonly<Record<AgentRoleKind, string>> = Object.freeze({
  lead: 'Lead',
  planner: 'Planner',
  worker: 'Helper',
  reviewer: 'Reviewer',
  tester: 'Tester',
});

/** The prefix of a run without a ticket. */
export const NO_TICKET_PREFIX = 'Run';

export interface AgentName {
  /** The ticket key, or `Run`. */
  prefix: string;
  /** The agent's name without the prefix (`SessionSummaryDto.managed.label`). */
  label: string;
  /** `<prefix> · <label>`, capped: the session title. */
  title: string;
}

/** One line of plain text: control characters become spaces, runs of whitespace one space. */
function oneLine(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || (code >= 0x7f && code < 0xa0) ? ' ' : ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * `text` in at most `max` UTF-16 code units (the unit of Zod's `max` and of the SDK's string), cut
 * with an ellipsis. The cut never splits a surrogate pair, so no half character is left.
 */
export function capTitle(text: string, max: number = MAX_SESSION_TITLE): string {
  const flat = oneLine(text);
  if (flat.length <= max) return flat;
  let end = Math.max(0, max - 1);
  const last = flat.charCodeAt(end - 1);
  // A high surrogate at the end would lose its low half: cut before it.
  if (end > 0 && last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${flat.slice(0, end).trimEnd()}…`;
}

function programFor(state: RunState): WorkflowProgram | undefined {
  try {
    return programOf(state);
  } catch {
    // A stored graph the validator now refuses: fall back to the role words.
    return undefined;
  }
}

function isChangeReviewer(program: WorkflowProgram | undefined, agent: EngineAgent): boolean {
  if (agent.kind !== 'reviewer') return false;
  if (agent.reviewsAgentRunId !== undefined) return true;
  const id = agentNodeId(agent);
  return program?.changeReviewers.some((n) => n.id === id) ?? false;
}

/** The workflow block's label of one agent, or its role word. */
function blockLabel(state: RunState, program: WorkflowProgram | undefined, agent: EngineAgent) {
  if (state.run.ticketId === null || program === undefined) return ROLE_WORDS[agent.kind];
  const node =
    agent.kind === 'worker'
      ? helperNodeOf(program, agent)
      : agent.kind === 'tester'
        ? testerNodeOf(program, agent)
        : programNode(program, agentNodeId(agent));
  const label = oneLine(node?.label ?? '');
  return label === '' ? ROLE_WORDS[agent.kind] : label;
}

/**
 * The label with a number when an earlier agent of the same role has the same label (in the run's
 * creation order, so the name is the same at launch and after a reload). Change reviewers are
 * named after their helper instead.
 */
function numbered(
  state: RunState,
  program: WorkflowProgram | undefined,
  agent: EngineAgent,
): string {
  const label = blockLabel(state, program, agent);
  let n = 0;
  for (const other of state.agents) {
    if (other.kind !== agent.kind || isChangeReviewer(program, other)) continue;
    if (blockLabel(state, program, other) !== label) continue;
    n++;
    if (other.id === agent.id) break;
  }
  return n >= 2 ? `${label} ${n}` : label;
}

export interface AgentNameInput {
  state: RunState;
  agentRunId: string;
  /** The run's ticket key (`WEB-12`), or null for a run without a ticket. */
  ticketKey: string | null;
  /**
   * The helper whose change a change reviewer reviews, when the state does not carry it
   * (`EngineAgent.reviewsAgentRunId` lives with the live run; a reloaded run has the
   * `change_reviews` rows instead).
   */
  reviewedAgentRunId?: (reviewerAgentRunId: string) => string | undefined;
}

/** The agent's name, or undefined for an agent the state does not have. */
export function agentName(input: AgentNameInput): AgentName | undefined {
  const { state } = input;
  const agent = state.agents.find((a) => a.id === input.agentRunId);
  if (agent === undefined) return undefined;
  const program = state.run.ticketId === null ? undefined : programFor(state);
  const prefix =
    state.run.ticketId === null ? NO_TICKET_PREFIX : (input.ticketKey ?? NO_TICKET_PREFIX);
  let label = numbered(state, program, agent);
  if (isChangeReviewer(program, agent)) {
    label = blockLabel(state, program, agent);
    const helperId = agent.reviewsAgentRunId ?? input.reviewedAgentRunId?.(agent.id);
    const helper = state.agents.find((a) => a.id === helperId);
    if (helper !== undefined) label = `${label} → ${numbered(state, program, helper)}`;
  }
  return {
    prefix,
    label: capTitle(label),
    title: capTitle(`${prefix} · ${label}`),
  };
}
