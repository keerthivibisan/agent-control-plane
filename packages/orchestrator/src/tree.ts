import { isLiveAgentStatus } from './transitions.js';
import type { EngineAgent, RunState } from './state.js';

/**
 * The agent tree of one run, built only from `parentAgentRunId` (never inferred). Depth 2 (ADR-0013
 * amendment) lets a helper start helpers; budgets stay per agent and only roll up for display.
 */

/** Direct children of an agent, in creation order. */
export function childrenOf(state: Pick<RunState, 'agents'>, agentRunId: string): EngineAgent[] {
  return state.agents.filter((a) => a.parentAgentRunId === agentRunId);
}

/**
 * Every descendant of an agent, children before grandchildren (breadth-first). A corrupt cycle
 * cannot loop: each agent is visited once.
 */
export function descendantsOf(state: Pick<RunState, 'agents'>, agentRunId: string): EngineAgent[] {
  const out: EngineAgent[] = [];
  const seen = new Set<string>([agentRunId]);
  const queue = [agentRunId];
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    for (const child of childrenOf(state, id)) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      out.push(child);
      queue.push(child.id);
    }
  }
  return out;
}

/** Depth of an agent in the run's tree: the lead is 0, its helpers 1, their helpers 2. */
export function agentDepth(state: Pick<RunState, 'agents'>, agent: EngineAgent): number {
  let depth = 0;
  let parentId = agent.parentAgentRunId;
  // Bounded by the agent count, so a corrupt cycle cannot loop forever.
  for (let i = 0; parentId !== null && i <= state.agents.length; i++) {
    depth++;
    const parent = state.agents.find((a) => a.id === parentId);
    parentId = parent === undefined ? null : parent.parentAgentRunId;
  }
  return depth;
}

/** What an agent's card shows about itself and everything below it. */
export interface AgentRollUp {
  agentRunId: string;
  /** All agents below this one. */
  descendants: number;
  liveDescendants: number;
  /** Pending approvals of this agent and its descendants ("needs you"). */
  pendingApprovals: number;
  /** This agent's own budget tokens (the cap applies to this number only; ADR-0014). */
  budgetTokensUsed: number;
  /** This agent's plus its descendants' budget tokens; for display, never a cap. */
  subtreeBudgetTokensUsed: number;
}

export function agentRollUp(
  state: Pick<RunState, 'agents' | 'approvals'>,
  agentRunId: string,
): AgentRollUp | undefined {
  const agent = state.agents.find((a) => a.id === agentRunId);
  if (agent === undefined) return undefined;
  const below = descendantsOf(state, agentRunId);
  const ids = new Set([agentRunId, ...below.map((a) => a.id)]);
  return {
    agentRunId,
    descendants: below.length,
    liveDescendants: below.filter((a) => isLiveAgentStatus(a.status)).length,
    pendingApprovals: state.approvals.filter((a) => a.status === 'pending' && ids.has(a.agentRunId))
      .length,
    budgetTokensUsed: agent.budgetTokensUsed,
    subtreeBudgetTokensUsed: below.reduce(
      (sum, a) => sum + a.budgetTokensUsed,
      agent.budgetTokensUsed,
    ),
  };
}
