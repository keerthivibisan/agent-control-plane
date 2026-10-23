import type { OrchestrationRun, Ticket } from '@acp/core';
import type { TicketTotalsDto } from '@acp/core/api';

/**
 * How long a ticket took and the tokens its runs used (v0.3.0 T-A, `GET /api/tickets/:id/totals`).
 * Pure: the caller passes the ticket, its runs, its usage (the Tokens page's `byTicket` row) and
 * the clock.
 *
 * - `startedAt`: the first run's start (`orchestration_runs.created_at`); null before any run.
 * - `finishedAt`: only for a ticket that is Done or Cancelled. No "done at" time is recorded, so
 *   it is the latest run end (the merge, local or on GitHub, ends the run as the ticket becomes
 *   Done); for a closed ticket with no ended run (moved by hand while a run was live), the
 *   ticket's last update. Null while the ticket is open.
 * - `elapsedMs`: `(finishedAt ?? now) - startedAt`, never below 0.
 * - Each run's duration is null while it is live (no `endedAt`).
 * - No cost: provider-reported costs are never added up (ADR-0014).
 */

const ms = (iso: string): number => Date.parse(iso);
const span = (from: string, to: number): number => Math.max(0, Math.round(to - ms(from)));

export function buildTicketTotals(input: {
  ticket: Pick<Ticket, 'id' | 'status' | 'updatedAt'>;
  runs: readonly Pick<OrchestrationRun, 'id' | 'createdAt' | 'endedAt'>[];
  usage: Pick<TicketTotalsDto, 'usage' | 'headline'>;
  now: Date;
}): TicketTotalsDto {
  const runs = [...input.runs].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id.localeCompare(b.id),
  );
  const startedAt = runs[0]?.createdAt ?? null;
  const closed = input.ticket.status === 'DONE' || input.ticket.status === 'CANCELLED';
  const lastEnd = runs
    .map((r) => r.endedAt)
    .filter((e): e is string => e !== null)
    .reduce<string | null>((max, e) => (max === null || ms(e) > ms(max) ? e : max), null);
  const finishedAt = !closed || startedAt === null ? null : (lastEnd ?? input.ticket.updatedAt);
  return {
    ticketId: input.ticket.id,
    startedAt,
    finishedAt,
    elapsedMs:
      startedAt === null
        ? null
        : span(startedAt, finishedAt === null ? input.now.getTime() : ms(finishedAt)),
    runs: runs.map((r) => ({
      runId: r.id,
      startedAt: r.createdAt,
      endedAt: r.endedAt,
      durationMs: r.endedAt === null ? null : span(r.createdAt, ms(r.endedAt)),
    })),
    usage: input.usage.usage,
    headline: input.usage.headline,
  };
}
