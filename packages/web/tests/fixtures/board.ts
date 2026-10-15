/**
 * Synthetic, test-only board responses (Phase 4, P4-E). Every builder parses its output with the
 * @acp/core/api schema, so a fixture that drifts from the contract fails loudly. Projects, ticket
 * titles and numbers are invented. Never import this from src/.
 */
import type { TicketStage } from '@acp/core';
import {
  BoardDtoSchema,
  TicketCardDtoSchema,
  TicketDetailDtoSchema,
  TicketDtoSchema,
  type BoardDto,
  type TicketCardDto,
  type TicketDetailDto,
  type TicketDto,
} from '@acp/core/api';
import { project } from './dto';

export const PROJECT_ID = 'p-web';
export const OTHER_PROJECT_ID = 'p-api';
export const CSRF = 'csrf-token-0123456789abcdef0123456789abcdef';

const T0 = '2026-10-13T08:00:00.000Z';
const T1 = '2026-10-13T09:30:00.000Z';

export const webProject = project({ id: PROJECT_ID, name: 'web-app', rootPath: '/work/web-app' });
export const apiProject = project({ id: OTHER_PROJECT_ID, name: 'api', rootPath: '/work/api' });

const STATUS_FOR: Record<TicketStage, TicketDto['status']> = {
  BACKLOG: 'BACKLOG',
  READY: 'READY',
  PLANNING: 'ACTIVE',
  PLAN_REVIEW: 'ACTIVE',
  WORKING: 'ACTIVE',
  NEEDS_YOU: 'ACTIVE',
  IN_REVIEW: 'ACTIVE',
  DONE: 'DONE',
  CANCELLED: 'CANCELLED',
};

export function card(
  over: Partial<TicketCardDto> & { id: string; key: string; stage: TicketStage },
): TicketCardDto {
  const active = STATUS_FOR[over.stage] === 'ACTIVE';
  return TicketCardDtoSchema.parse({
    projectId: PROJECT_ID,
    title: `Ticket ${over.key}`,
    description: '',
    type: 'feature',
    priority: 'medium',
    labels: [],
    status: STATUS_FOR[over.stage],
    currentRunId: active ? `run-${over.id}` : null,
    createdAt: T0,
    updatedAt: T0,
    activeHelpers: 0,
    budgetTokensUsed: active ? 0 : null,
    needsYou: 0,
    latestEstimatedCost: null,
    lastActivityAt: null,
    lastRunOutcome: null,
    ...over,
  });
}

/** One ticket per interesting state, as on the README §5.2 sketch. */
export const tickets = {
  backlog: card({
    id: 't-14',
    key: 'WEB-14',
    stage: 'BACKLOG',
    title: 'Fix the login redirect loop',
    type: 'bug',
    priority: 'high',
    labels: ['auth'],
  }),
  ready: card({
    id: 't-13',
    key: 'WEB-13',
    stage: 'READY',
    title: 'Add CSV export to the reports page',
    lastRunOutcome: 'failed',
    latestEstimatedCost: { provenance: 'estimated', value: 0.18 },
  }),
  planReview: card({
    id: 't-12',
    key: 'WEB-12',
    stage: 'PLAN_REVIEW',
    title: 'Dark mode toggle',
    labels: ['ui', 'settings'],
    needsYou: 1,
    budgetTokensUsed: 9_800,
    lastActivityAt: T1,
  }),
  working: card({
    id: 't-9',
    key: 'WEB-9',
    stage: 'WORKING',
    title: 'Rate limit the public API',
    priority: 'urgent',
    activeHelpers: 3,
    budgetTokensUsed: 42_150,
    latestEstimatedCost: { provenance: 'estimated', value: 0.61 },
    lastActivityAt: T1,
  }),
  needsYou: card({
    id: 't-11',
    key: 'WEB-11',
    stage: 'NEEDS_YOU',
    title: 'Upgrade the build tooling',
    type: 'chore',
    priority: 'low',
    activeHelpers: 1,
    needsYou: 2,
    budgetTokensUsed: 12_000,
    latestEstimatedCost: { provenance: 'unavailable', value: null },
    lastActivityAt: T1,
  }),
  done: card({
    id: 't-3',
    key: 'WEB-3',
    stage: 'DONE',
    title: 'Build the harness',
    type: 'harness',
    priority: 'high',
    labels: ['harness'],
    latestEstimatedCost: { provenance: 'estimated', value: 1.07 },
  }),
  cancelled: card({ id: 't-5', key: 'WEB-5', stage: 'CANCELLED', title: 'Old idea' }),
} as const;

export function board(
  over: Partial<BoardDto> = {},
  cards: TicketCardDto[] = Object.values(tickets),
): BoardDto {
  const stages = [...new Set(cards.map((c) => c.stage))];
  return BoardDtoSchema.parse({
    project: webProject,
    projectKey: 'WEB',
    harness: { state: 'ready', checkedAt: T1, problems: [], checks: [] },
    stats: {
      tokensLast7Days: {
        input: 1_204_000,
        output: 84_300,
        cacheCreation: 310_000,
        cacheRead: 3_100_000,
      },
      runningRuns: 3,
      needsYou: 3,
    },
    columns: stages.map((stage) => ({ stage, tickets: cards.filter((c) => c.stage === stage) })),
    ...over,
  });
}

export function ticketDto(over: Partial<TicketDto> & { id: string; key: string }): TicketDto {
  return TicketDtoSchema.parse({
    projectId: PROJECT_ID,
    title: 'A ticket',
    description: '',
    type: 'feature',
    priority: 'medium',
    labels: [],
    status: 'BACKLOG',
    currentRunId: null,
    createdAt: T0,
    updatedAt: T0,
    stage: 'BACKLOG',
    ...over,
  });
}

export function ticketDetail(ticket: TicketDto): TicketDetailDto {
  return TicketDetailDtoSchema.parse({
    ticket,
    runs: [],
    currentRun: null,
    plans: [],
    comments: [],
    checks: [],
  });
}
