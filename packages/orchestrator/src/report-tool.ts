import { cleanAgentNote } from './agent-note.js';
import { applyCommand } from './commands.js';
import { refusal } from './errors.js';
import type { EngineContext, EngineResult, RunState } from './state.js';
import { isLiveAgentStatus } from './transitions.js';

/**
 * The helper's and tester's one note tool (ADR-0026 §3): `report_work` turns 2 to 4 plain
 * sentences on what the agent did into a ticket comment of kind `agent-note` with its agent run.
 * One note per agent run: a later call (a rework turn) replaces it. It never changes the run. The
 * input is validated with `LeadToolInputs.report_work` in `leadToolCall`.
 */

/**
 * A helper's or tester's `report_work`: allowed while the agent is live in a ticket run that is
 * not being stopped. Emits `agent-note`; the server stores it with the transition.
 */
export function reportWork(
  state: RunState,
  callerAgentRunId: string,
  note: string,
  ctx: EngineContext,
): EngineResult<string> {
  return applyCommand(state, ctx, (d) => {
    const agent = d.agent(callerAgentRunId);
    if (agent === undefined || (agent.kind !== 'worker' && agent.kind !== 'tester')) {
      return refusal('not-lead', 'Only helpers and the tester report their work.');
    }
    if (d.run.ticketId === null) {
      return refusal('invalid-input', 'This run has no ticket to report to.');
    }
    if (d.run.status === 'CANCELLING' || d.run.status === 'CANCELLED') {
      return refusal('run-cancelling', 'The run is being stopped.');
    }
    // A helper waiting for review has ended its turn: its note had to come before.
    if (!isLiveAgentStatus(agent.status) || agent.status === 'AWAITING_REVIEW') {
      return refusal('agent-not-live', 'Your turn is over.');
    }
    const body = cleanAgentNote(note);
    if (body === '') return refusal('invalid-input', 'The note is empty.');
    d.effects.push({ type: 'agent-note', agentRunId: agent.id, body });
    return { value: 'Noted on the ticket. A later report replaces this one.' };
  });
}
