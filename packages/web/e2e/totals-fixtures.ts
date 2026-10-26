/*
 * Synthetic, test-only answers of `GET /api/tickets/:id/totals` (v0.3.0 T-A, the ticket badge)
 * for the review loop's ticket: done, still running, before any run, with usage the records did
 * not report, and with one token type only partly reported. Plain JSON, shared by the vitest
 * suite (which parses each with TicketTotalsDtoSchema) and the Playwright specs. No cost
 * anywhere. Never import this from src/.
 */

import { LOOP_RUN_ID, LOOP_TICKET_ID } from './review-loop-fixtures.js';

type Json = Record<string, unknown>;

export const TOTALS_PATH = `/api/tickets/${LOOP_TICKET_ID}/totals`;

const T = (min: number) => new Date(Date.UTC(2026, 9, 17, 9, min)).toISOString();

export type TotalsKind = 'done' | 'running' | 'none' | 'unavailable' | 'partial';

/** The Tokens page's numbers for the ticket: 1,234,567 processed, or nothing reported. */
function usage(kind: TotalsKind): Json {
  if (kind === 'unavailable' || kind === 'none') {
    const missing = kind === 'none' ? 0 : 3;
    return {
      usage: {
        tokens: { input: null, output: null, cacheCreation: null, cacheRead: null },
        recordCount: missing,
        recordsWithUnavailable: {
          input: missing,
          output: missing,
          cacheCreation: missing,
          cacheRead: missing,
        },
        provenance: 'derived',
      },
      headline: {
        newWork: null,
        totalProcessed: null,
        cacheReuseShare: null,
        provenance: 'derived',
      },
    };
  }
  return {
    usage: {
      tokens: { input: 34_567, output: 200_000, cacheCreation: 100_000, cacheRead: 900_000 },
      recordCount: 40,
      recordsWithUnavailable: {
        input: 0,
        output: 0,
        cacheCreation: kind === 'partial' ? 2 : 0,
        cacheRead: 0,
      },
      provenance: 'derived',
    },
    headline: {
      newWork: 234_567,
      totalProcessed: 1_234_567,
      cacheReuseShare: 900_000 / 1_234_567,
      provenance: 'derived',
    },
  };
}

/**
 * Done: one run from 09:00 to 10:12 (1h 12m). Running: started at 09:00, still live, 14 minutes
 * in when the server answered. None: before any run (the badge stays hidden).
 */
export function ticketTotals(kind: TotalsKind): Json {
  if (kind === 'none') {
    return {
      ticketId: LOOP_TICKET_ID,
      startedAt: null,
      finishedAt: null,
      elapsedMs: null,
      runs: [],
      ...usage(kind),
    };
  }
  const running = kind === 'running';
  return {
    ticketId: LOOP_TICKET_ID,
    startedAt: T(0),
    finishedAt: running ? null : T(72),
    elapsedMs: running ? 14 * 60_000 : 72 * 60_000,
    runs: [
      {
        runId: LOOP_RUN_ID,
        startedAt: T(0),
        endedAt: running ? null : T(72),
        durationMs: running ? null : 72 * 60_000,
      },
    ],
    ...usage(kind),
  };
}

/** The badge's clock for the running case: 14 minutes after the start, as the server answered. */
export const RUNNING_NOW = new Date(Date.UTC(2026, 9, 17, 9, 14));
