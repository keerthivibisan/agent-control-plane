import { MAX_OPEN_QUESTIONS } from '@acp/core';
import { applyCommand } from './commands.js';
import type { Draft } from './draft.js';
import { refusal } from './errors.js';
import { notifyAgent } from './loop.js';
import { hasReviewableChange } from './stages.js';
import type { EngineAgent, EngineContext, EngineResult, RunState } from './state.js';
import { isActiveAgentStatus, isLiveAgentStatus } from './transitions.js';

/**
 * Lead/agent messaging in the engine (ADR-0033). The engine decides who may send what to whom
 * and emits `send-to-agent` with `message` metadata; the server delivers, queues, holds or drops
 * it, records the metadata (never the text) and tells the sender the delivery state. The engine
 * never knows whether a process is up, so it never claims a delivery itself.
 */

/** The agent a helper, the tester or a reviewer reports to: its parent helper, else the lead. */
export function parentOf(
  view: Pick<RunState, 'agents'>,
  agent: EngineAgent,
): EngineAgent | undefined {
  if (agent.parentAgentRunId !== null) {
    return view.agents.find((a) => a.id === agent.parentAgentRunId);
  }
  return view.agents.find((a) => a.kind === 'lead' && a.id !== agent.id);
}

/** How the parent is named to the asker: "the lead", or the parent helper's role. */
export function parentLabel(parent: EngineAgent): string {
  return parent.kind === 'lead' ? 'the lead' : parent.role;
}

/**
 * ADR-0033 §3: `ask_lead`. A helper, the tester or a reviewer asks its parent one question; it is
 * sent as a message prefixed with the asker's role (and id, so the parent can answer with
 * `message_agent`). The asker is not blocked. At most `MAX_OPEN_QUESTIONS` stay open per agent;
 * the parent's next `message_agent` to it answers them.
 */
export function askLead(
  state: RunState,
  callerAgentRunId: string,
  question: string,
  ctx: EngineContext,
): EngineResult<string> {
  return applyCommand(state, ctx, (d) => {
    const asker = d.agent(callerAgentRunId);
    if (
      asker === undefined ||
      (asker.kind !== 'worker' && asker.kind !== 'tester' && asker.kind !== 'reviewer')
    ) {
      return refusal('not-lead', 'Only helpers, the tester and reviewers can ask the lead.');
    }
    if (d.isStopping()) return refusal('run-cancelling', 'The run is being stopped.');
    if (!isActiveAgentStatus(asker.status)) {
      return refusal('agent-not-live', 'Your turn is over.');
    }
    const parent = parentOf(d, asker);
    if (parent === undefined) {
      return refusal('unknown-agent', 'This run has no lead to ask.');
    }
    const open = asker.openQuestions ?? 0;
    if (open >= MAX_OPEN_QUESTIONS) {
      return refusal(
        'too-many-questions',
        `You already have ${MAX_OPEN_QUESTIONS} open questions for ${parentLabel(parent)}. Wait for an answer (a message from ${parentLabel(parent)}) before you ask again, and keep working meanwhile.`,
      );
    }
    asker.openQuestions = open + 1;
    d.effects.push({
      type: 'send-to-agent',
      agentRunId: parent.id,
      text: `${asker.role} (agentId ${asker.id}) asks: ${question}\n\nAnswer with message_agent to agentId ${asker.id}. It keeps working meanwhile.`,
      message: { from: asker.id, kind: 'question' },
    });
    return { value: `Question for ${parentLabel(parent)}.` };
  });
}

/**
 * ADR-0033 §4: one short notice to the parent of each helper, tester or reviewer that stopped
 * working in this command (any outcome). Only app data: the role, the outcome and where its work
 * is; never the agent's text. Notices the engine already sends are not doubled: in a review-loop
 * run the lead hears of each change through the loop (ready for review, the review agent's
 * verdict, a stopped helper's work waiting for a decision), so a change-tracked agent and a change
 * reviewer get no second notice to the lead. Nothing is sent while the run is being stopped, after
 * a restart, to the agent that stopped it (its `stop_agent` reply says so), or to a parent helper
 * that ended in the same command.
 */
export function finishNotices(d: Draft, activeAtStart: ReadonlySet<string>): void {
  if (d.isStopping()) return;
  for (const agent of d.agents) {
    if (!activeAtStart.has(agent.id) || isActiveAgentStatus(agent.status)) continue;
    if (agent.kind === 'lead' || agent.kind === 'planner') continue;
    // A restart ends every live agent (NEEDS_REVIEW); no process is left to tell.
    if (agent.status === 'NEEDS_REVIEW') continue;
    // ADR-0030: a resolver's end belongs to its conflict-resolution operation.
    if (agent.resolution !== undefined) continue;
    const parent = parentOf(d, agent);
    if (parent === undefined || parent.id === d.noFinishNoticeTo) continue;
    // A parent helper stopped in the same command (its tree was stopped) has nobody to tell; an
    // ended lead still gets it (held for its next follow-up turn, ADR-0033 §2).
    if (parent.kind !== 'lead' && !isLiveAgentStatus(parent.status)) continue;
    if (parent.kind === 'lead' && d.integration !== undefined) {
      if (agent.reviewsAgentRunId !== undefined) continue;
      if (hasReviewableChange(agent.kind) && agent.change !== undefined) continue;
    }
    notifyAgent(d, parent.id, finishNoticeText(d, agent));
  }
}

function finishNoticeText(d: Draft, agent: EngineAgent): string {
  const outcome =
    agent.status === 'SUCCEEDED' || agent.status === 'AWAITING_REVIEW'
      ? 'finished'
      : agent.status === 'CANCELLED'
        ? 'was stopped'
        : 'failed';
  let where: string;
  if (hasReviewableChange(agent.kind)) {
    where =
      d.integration !== undefined
        ? 'its change goes to review'
        : agent.review === 'pending'
          ? "its change waits for the owner's review"
          : 'see agent_status for where it stands';
  } else if (agent.kind === 'reviewer') {
    where =
      (agent.reviewPosts ?? 0) > 0 ? 'see its findings on the ticket' : 'it posted no findings';
  } else {
    where = 'see its status';
  }
  return `${agent.role} (agentId ${agent.id}) ${outcome}: ${where}.`;
}
