import type { WorkflowStageId } from '@acp/core';
import type { HttpError } from '../errors.js';
import { skillError } from './errors.js';

/**
 * The delete guard shared by skills and agent files (ADR-0018): a file a workflow stage still
 * names is refused with 409, and the message names the stages in the words the Workflow page uses.
 */

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
