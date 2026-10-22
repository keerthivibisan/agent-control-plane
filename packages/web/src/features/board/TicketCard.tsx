import type { TicketPriority, TicketType } from '@acp/core';
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
import { RunOptionsBadge } from '../review-loop/RunOptions';
import { href } from '../../lib/router';
import { AlertIcon, BudgetIcon, HelpersIcon, PRIORITY_ICON, TICKET_TYPE_ICON } from './icons';
import { MoveMenu } from './MoveMenu';
import { allowedMoves, isRunningStage, type BoardPick } from './moves';

const C = BOARD_COPY.card;

/** Drag payload type: only board cards carry it, so other drags (text, files) are ignored. */
export const TICKET_DRAG_TYPE = 'application/x-acp-ticket';

/** A label or the ticket type: a small, quiet pill (GitHub's labels, DESIGN.md v3). */
const CHIP =
  'inline-flex h-5 items-center rounded-full border px-2 text-caption font-medium whitespace-nowrap text-dim';

/** Type icon tone: a bug stands out; the type is also said in words (sr-only, and as a chip). */
const TYPE_TONE: Record<TicketType, string> = {
  feature: '',
  bug: 'text-danger',
  chore: '',
  harness: 'text-success',
};

/** Priority tone: the icon and the word always come together, so color is never the only signal. */
const PRIORITY_TONE: Record<TicketPriority, string> = {
  low: 'text-dim',
  medium: 'text-dim',
  high: 'text-warning',
  urgent: 'text-danger',
};

function Priority({ priority }: { priority: TicketPriority }) {
  const word = TICKET_PRIORITY_COPY[priority];
  const Icon = PRIORITY_ICON[priority];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 text-caption ${PRIORITY_TONE[priority]}`}
      data-priority={priority}
      title={C.priority(word)}
    >
      <Icon size={14} strokeWidth={2.25} />
      <span className={priority === 'urgent' || priority === 'high' ? 'font-medium' : ''}>
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
  onMove: (ticket: TicketCardDto, target: BoardPick) => void;
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
      className={`group relative flex flex-col gap-2 rounded-card border bg-panel p-3 shadow-card transition-[border-color,box-shadow,opacity] duration-150 has-[a:focus-visible]:border-accent/60 ${
        draggable ? 'cursor-grab active:cursor-grabbing' : ''
      } ${
        dragging
          ? 'border-dashed border-accent opacity-45 shadow-none'
          : 'border-line hover:border-line-strong hover:shadow-raised'
      } ${busy ? 'opacity-60' : ''}`}
    >
      <div className="flex min-w-0 items-center gap-1.5 text-caption text-dim">
        <span className="inline-flex shrink-0 items-center" title={type.tip}>
          <TypeIcon size={14} className={TYPE_TONE[ticket.type]} />
          <span className="sr-only">{type.word}</span>
        </span>
        <span className="truncate font-mono text-micro tracking-tight tabular-nums">
          {ticket.key}
        </span>
        <span className="flex-1" />
        <Priority priority={ticket.priority} />
      </div>

      <a
        id={`ticket-${ticket.id}`}
        href={href.ticket(ticket)}
        draggable={false}
        className="leading-snug font-medium break-words text-ink no-underline decoration-line-strong underline-offset-2 transition-colors hover:text-accent"
      >
        {ticket.title}
      </a>

      {ticket.labels.length > 0 || ticket.type !== 'feature' ? (
        <ul className="flex flex-wrap gap-1" aria-label="Labels">
          {ticket.type !== 'feature' ? (
            <li className={`${CHIP} border-transparent bg-sunken`}>{type.word}</li>
          ) : null}
          {ticket.labels.map((l) => (
            <li key={l} className={`${CHIP} border-line`}>
              {l}
            </li>
          ))}
        </ul>
      ) : null}

      {/* RL-H: the ticket's own run options, when they differ from the project's. */}
      <RunOptionsBadge ticket={ticket} />

      {ticket.needsYou > 0 ? (
        <p
          data-testid="needs-you"
          className="inline-flex h-5 items-center gap-1 self-start rounded-full border border-warning/25 bg-warning-soft px-2 text-caption font-medium text-warning"
        >
          <AlertIcon size={12} strokeWidth={2} />
          {C.needsYou(ticket.needsYou)}
        </p>
      ) : null}

      {running && (ticket.activeHelpers > 0 || ticket.budgetTokensUsed !== null) ? (
        <p
          className="flex flex-wrap items-center gap-x-1.5 text-caption text-dim"
          data-testid="card-run"
        >
          {ticket.activeHelpers > 0 ? (
            <span className="inline-flex items-center gap-1">
              <HelpersIcon size={12} />
              {C.helpers(ticket.activeHelpers)}
            </span>
          ) : null}
          {ticket.activeHelpers > 0 && ticket.budgetTokensUsed !== null ? (
            <span aria-hidden="true" className="text-line-strong">
              ·
            </span>
          ) : null}
          {ticket.budgetTokensUsed !== null ? (
            <span className="inline-flex items-center gap-1">
              <BudgetIcon size={12} />
              <BudgetTokens value={ticket.budgetTokensUsed} />
            </span>
          ) : null}
        </p>
      ) : null}

      {(ticket.lastRunOutcome !== null && !running) || ticket.latestEstimatedCost !== null ? (
        <p className="flex flex-wrap items-center gap-x-1.5 text-caption text-dim">
          {ticket.lastRunOutcome !== null && !running ? (
            <span className={ticket.lastRunOutcome === 'failed' ? 'font-medium text-danger' : ''}>
              {C.lastRun[ticket.lastRunOutcome]}
            </span>
          ) : null}
          {ticket.lastRunOutcome !== null && !running && ticket.latestEstimatedCost !== null ? (
            <span aria-hidden="true" className="text-line-strong">
              ·
            </span>
          ) : null}
          {ticket.latestEstimatedCost !== null ? (
            <LatestCost cost={ticket.latestEstimatedCost} />
          ) : null}
        </p>
      ) : null}

      <div className="-mx-3 -mb-1 flex items-center gap-2 border-t border-line/70 px-3 pt-2 text-caption text-dim">
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
