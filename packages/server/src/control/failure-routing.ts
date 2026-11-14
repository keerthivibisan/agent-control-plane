import { FAILURE_EVENT_NAMES } from '@acp/core';
import { runGraphV3Of } from '@acp/orchestrator';
import type { EngineEffect, RunState } from '@acp/orchestrator';

/**
 * ADR-0038 §4 (FR-5): the one-line app comment for a failure the engine routed along a When arrow
 * (`failure-routed`). Composed from the app's own records only: the event's name, the blocks'
 * labels from the run's graph, the fixer's role and the round numbers. Never failure text (test
 * messages, check output, findings); those stay in their own comments.
 */
export type FailureRoutedEffect = Extract<EngineEffect, { type: 'failure-routed' }>;

const REASONS: Readonly<Record<NonNullable<FailureRoutedEffect['reason']>, string>> = {
  'target-lead': 'the workflow sends it to the lead',
  'rounds-used': 'its fix rounds are used up',
  blocked: 'the fixer could not start now',
  'author-unclear': 'its author is not one known helper',
};

function labelOf(state: RunState, nodeId: string | null): string | null {
  if (nodeId === null) return null;
  const node = runGraphV3Of(state).nodes.find((n) => n.id === nodeId);
  const label = node !== undefined && 'label' in node ? node.label : nodeId;
  return label.replace(/\s+/g, ' ').trim();
}

export function failureRoutedComment(state: RunState, effect: FailureRoutedEffect): string {
  const source = labelOf(state, effect.sourceNodeId);
  const when = `When ${FAILURE_EVENT_NAMES[effect.event]}${source !== null ? ` at ${source}` : ''}`;
  const fixer = state.agents.find((a) => a.id === effect.fixerAgentRunId);
  const who = fixer?.role ?? labelOf(state, effect.targetNodeId) ?? 'a helper';
  const round =
    effect.round !== null && effect.maxRounds !== null
      ? ` (round ${effect.round} of ${effect.maxRounds})`
      : '';
  switch (effect.kind) {
    case 'fix-started':
      return `${when}: ${who} is fixing it${round}. The lead was told.`;
    case 'rerouted':
      return effect.fixerAgentRunId === null
        ? `${when}: the lead took the fix over${round}.`
        : `${when}: the lead moved the fix to ${who}${round}.`;
    case 'to-lead':
      return `${when}: the lead decides, as ${effect.reason === null ? 'the workflow says' : REASONS[effect.reason]}${round}.`;
  }
}
