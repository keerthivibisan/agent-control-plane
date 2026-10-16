/**
 * Synthetic, test-only Skills responses (redesign R-D). Every builder parses its output with the
 * @acp/core/api schema, so a fixture that drifts from the contract fails loudly. Names and texts are
 * invented. Never import this from src/.
 */
import {
  AgentDefinitionDetailDtoSchema,
  SkillCommitResultDtoSchema,
  SkillDetailDtoSchema,
  SkillSummaryDtoSchema,
  type AgentDefinitionDetailDto,
  type SkillCommitResultDto,
  type SkillDetailDto,
  type SkillSummaryDto,
} from '@acp/core/api';

/** A synthetic agent definition (`.claude/agents/<name>.md`). */
export function agentDetail(
  over: Partial<AgentDefinitionDetailDto> = {},
): AgentDefinitionDetailDto {
  const name = over.name ?? 'reviewer';
  return AgentDefinitionDetailDtoSchema.parse({
    name,
    description: 'Reviews a finished change for bugs.',
    path: `.claude/agents/${name}.md`,
    tools: ['Read', 'Grep'],
    model: null,
    sizeBytes: 640,
    lastCommittedAt: '2026-10-16T08:00:00.000Z',
    uncommitted: false,
    problems: [],
    instructions: 'You are a careful reviewer.\n',
    ...over,
  });
}

export const SKILLS_PROJECT_ID = 'p-web';
export const T_COMMITTED = '2026-10-16T08:00:00.000Z';

export function skillSummary(over: Partial<SkillSummaryDto> = {}): SkillSummaryDto {
  const name = over.name ?? 'code-review';
  return SkillSummaryDtoSchema.parse({
    name,
    description: 'Review a finished change for bugs before it is merged.',
    path: `.claude/skills/${name}/SKILL.md`,
    usedBy: [],
    sizeBytes: 812,
    lastCommittedAt: T_COMMITTED,
    uncommitted: false,
    problems: [],
    ...over,
  });
}

export function skillDetail(over: Partial<SkillDetailDto> = {}): SkillDetailDto {
  const { instructions, ...rest } = over;
  return SkillDetailDtoSchema.parse({
    ...skillSummary(rest),
    instructions: instructions ?? '# Code review\n\n1. Read the diff.\n2. Report bugs first.\n',
  });
}

export function commitResult(over: Partial<SkillCommitResultDto> = {}): SkillCommitResultDto {
  return SkillCommitResultDtoSchema.parse({
    name: 'code-review',
    commit: 'abc1234def5678',
    branch: 'main',
    ...over,
  });
}
