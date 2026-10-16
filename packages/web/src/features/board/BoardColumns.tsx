import type { TicketStage } from '@acp/core';
import type { TicketCardDto } from '@acp/core/api';
import { useEffect, useRef, useState, type DragEvent, type RefObject } from 'react';
import { ChevronRightIcon } from '../../components/icons';
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
      data-tickets={column.tickets.length}
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
            aria-label={C.hideLabel(s.word)}
            className="rounded-control px-1.5 py-0.5 text-caption text-dim hover:bg-panel hover:text-ink"
          >
            {C.hide}
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

/**
 * A folded column: Cancelled by default, and every empty column, so the columns with tickets fit
 * on screen. Still a drop target; a click unfolds it.
 */
function Rail({
  column,
  drop,
  onExpand,
}: {
  column: BoardColumn;
  drop: DropProps;
  onExpand: () => void;
}) {
  const { handlers, tone } = useDropTarget(column.stage, drop);
  const s = STAGE_COPY[column.stage];
  const n = column.tickets.length;
  return (
    <section
      aria-label={s.word}
      data-testid={`column-${column.stage}`}
      data-collapsed="true"
      data-tickets={n}
      {...handlers}
      className={`flex w-12 shrink-0 flex-col items-center rounded-card bg-sunken py-3 transition-[opacity,background-color] ${tone}`}
    >
      <button
        type="button"
        onClick={onExpand}
        aria-label={C.show(s.word, n)}
        title={n === 0 ? `${s.word}: ${s.empty}` : s.tip}
        className="flex flex-1 flex-col items-center gap-2 rounded-control px-1 py-1 text-dim hover:text-ink"
      >
        <span className="rounded-full bg-panel px-1.5 text-caption tabular-nums" aria-hidden="true">
          {formatCount(n)}
        </span>
        <span className="text-caption font-medium [writing-mode:vertical-rl]" aria-hidden="true">
          {s.word}
        </span>
      </button>
    </section>
  );
}

interface Overflow {
  back: boolean;
  on: boolean;
  /** Tickets in the columns whose middle is past the right edge. */
  hiddenOn: number;
}

const NO_OVERFLOW: Overflow = { back: false, on: false, hiddenOn: 0 };

/**
 * Whether the row scrolls either way, measured on scroll and resize. jsdom has no layout, so
 * there the row never overflows and no hint shows.
 */
function useOverflow(ref: RefObject<HTMLDivElement | null>, shape: string): Overflow {
  const [state, setState] = useState<Overflow>(NO_OVERFLOW);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const measure = () => {
      const max = el.scrollWidth - el.clientWidth;
      const right = el.scrollLeft + el.clientWidth;
      let hiddenOn = 0;
      for (const col of el.querySelectorAll<HTMLElement>('[data-tickets]')) {
        if (col.offsetLeft + col.offsetWidth / 2 > right) hiddenOn += Number(col.dataset.tickets);
      }
      const next = { back: el.scrollLeft > 1, on: el.scrollLeft < max - 1, hiddenOn };
      setState((s) =>
        s.back === next.back && s.on === next.on && s.hiddenOn === next.hiddenOn ? s : next,
      );
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [ref, shape]);
  return state;
}

/**
 * The fade at a hidden edge of the row, with its scroll button. The fade lets drops through; the
 * button also scrolls while a card is dragged over it.
 */
function Edge({
  side,
  label,
  count,
  onScroll,
}: {
  side: 'back' | 'on';
  label: string;
  count?: string | undefined;
  onScroll: (step: number) => void;
}) {
  const back = side === 'back';
  return (
    <div
      className={`pointer-events-none absolute top-0 bottom-4 flex w-20 items-center ${
        back
          ? 'left-0 justify-start bg-gradient-to-r from-canvas to-transparent'
          : 'right-0 justify-end bg-gradient-to-l from-canvas to-transparent'
      }`}
      data-testid={`board-scroll-${side}`}
    >
      <button
        type="button"
        onClick={() => onScroll(back ? -1 : 1)}
        onDragOver={() => onScroll(back ? -0.05 : 0.05)}
        aria-label={count ? `${label} (${count})` : label}
        title={label}
        className="pointer-events-auto inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-line-strong bg-panel px-2 text-caption font-medium text-ink shadow-raised hover:border-accent"
      >
        {count ? <span className="whitespace-nowrap">{count}</span> : null}
        <ChevronRightIcon size={16} className={back ? 'rotate-180' : ''} />
      </button>
    </div>
  );
}

/**
 * The board's columns, one per stage. Empty columns and Cancelled fold into narrow rails; when
 * the rest still doesn't fit, the row scrolls sideways with a fade and a button at each hidden
 * edge, the right one saying how many tickets are out of view. Dragging a card highlights the
 * columns it may go to and dims the rest.
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
  // Folded columns the owner opened.
  const [opened, setOpened] = useState<ReadonlySet<TicketStage>>(new Set());
  const scroller = useRef<HTMLDivElement>(null);
  const toggle = (stage: TicketStage, open: boolean) =>
    setOpened((prev) => {
      const next = new Set(prev);
      if (open) next.add(stage);
      else next.delete(stage);
      return next;
    });
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
  const foldable = (c: BoardColumn) => c.stage === 'CANCELLED' || c.tickets.length === 0;
  const shape = columns
    .map((c) => `${c.stage}:${c.tickets.length}:${opened.has(c.stage) ? 1 : 0}`)
    .join(',');
  const overflow = useOverflow(scroller, shape);
  const scrollBy = (step: number) => {
    const el = scroller.current;
    if (el === null) return;
    const left = Math.round(el.clientWidth * 0.8 * step);
    // A drag-over nudge is small and instant; a click pages smoothly.
    if (Math.abs(step) < 1) el.scrollLeft += left;
    else el.scrollBy({ left, behavior: 'smooth' });
  };

  return (
    <div className="relative">
      <div
        ref={scroller}
        className="relative -mx-1 overflow-x-auto px-1 pt-1 pb-4"
        data-testid="board-columns"
      >
        <div className="flex min-h-[28rem] items-stretch gap-3">
          {columns.map((column) =>
            foldable(column) && !opened.has(column.stage) ? (
              <Rail
                key={column.stage}
                column={column}
                drop={drop}
                onExpand={() => toggle(column.stage, true)}
              />
            ) : (
              <Column
                key={column.stage}
                column={column}
                {...common}
                {...(foldable(column) ? { onCollapse: () => toggle(column.stage, false) } : {})}
              />
            ),
          )}
        </div>
      </div>
      {overflow.back ? <Edge side="back" label={C.scrollBack} onScroll={scrollBy} /> : null}
      {overflow.on ? (
        <Edge
          side="on"
          label={C.scrollOn}
          count={overflow.hiddenOn > 0 ? C.moreTickets(overflow.hiddenOn) : undefined}
          onScroll={scrollBy}
        />
      ) : null}
    </div>
  );
}
