import type { HarnessState } from '@acp/core';
import type { CheckRunDto, TicketCardDto, TicketDto } from '@acp/core/api';
import type { PillTone } from '../../components/Pill';
import type { ApiError } from '../../lib/api';
import { HARNESS_PAGE_COPY } from '../../lib/copy';

/** Pure helpers for the Harness page, unit-tested in tests/features/harness-logic.test.ts. */

/** Harness state → pill tone (DESIGN.md: harness Ready → success). */
export const HARNESS_TONE: Readonly<Record<HarnessState, PillTone>> = {
  ready: 'success',
  partial: 'warning',
  invalid: 'danger',
  none: 'neutral',
};

/** Checks can run on main only with a readable manifest (ADR-0017 §2). */
export function canRunChecks(state: HarnessState): boolean {
  return state === 'ready' || state === 'partial';
}

/**
 * The project's "Build the harness" ticket to show: the newest ticket of type `harness` that was
 * not cancelled. A ticket the owner just created is used until the list is refetched.
 */
export function pickHarnessTicket(
  cards: readonly TicketCardDto[] | undefined,
  justCreated: TicketDto | null,
): Pick<TicketDto, 'id' | 'projectId' | 'key' | 'title' | 'stage'> | null {
  const harness = (cards ?? [])
    .filter((c) => c.type === 'harness' && c.stage !== 'CANCELLED')
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  const newest = harness[0] ?? null;
  if (justCreated !== null && (newest === null || newest.createdAt < justCreated.createdAt)) {
    return justCreated;
  }
  return newest;
}

/**
 * "Build the harness" is offered when there is no harness and no harness ticket is open. A Done
 * ticket whose changes left no harness (discarded, say) doesn't stop a new one.
 */
export function offerBuild(state: HarnessState, ticket: Pick<TicketDto, 'stage'> | null): boolean {
  return state === 'none' && (ticket === null || ticket.stage === 'DONE');
}

export interface RunSummary {
  total: number;
  passed: number;
  /** Names of required checks that did not pass (failed, timed out, couldn't run, skipped). */
  requiredFailed: string[];
}

export function summarize(results: readonly CheckRunDto[]): RunSummary {
  return {
    total: results.length,
    passed: results.filter((r) => r.status === 'passed').length,
    requiredFailed: results.filter((r) => r.required && r.status !== 'passed').map((r) => r.name),
  };
}

/** A refusal in words: known server codes get a sentence, anything else the generic line. */
export function runErrorText(error: ApiError): string {
  const known = error.code === null ? undefined : HARNESS_PAGE_COPY.runs.errors[error.code];
  return known ?? HARNESS_PAGE_COPY.runs.failed;
}
