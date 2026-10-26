import { TICKET_STAGES, type TicketStage } from '@acp/core';
import type { BoardDto, TicketCardDto } from '@acp/core/api';

/**
 * Board rules that don't need React (docs/history/phase-4/README.md §5.2). The owner sets only
 * Backlog, Ready and Cancelled, and starts a ready ticket; every other column follows the ticket's
 * run, so the agents (through the server) move cards there, never a drag.
 */

/** A column the owner may move a card to. */
export type MoveTarget = 'BACKLOG' | 'READY' | 'PLANNING' | 'CANCELLED';

/**
 * What the Move menu can pick: a column, or "Start with options…" (ADR-0021), which opens the
 * Start dialog instead of starting at once. A drag is always a plain move.
 */
export type BoardPick = MoveTarget | 'START_OPTIONS';

/** How a move reaches the server: a status change, or starting a run (Ready → Planning). */
export type MoveRequest =
  { kind: 'move'; status: 'BACKLOG' | 'READY' | 'CANCELLED' } | { kind: 'start' };

/** Stages where the ticket has a live run; the only owner move left is cancelling it. */
const RUNNING_STAGES: ReadonlySet<TicketStage> = new Set([
  'PLANNING',
  'PLAN_REVIEW',
  'WORKING',
  'NEEDS_YOU',
  'IN_REVIEW',
]);

export function isRunningStage(stage: TicketStage): boolean {
  return RUNNING_STAGES.has(stage);
}

/**
 * Owner-settable moves from a stage: Backlog ↔ Ready, Ready → Planning (starts a run), and any
 * open ticket → Cancelled (asks first). Done and Cancelled are terminal here; re-running them
 * happens on the ticket page.
 */
export function allowedMoves(stage: TicketStage): readonly MoveTarget[] {
  switch (stage) {
    case 'BACKLOG':
      return ['READY', 'CANCELLED'];
    case 'READY':
      return ['BACKLOG', 'PLANNING', 'CANCELLED'];
    case 'DONE':
    case 'CANCELLED':
      return [];
    default:
      return ['CANCELLED'];
  }
}

export function canMove(from: TicketStage, to: TicketStage): boolean {
  return (allowedMoves(from) as readonly TicketStage[]).includes(to);
}

export function moveRequest(target: MoveTarget): MoveRequest {
  return target === 'PLANNING' ? { kind: 'start' } : { kind: 'move', status: target };
}

export interface BoardColumn {
  stage: TicketStage;
  tickets: TicketCardDto[];
}

/**
 * Every stage as a column, in board order, whether or not the server sent it (an empty column
 * still explains itself and accepts drops). Tickets keep the server's order and column.
 */
export function boardColumns(board: Pick<BoardDto, 'columns'>): BoardColumn[] {
  const byStage = new Map<TicketStage, TicketCardDto[]>();
  for (const column of board.columns) {
    byStage.set(column.stage, [...(byStage.get(column.stage) ?? []), ...column.tickets]);
  }
  return TICKET_STAGES.map((stage) => ({ stage, tickets: byStage.get(stage) ?? [] }));
}

export function ticketCount(board: Pick<BoardDto, 'columns'>): number {
  return board.columns.reduce((n, c) => n + c.tickets.length, 0);
}

/** Labels typed as "ui, dark mode, ui" → ["ui", "dark mode"]: trimmed, blanks and repeats dropped. */
export function parseLabels(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const label = part.trim();
    if (label.length > 0) seen.add(label);
  }
  return [...seen];
}
