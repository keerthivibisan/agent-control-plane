import type { TicketPriority } from '@acp/core';
import type { TicketCardDto } from '@acp/core/api';
import type { DragEvent } from 'react';
import { RelativeTime } from '../../components/RelativeTime';
import { Tooltip } from '../../components/Tooltip';
import {
  BOARD_COPY,
  GLOSSARY,
  NOT_REPORTED,
  TICKET_PRIORITY_COPY,
  TICKET_TYPE_COPY,
} from '../../lib/copy';
import { formatCount, formatUsd } from '../../lib/format';
import { href } from '../../lib/router';
import { AlertIcon, TICKET_TYPE_ICON } from './icons';
import { MoveMenu } from './MoveMenu';
import { allowedMoves, isRunningStage, type MoveTarget } from './moves';

const C = BOARD_COPY.card;

/** Drag payload type: only board cards carry it, so other drags (text, files) are ignored. */
export const TICKET_DRAG_TYPE = 'application/x-acp-ticket';

/** Bars filled per priority; the word is always shown too, so color is never the only signal. */
const PRIORITY_BARS: Record<TicketPriority, number> = { low: 1, medium: 2, high: 3, urgent: 3 };
const PRIORITY_TONE: Record<TicketPriority, string> = {
  low: 'text-dim',
  medium: 'text-dim',
  high: 'text-warning',
  urgent: 'text-danger',
};

function Priority({ priority }: { priority: TicketPriority }) {
  const word = TICKET_PRIORITY_COPY[priority];
  return (
    <span
      className={`inline-flex items-center gap-1 text-caption ${PRIORITY_TONE[priority]}`}
      data-priority={priority}
      title={C.priority(word)}
    >
      <span aria-hidden="true" className="inline-flex h-2.5 items-end gap-px">
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={`w-[3px] rounded-[1px] ${n <= PRIORITY_BARS[priority] ? 'bg-current' : 'bg-line-strong'}`}
            style={{ height: `${n * 3 + 1}px` }}
          />
        ))}
      </span>
      <span className={priority === 'urgent' ? 'font-semibold' : ''}>
        <span className="sr-only">{C.priority(word)}</span>
        <span aria-hidden="true">{word}</span>
      </span>
    </span>
  );
}

/** "42K budget tokens", exact value in a tooltip. */
function BudgetTokens({ value }: { value: number }) {
  const exact = `${formatCount(value)} budget tokens`;
  const shown = `${formatCount(value, 'compact')} budget tokens`;
  if (shown === exact) return <span className="tabular-nums">{exact}</span>;
  return (
    <Tooltip content={exact} className="tabular-nums">
      <span>{shown}</span>
    </Tooltip>
  );
}

/** The latest run's provider-reported cost: always "estimated", never summed across runs. */
function LatestCost({ cost }: { cost: NonNullable<TicketCardDto['latestEstimatedCost']> }) {
  return (
    <Tooltip content={GLOSSARY.estimatedCost.tip}>
      <span data-testid="card-cost" data-provenance={cost.provenance}>
        {cost.provenance === 'unavailable' ? (
          <span className="text-unavailable">Cost {NOT_REPORTED.toLowerCase()}</span>
        ) : (
          <>
            <span className="tabular-nums">~{formatUsd(cost.value)}</span>{' '}
            <span className="text-dim">estimated</span>
          </>
        )}
      </span>
    </Tooltip>
  );
}

/**
 * One ticket on the board (README §5.2): key, type, priority, title (links to the ticket page),
 * labels; while a run is going, helpers, budget tokens and a "needs you" badge; the latest run's
 * estimated cost; last activity; and the Move menu. Draggable when it has a move to offer.
 */
