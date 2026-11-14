import { describeWorkflow, renderWorkflowDescription } from '@acp/core';
import type { WorkflowProgram } from '@acp/core';
import { arrowNotesOf, ownerNoteBlock } from './arrow-notes.js';
import { hasNamedHelpers, helperNodeLines, runGraphV3Of } from './program.js';
import type { ProgramView } from './program.js';

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
  // ADR-0037 §2 (amended 2026-11-14): the owner's note on each helper's implement arrow.
  const noteOf = (id: string): string[] =>
    arrowNotesOf(program, ['implement'], { to: [id] }).map((n) =>
      ownerNoteBlock("Owner's note for this helper", n),
    );
  if (!hasNamedHelpers(program)) {
    // Only the pool: nothing to choose, so the brief stays as before unless the owner wrote a note.
    const pool = program.helpers.find((h) => h.type === 'helper-pool');
    const notes = pool === undefined ? [] : noteOf(pool.id);
    return notes.length === 0 ? [] : [`The helper pool (helper "${pool?.id ?? ''}"):`, ...notes];
  }
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
    ...helperNodeLines(program).flatMap((line, i) => {
      const node = program.helpers[i];
      return node === undefined ? [line] : [line, ...noteOf(node.id)];
    }),
    who === 'planner' ? plan : who === 'lead-plans' ? `${plan} ${start}` : start,
    `Limits per node: ${limits}.`,
  ];
}

/**
 * ADR-0038 §5 (FR-5): the run's workflow in words (`describeWorkflow`, the same text the editor's
 * "Flow in words" shows), for the lead's brief and its `view_workflow` tool. Owner text in it is
 * quoted inline under a data note.
 */
export function workflowWords(view: ProgramView): string {
  const provider = view.graphContext?.projectProvider;
  return renderWorkflowDescription(
    describeWorkflow(
      runGraphV3Of(view),
      provider !== undefined ? { projectProvider: provider } : {},
    ),
  );
}

/** The heading of the lead's "Your workflow" brief section. */
export const YOUR_WORKFLOW_HEADING =
  'Your workflow (who does what and where failures go; view_workflow shows it again):';

/**
 * The lead's first brief with the "Your workflow" section, once, at its start (a version 1 run's
 * workflow is migrated, so it reads the same as its graph run's).
 */
export function withWorkflowSection(brief: string, view: ProgramView): string {
  return `${brief}\n\n${YOUR_WORKFLOW_HEADING}\n${workflowWords(view)}`;
}
