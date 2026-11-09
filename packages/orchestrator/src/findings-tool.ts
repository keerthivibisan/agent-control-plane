import { MAX_RESEARCH_FINDINGS_CHARS, redact } from '@acp/core';
import { applyCommand } from './commands.js';
import { refusal } from './errors.js';
import type { EngineContext, EngineResult, RunState } from './state.js';
import { isLiveAgentStatus } from './transitions.js';

/**
 * The researcher's one note tool (ADR-0037 §3): `report_findings` turns what it found into ticket
 * comments of kind `research` with its agent run, and keeps the note in `findingsByAgent` for the
 * agents it researches for (AR-3 routes it). Calling it ends the researcher's work: it is told to
 * end its turn, and its input closes after the turn like a helper's. The input is validated with
 * `LeadToolInputs.report_findings` in `leadToolCall`.
 */

/** Redacts, then caps to `MAX_RESEARCH_FINDINGS_CHARS` (redaction can lengthen the text). */
export function cleanFindings(text: string): string {
  const body = redact(text).trim();
  return body.length <= MAX_RESEARCH_FINDINGS_CHARS
    ? body
    : `${body.slice(0, MAX_RESEARCH_FINDINGS_CHARS - 1).trimEnd()}…`;
}

/**
 * A researcher's `report_findings`: allowed while it is live in a ticket run that is not being
 * stopped, once: the note is the researcher's one result (ADR-0037 §3), so a second call is
 * refused. Emits `record-findings` (the server stores it with the transition).
 */
export function reportFindings(
  state: RunState,
  callerAgentRunId: string,
  findings: string,
  ctx: EngineContext,
): EngineResult<string> {
  return applyCommand(state, ctx, (d) => {
    const agent = d.agent(callerAgentRunId);
    if (agent === undefined || agent.kind !== 'researcher') {
      return refusal('not-lead', 'Only a researcher reports findings.');
    }
    const ticketId = d.run.ticketId;
    if (ticketId === null) {
      return refusal('invalid-input', 'This run has no ticket to report to.');
    }
    if (d.run.status === 'CANCELLING' || d.run.status === 'CANCELLED') {
      return refusal('run-cancelling', 'The run is being stopped.');
    }
    if (!isLiveAgentStatus(agent.status)) {
      return refusal('agent-not-live', 'Your turn is over.');
    }
    if (d.findingsByAgent?.[agent.id] !== undefined) {
      return refusal('invalid-input', 'You already reported your findings. End your turn now.');
    }
    const text = cleanFindings(findings);
    if (text === '') return refusal('invalid-input', 'The findings are empty.');
    d.findingsByAgent = { ...(d.findingsByAgent ?? {}), [agent.id]: text };
    d.effects.push({
      type: 'record-findings',
      agentRunId: agent.id,
      ticketId,
      runId: d.run.id,
      text,
    });
    return { value: 'Your findings are recorded. Your research is done: end your turn now.' };
  });
}
