import type { TicketStage } from '@acp/core';
import type { TicketCardDto } from '@acp/core/api';
import { useState, type DragEvent } from 'react';
import { InfoTip } from '../../components/InfoTip';
import { BOARD_COPY, STAGE_COPY } from '../../lib/copy';
import { formatCount } from '../../lib/format';
import { canMove, type BoardColumn, type MoveTarget } from './moves';
import { TICKET_DRAG_TYPE, TicketCard } from './TicketCard';

const C = BOARD_COPY.column;

interface DropProps {
  /** The card being dragged, if any. */
  dragging: TicketCardDto | null;
  onDrop: (ticket: TicketCardDto, target: MoveTarget) => void;
}

/** Native HTML5 drop target for one column: accepts only owner-settable moves (README §5.2). */
function useDropTarget(stage: TicketStage, { dragging, onDrop }: DropProps) {
  const [over, setOver] = useState(false);
  const accepts = dragging !== null && canMove(dragging.stage, stage);
  const handlers = {
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (!accepts) return;
      e.preventDefault(); // Allows the drop; without it the browser refuses it.
      e.dataTransfer.dropEffect = 'move';
      if (!over) setOver(true);
    },
    onDragLeave: (e: DragEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      setOver(false);
      if (!accepts || !e.dataTransfer.types.includes(TICKET_DRAG_TYPE)) return;
      e.preventDefault();
      // canMove(…, stage) only holds for MoveTarget stages, so the cast is safe.
      onDrop(dragging, stage as MoveTarget);
    },
  };
  const tone =
    dragging === null
      ? ''
      : accepts
        ? over
          ? 'bg-accent-soft outline-2 -outline-offset-2 outline-accent'
          : 'outline-2 -outline-offset-2 outline-dashed outline-accent/50'
        : dragging.stage === stage
          ? ''
          : 'opacity-50';
  return { handlers, tone, accepts };
}

function ColumnHeader({ stage, count }: { stage: TicketStage; count: number }) {
  const s = STAGE_COPY[stage];
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className="truncate font-semibold">{s.word}</span>
      <InfoTip tip={s.tip} label={s.word} />
      <span
        className="ml-0.5 rounded-full bg-panel px-1.5 text-caption text-dim tabular-nums"
        aria-label={C.count(count)}
      >
        {formatCount(count)}
      </span>
    </span>
  );
}

function Column({
  column,
  busyId,
  drop,
  onMove,
  onDragStart,
  onDragEnd,
  onCollapse,
}: {
  column: BoardColumn;
  busyId: string | null;
  drop: DropProps;
  onMove: (ticket: TicketCardDto, target: MoveTarget) => void;
  onDragStart: (ticket: TicketCardDto) => void;
  onDragEnd: () => void;
  onCollapse?: () => void;
}) {
  const { handlers, tone } = useDropTarget(column.stage, drop);
  const s = STAGE_COPY[column.stage];
  return (
    <section
      aria-label={s.word}
      data-testid={`column-${column.stage}`}
      {...handlers}
      className={`flex w-64 shrink-0 flex-col rounded-card bg-sunken transition-[opacity,background-color] ${tone}`}
    >
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <h2 className="min-w-0 flex-1 text-body">
          <ColumnHeader stage={column.stage} count={column.tickets.length} />
        </h2>
        {onCollapse ? (
          <button
            type="button"
            onClick={onCollapse}
            className="rounded-control px-1.5 py-0.5 text-caption text-dim hover:bg-panel hover:text-ink"
          >
            {C.hideCancelled}
          </button>
        ) : null}
      </header>
      <ol className="flex flex-1 flex-col gap-2 px-2 pb-2">
        {column.tickets.map((t) => (
          <li key={t.id}>
            <TicketCard
              ticket={t}
              busy={busyId === t.id}
              dragging={drop.dragging?.id === t.id}
              onMove={onMove}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          </li>
        ))}
        {column.tickets.length === 0 ? (
          <li className="rounded-control border border-dashed border-line-strong px-3 py-4 text-center text-caption text-dim">
            {s.empty}
          </li>
        ) : null}
      </ol>
    </section>
  );
}

/** Cancelled, folded into a slim strip by default (README §5.2); still a drop target. */
function CollapsedCancelled({
  column,
  drop,
  onExpand,
}: {
  column: BoardColumn;
  drop: DropProps;
  onExpand: () => void;
}) {
  const { handlers, tone } = useDropTarget('CANCELLED', drop);
  return (
    <section
      aria-label={STAGE_COPY.CANCELLED.word}
      data-testid="column-CANCELLED"
      data-collapsed="true"
      {...handlers}
      className={`flex w-12 shrink-0 flex-col items-center rounded-card bg-sunken py-3 transition-[opacity,background-color] ${tone}`}
    >
      <button
        type="button"
        onClick={onExpand}
        className="flex flex-1 flex-col items-center gap-2 rounded-control px-1 py-1 text-dim hover:text-ink"
      >
        <span className="rounded-full bg-panel px-1.5 text-caption tabular-nums" aria-hidden="true">
          {formatCount(column.tickets.length)}
        </span>
        <span className="text-caption font-medium [writing-mode:vertical-rl]">
          {C.showCancelled(column.tickets.length)}
        </span>
      </button>
    </section>
  );
}

/**
 * The board's columns, one per stage, scrolling sideways when they don't fit. Dragging a card
 * highlights the columns it may go to and dims the rest.
 */
export function BoardColumns({
  columns,
  busyId,
  onMove,
}: {
  columns: BoardColumn[];
  busyId: string | null;
  onMove: (ticket: TicketCardDto, target: MoveTarget) => void;
}) {
  const [dragging, setDragging] = useState<TicketCardDto | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const drop: DropProps = {
    dragging,
    onDrop: (ticket, target) => {
      setDragging(null);
      onMove(ticket, target);
    },
  };
  const common = {
    busyId,
    drop,
    onMove,
    onDragStart: setDragging,
    onDragEnd: () => setDragging(null),
  };

  return (
    <div className="relative -mx-1 overflow-x-auto px-1 pt-1 pb-4" data-testid="board-columns">
      <div className="flex min-h-[28rem] items-stretch gap-3">
        {columns.map((column) =>
          column.stage === 'CANCELLED' && !showCancelled ? (
            <CollapsedCancelled
              key={column.stage}
              column={column}
              drop={drop}
              onExpand={() => setShowCancelled(true)}
            />
          ) : (
            <Column
              key={column.stage}
              column={column}
              {...common}
              {...(column.stage === 'CANCELLED'
                ? { onCollapse: () => setShowCancelled(false) }
                : {})}
            />
          ),
        )}
      </div>
    </div>
  );
}
