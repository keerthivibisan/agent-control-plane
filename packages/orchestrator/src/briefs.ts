import type { WorkflowProgram } from '@acp/core';
import { hasNamedHelpers, helperNodeLines } from './program.js';

/**
 * The helper nodes in the lead's and planner's briefs (ADR-0023 §7). Only a workflow with named
 * helpers lists them: with just the helper pool there is nothing to choose, and the brief stays
 * exactly as before. Labels and descriptions are the owner's text from the graph.
 *
 * - `planner`: plans for the helper nodes the lead assigns;
 * - `lead-plans`: the lead writes the plan and starts the helpers;
 * - `lead`: the lead starts the helpers of an approved plan.
 */
export function helperBriefLines(
  program: WorkflowProgram,
  who: 'lead' | 'planner' | 'lead-plans',
): string[] {
  if (!hasNamedHelpers(program)) return [];
  const pool = program.helpers.some((h) => h.type === 'helper-pool');
  const plan =
    'Give every plan step the helper id of the node that should do it (the step’s `helper` field); a step no helper node can take is refused.';
  const start = `When you start a helper with start_agent, pass its node’s helper id (\`helper\`). Without one, a role equal to a node’s label picks that node${pool ? ', and any other role goes to the helper pool' : ', and any other role is refused'}.`;
  const limits = program.helpers
    .filter((h) => h.type === 'helper')
    .map((h) => `${h.label}: at most ${h.maxInstances} at once`)
    .join('; ');
  return [
    'The helper nodes of this workflow:',
    ...helperNodeLines(program),
    who === 'planner' ? plan : who === 'lead-plans' ? `${plan} ${start}` : start,
    `Limits per node: ${limits}.`,
  ];
}
