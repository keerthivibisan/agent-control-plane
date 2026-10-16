/**
 * Synthetic, test-only Skills responses (redesign R-D). Every builder parses its output with the
 * @acp/core/api schema, so a fixture that drifts from the contract fails loudly. Names and texts are
 * invented. Never import this from src/.
 */
import {
  SkillCommitResultDtoSchema,
  SkillDetailDtoSchema,
  SkillSummaryDtoSchema,
  type SkillCommitResultDto,
  type SkillDetailDto,
  type SkillSummaryDto,
} from '@acp/core/api';

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
