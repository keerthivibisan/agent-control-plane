/**
 * Synthetic, test-only Phase 4 project-setup responses (P4-F). Every builder parses its output with
 * the @acp/core/api schema, so a fixture that drifts from the contract fails loudly. Paths, names
 * and command output are invented. Never import this from src/.
 */
import {
  CheckRunDtoSchema,
  ContextCandidateDtoSchema,
  HarnessStatusDtoSchema,
  ProjectAgentSetupDtoSchema,
  TicketDtoSchema,
  type CheckRunDto,
  type ContextCandidateDto,
  type HarnessStatusDto,
  type ProjectAgentSetupDto,
  type TicketDto,
} from '@acp/core/api';

export const PROJECT_ID = 'p-web';
const T0 = '2026-10-13T09:00:00.000Z';

export function setup(over: Partial<ProjectAgentSetupDto> = {}): ProjectAgentSetupDto {
  return ProjectAgentSetupDtoSchema.parse({
    projectId: PROJECT_ID,
    projectKey: 'WEB',
    planFirst: true,
    maxConcurrentHelpers: 3,
    maxDepth: 1,
    defaultBudgetTokensPerAgent: 500_000,
    model: null,
    allowlist: { editInOwnWorktree: false, runHarnessChecks: true },
    contextFiles: [],
    updatedAt: T0,
    ...over,
  });
}

export function harness(
  state: HarnessStatusDto['state'],
  over: Partial<HarnessStatusDto> = {},
): HarnessStatusDto {
  const checks =
    state === 'none' || state === 'invalid'
      ? []
      : [
          { id: 'test', name: 'Unit tests', required: state === 'ready' },
          { id: 'lint', name: 'Lint', required: false },
        ];
  const problems =
    state === 'invalid'
      ? ["Check 'test' needs a timeout.", 'The first word of check "build" must be a command name.']
      : state === 'partial'
        ? ['No check is required, so nothing has to pass before a merge.']
        : [];
  return HarnessStatusDtoSchema.parse({ state, checkedAt: T0, problems, checks, ...over });
}

export function candidates(): ContextCandidateDto[] {
  return ContextCandidateDtoSchema.array().parse([
    { path: 'CLAUDE.md', sizeBytes: 6_200, suggested: true },
    { path: 'AGENTS.md', sizeBytes: 14_800, suggested: true },
    { path: 'README.md', sizeBytes: 3_100, suggested: false },
    { path: 'docs/architecture.md', sizeBytes: 21_000, suggested: false },
    { path: 'docs/development.md', sizeBytes: 4_400, suggested: false },
  ]);
}

export function checkRun(over: Partial<CheckRunDto> & { checkId: string }): CheckRunDto {
  return CheckRunDtoSchema.parse({
    id: `cr-${over.checkId}`,
    runId: null,
    agentRunId: null,
    projectId: PROJECT_ID,
    name: over.checkId,
    required: true,
    status: 'passed',
    exitCode: 0,
    durationMs: 4_200,
    outputTail: '',
    startedAt: T0,
    ...over,
  });
}

export function checkRuns(): CheckRunDto[] {
  return [
    checkRun({ checkId: 'test', name: 'Unit tests', outputTail: 'Tests  42 passed (42)\n' }),
    checkRun({
      checkId: 'lint',
      name: 'Lint',
      required: false,
      status: 'failed',
      exitCode: 1,
      durationMs: 2_100,
      outputTail: 'src/app.ts\n  3:7  error  x is never used\n\n1 problem (1 error)\n',
    }),
  ];
}

export function harnessTicket(): TicketDto {
  return TicketDtoSchema.parse({
    id: 't-harness',
    projectId: PROJECT_ID,
    key: 'WEB-1',
    title: 'Build the harness',
    description: 'Give this project a harness.',
    type: 'harness',
    priority: 'high',
    labels: ['harness'],
    status: 'BACKLOG',
    currentRunId: null,
    createdAt: T0,
    updatedAt: T0,
    stage: 'BACKLOG',
  });
}
