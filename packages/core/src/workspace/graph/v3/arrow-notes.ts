import type {
  ProgramArrowNoteType,
  WorkflowEdgeV3,
  WorkflowNodeId,
  WorkflowNodeV3,
} from '../../workflow-graph.js';

/**
 * Who reads an arrow's label and purpose (ADR-0037 §2, amended 2026-11-14: the owner's words on
 * every arrow reach the agent it concerns). Pure; the compiler and the editor both ask it, so the
 * editor's hint says exactly what the engine does.
 *
 * - `research`: the target, with the findings (the researcher also reads it in its own brief);
 * - `custom`: the target, with the hand-off;
 * - `implement`: the helper it starts (its brief and rework requests; the lead sees it in the
 *   helper list);
 * - `plan`: the planner, in its brief;
 * - `review`: the reviewer of the change (an agent, or the lead);
 * - `findings`: the lead (or agent) the reviewer's verdict goes to, with that verdict;
 * - `rework`: the editor the change goes back to, with the rework request;
 * - `test`, and `flow` into an agent: that tester or final reviewer (final chain), planner or lead
 *   (plan path), in its brief;
 * - `flow` between steps (gates, Checks blocks) and `merge`: nobody (no agent at the receiving
 *   end).
 *
 * The note is data for that agent: it never changes a role, a mode or an approval (AGENTS.md §3.7).
 */
export function arrowNoteReceiver(
  edge: Pick<WorkflowEdgeV3, 'type' | 'from' | 'to'>,
  from: WorkflowNodeV3 | undefined,
  to: WorkflowNodeV3 | undefined,
): WorkflowNodeId | null {
  const isAgent = (n: WorkflowNodeV3 | undefined) => n?.type === 'agent' || n?.type === 'lead';
  switch (edge.type) {
    case 'plan':
      return from?.type === 'agent' ? edge.from : null;
    case 'research':
    case 'custom':
    case 'implement':
    case 'review':
    case 'findings':
    case 'rework':
    case 'test':
    case 'flow':
      return isAgent(to) ? edge.to : null;
    case 'merge':
      return null;
  }
}

const NOTE_TYPES: ReadonlySet<string> = new Set<ProgramArrowNoteType>([
  'plan',
  'implement',
  'review',
  'findings',
  'rework',
  'test',
  'flow',
]);

/** True for the arrow types `WorkflowProgram.arrowNotes` carries (not research or custom). */
export function isArrowNoteType(type: WorkflowEdgeV3['type']): type is ProgramArrowNoteType {
  return NOTE_TYPES.has(type);
}
