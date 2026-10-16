import type { TicketPlan } from '@acp/core';
import type { RunState } from './state.js';

/** The plan waiting for the owner, if any. */
export function pendingPlan(state: Pick<RunState, 'plans'>): TicketPlan | undefined {
  return (state.plans ?? []).find((p) => p.status === 'proposed');
}

/** The approved plan of the run, if any. */
export function approvedPlan(state: Pick<RunState, 'plans'>): TicketPlan | undefined {
  return (state.plans ?? []).find((p) => p.status === 'approved');
}