export function TicketCard({
  ticket,
  busy,
  dragging,
  onMove,
  onDragStart,
  onDragEnd,
}: {
  ticket: TicketCardDto;
  busy: boolean;
  dragging: boolean;
  onMove: (ticket: TicketCardDto, target: MoveTarget) => void;
  onDragStart: (ticket: TicketCardDto) => void;
  onDragEnd: () => void;
}) {
  const moves = allowedMoves(ticket.stage);
  const TypeIcon = TICKET_TYPE_ICON[ticket.type];
  const type = TICKET_TYPE_COPY[ticket.type];
  const running = isRunningStage(ticket.stage);
  const draggable = moves.length > 0 && !busy;

  const start = (e: DragEvent<HTMLElement>) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(TICKET_DRAG_TYPE, ticket.id);
    onDragStart(ticket);
  };

  return (
    <article
      data-testid="ticket-card"
      data-ticket-id={ticket.id}
      data-stage={ticket.stage}
      aria-labelledby={`ticket-${ticket.id}`}
      aria-busy={busy || undefined}
      draggable={draggable}
      onDragStart={draggable ? start : undefined}
      onDragEnd={onDragEnd}
      className={`group relative flex flex-col gap-2 rounded-control border bg-panel px-3 py-2.5 shadow-card transition-[border-color,opacity] ${
        draggable ? 'cursor-grab active:cursor-grabbing' : ''
      } ${dragging ? 'border-accent opacity-50' : 'border-line hover:border-line-strong'} ${
        busy ? 'opacity-60' : ''
      }`}
    >
      <div className="flex items-center gap-2 text-caption text-dim">
        <span className="inline-flex items-center gap-1" title={type.tip}>
          <TypeIcon size={14} className={ticket.type === 'bug' ? 'text-danger' : ''} />
          <span className="sr-only">{type.word}</span>
        </span>
        <span className="font-mono tracking-tight">{ticket.key}</span>
        <span className="flex-1" />
        <Priority priority={ticket.priority} />
      </div>

      <a
        id={`ticket-${ticket.id}`}
        href={href.ticket(ticket.id)}
        draggable={false}
        className="font-medium break-words text-ink no-underline hover:text-accent hover:underline"
      >
        {ticket.title}
      </a>

      {ticket.labels.length > 0 || ticket.type !== 'feature' ? (
        <ul className="flex flex-wrap gap-1" aria-label="Labels">
          {ticket.type !== 'feature' ? (
            <li className="rounded-full bg-sunken px-2 py-px text-caption text-dim">{type.word}</li>
          ) : null}
          {ticket.labels.map((l) => (
            <li
              key={l}
              className="rounded-full border border-line px-2 py-px text-caption text-dim"
            >
              {l}
            </li>
          ))}
        </ul>
      ) : null}

      {ticket.needsYou > 0 ? (
        <p
          data-testid="needs-you"
          className="inline-flex items-center gap-1.5 self-start rounded-full bg-warning-soft px-2 py-0.5 text-caption font-medium text-warning"
        >
          <AlertIcon size={13} />
          {C.needsYou(ticket.needsYou)}
        </p>
      ) : null}

      {running && (ticket.activeHelpers > 0 || ticket.budgetTokensUsed !== null) ? (
        <p className="flex flex-wrap gap-x-2 text-caption text-dim" data-testid="card-run">
          {ticket.activeHelpers > 0 ? <span>{C.helpers(ticket.activeHelpers)}</span> : null}
          {ticket.activeHelpers > 0 && ticket.budgetTokensUsed !== null ? (
            <span aria-hidden="true">·</span>
          ) : null}
          {ticket.budgetTokensUsed !== null ? (
            <BudgetTokens value={ticket.budgetTokensUsed} />
          ) : null}
        </p>
      ) : null}

      {(ticket.lastRunOutcome !== null && !running) || ticket.latestEstimatedCost !== null ? (
        <p className="flex flex-wrap items-center gap-x-2 text-caption text-dim">
          {ticket.lastRunOutcome !== null && !running ? (
            <span className={ticket.lastRunOutcome === 'failed' ? 'text-danger' : ''}>
              {C.lastRun[ticket.lastRunOutcome]}
            </span>
          ) : null}
          {ticket.lastRunOutcome !== null && !running && ticket.latestEstimatedCost !== null ? (
            <span aria-hidden="true">·</span>
          ) : null}
          {ticket.latestEstimatedCost !== null ? (
            <LatestCost cost={ticket.latestEstimatedCost} />
          ) : null}
        </p>
      ) : null}

      <div className="flex items-center gap-2 text-caption text-dim">
        <span className="min-w-0 truncate">
          {ticket.lastActivityAt !== null ? 'Active ' : 'Updated '}
          <RelativeTime iso={ticket.lastActivityAt ?? ticket.updatedAt} />
        </span>
        <span className="flex-1" />
        <MoveMenu
          ticketKey={ticket.key}
          moves={moves}
          disabled={busy}
          onPick={(target) => onMove(ticket, target)}
        />
      </div>
    </article>
  );
}
