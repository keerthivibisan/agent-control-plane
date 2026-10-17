import type { SkillName, WorkflowStageId } from '@acp/core';
import type { HttpError } from '../errors.js';
import { nodesUsing, stagesUsing, type EffectiveWorkflow } from '../workflow/graph.js';
import { skillError } from './errors.js';

/**
 * The delete guard shared by skills and agent files (ADR-0018): a file the workflow still uses is
 * refused with 409, and the message names where, in the words the Workflow page uses. A version 1
 * project answers from its stages exactly as before; a graph (ADR-0023) from its agent nodes.
 */

/** What the guard and "used by" read: the project's effective workflow (`workflow/graph.ts`). */
export type WorkflowUse = Pick<EffectiveWorkflow, 'graph' | 'v1'>;

const STAGE_LABEL: Record<WorkflowStageId, string> = {
  plan: 'Plan',
  orchestrate: 'Orchestrate',
  helpers: 'Helpers',
  review: 'Review and merge',
  'code-review': 'Final code review',
  'unit-tests': 'Unit tests',
};

export function inUseError(
  code: 'skill_in_use' | 'agent_in_use',
  noun: string,
  stages: readonly WorkflowStageId[],
): HttpError {
  return skillError(
    code,
    `The ${noun} is used by these workflow stages: ${stages.map((s) => STAGE_LABEL[s]).join(', ')}. Remove it from them first.`,
  );
}

/** Throws the 409 when the project's workflow uses the skill or agent file. */
export function refuseWhenInUse(
  workflow: WorkflowUse,
  kind: 'skill' | 'agent',
  name: SkillName,
): void {
  const code = kind === 'skill' ? 'skill_in_use' : 'agent_in_use';
  const noun = kind === 'skill' ? 'skill' : 'agent file';
  if (workflow.v1 !== undefined) {
    const stages = stagesUsing(workflow, kind, name);
    if (stages.length > 0) throw inUseError(code, noun, stages);
    return;
  }
  const nodes = nodesUsing(workflow.graph, kind, name);
  if (nodes.length > 0) {
    throw skillError(
      code,
      `The ${noun} is used by these workflow blocks: ${nodes.map((n) => n.label).join(', ')}. Remove it from them first.`,
    );
  }
}
