import type { TicketStage } from '@acp/core';
import type { TicketCardDto } from '@acp/core/api';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type DragEvent, type RefObject } from 'react';
import { ChevronRightIcon } from '../../components/icons';
import { InfoTip } from '../../components/InfoTip';
import { TRANSITION } from '../../components/motion';
import { BOARD_COPY, STAGE_COPY } from '../../lib/copy';
import { formatCount } from '../../lib/format';
import { STAGE_ICON } from './icons';
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
          : 'outline-1 -outline-offset-1 outline-dashed outline-accent/60'
        : '';
  // Columns that refuse the dragged card dim (through Motion, which owns the opacity).
  const dimmed = dragging !== null && !accepts && dragging.stage !== stage;
  return { handlers, tone, dimmed };
}

/** A column's count: a small round badge, read out as "3 tickets" where it is named. */
function CountBadge({ count, label }: { count: number; label?: string }) {
  return (
    <span
      className="inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full border border-line bg-panel px-1.5 text-micro font-medium text-dim tabular-nums"
      {...(label ? { 'aria-label': label } : { 'aria-hidden': true })}
    >
      {formatCount(count)}
    </span>
  );
}

function ColumnHeader({ stage, count }: { stage: TicketStage; count: number }) {
  const s = STAGE_COPY[stage];
  const { Icon, tone } = STAGE_ICON[stage];
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Icon size={15} strokeWidth={2} className={`shrink-0 ${tone}`} />
      <span className="truncate font-medium tracking-[-0.006em]">{s.word}</span>
      <CountBadge count={count} label={C.count(count)} />
      <InfoTip tip={s.tip} label={s.word} />
    </span>
  );
}

/** Columns and rails share one surface: a quiet well under the cards. */
const SURFACE =
  'rounded-card border border-line/60 bg-sunken/80 transition-[background-color,outline-color] duration-150';

/**
 * Motion for a column or a rail: it slides to its new place when a neighbour folds or unfolds,
 * and one that appears after the first paint (an unfolded rail, a folded column) fades in
 * (the row's AnimatePresence skips the first paint).
 * Reduced motion turns both off (MotionConfig in main.tsx).
 */
function columnMotion(stage: TicketStage, dimmed: boolean) {
  return {
    layout: 'position' as const,
    layoutId: `board-column-${stage}`,
    transition: TRANSITION.base,
    initial: { opacity: 0 },
    animate: { opacity: dimmed ? 0.4 : 1 },
  };
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
  const { handlers, tone, dimmed } = useDropTarget(column.stage, drop);
  const s = STAGE_COPY[column.stage];
  const { Icon } = STAGE_ICON[column.stage];
  return (
    <motion.section
      aria-label={s.word}
      data-testid={`column-${column.stage}`}
      data-tickets={column.tickets.length}
      {...handlers}
      {...columnMotion(column.stage, dimmed)}
      className={`group/column flex w-[17rem] shrink-0 flex-col ${SURFACE} ${tone}`}
    >
      <header className="flex h-10 shrink-0 items-center gap-2 pr-1.5 pl-3">
        <h2 className="min-w-0 flex-1 text-body">
          <ColumnHeader stage={column.stage} count={column.tickets.length} />
        </h2>
        {onCollapse ? (
          <button
            type="button"
            onClick={onCollapse}
            aria-label={C.hideLabel(s.word)}
            className="inline-flex h-6 items-center rounded-control px-1.5 text-caption font-medium text-dim opacity-0 transition-[opacity,background-color,color] duration-150 group-hover/column:opacity-100 hover:bg-hover hover:text-ink focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
          >
            {C.hide}
          </button>
        ) : null}
      </header>
      <ol className="flex flex-1 flex-col gap-2 px-2 pb-2">
        {column.tickets.map((t) => (
          // A card that changes column glides from its old place (same layoutId).
          <motion.li
            key={t.id}
            layout="position"
            layoutId={`board-ticket-${t.id}`}
            initial={false}
            transition={TRANSITION.base}
          >
            <TicketCard
              ticket={t}
              busy={busyId === t.id}
              dragging={drop.dragging?.id === t.id}
              onMove={onMove}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          </motion.li>
        ))}
        {column.tickets.length === 0 ? (
          <li className="flex flex-col items-center gap-2 rounded-control border border-dashed border-line-strong px-4 py-6 text-center text-caption text-dim">
            <Icon size={16} className="opacity-60" />
            {s.empty}
          </li>
        ) : null}
      </ol>
    </motion.section>
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
  const { handlers, tone, dimmed } = useDropTarget(column.stage, drop);
  const s = STAGE_COPY[column.stage];
  const { Icon, tone: iconTone } = STAGE_ICON[column.stage];
  const n = column.tickets.length;
  return (
    <motion.section
      aria-label={s.word}
      data-testid={`column-${column.stage}`}
      data-collapsed="true"
      data-tickets={n}
      {...handlers}
      {...columnMotion(column.stage, dimmed)}
      className={`flex w-10 shrink-0 flex-col ${SURFACE} ${tone}`}
    >
      <button
        type="button"
        onClick={onExpand}
        aria-label={C.show(s.word, n)}
        title={n === 0 ? `${s.word}: ${s.empty}` : s.tip}
        className="flex flex-1 flex-col items-center gap-2.5 rounded-card px-1 py-3 text-dim transition-colors duration-150 hover:bg-hover hover:text-ink"
      >
        <Icon size={15} strokeWidth={2} className={n === 0 ? 'opacity-70' : iconTone} />
        <CountBadge count={n} />
        <span
          className="text-caption font-medium tracking-[-0.006em] [writing-mode:vertical-rl]"
          aria-hidden="true"
        >
          {s.word}
        </span>
      </button>
    </motion.section>
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
        className={`pointer-events-auto inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-line-strong bg-panel-raised text-caption font-medium text-ink shadow-raised transition-colors duration-150 hover:border-accent/60 hover:text-accent ${
          count ? 'pr-1.5 pl-2.5' : 'px-1.5'
        }`}
      >
        {count ? <span className="whitespace-nowrap">{count}</span> : null}
        <ChevronRightIcon size={15} className={back ? 'rotate-180' : ''} />
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
  // Show and Hide swap the column for its rail (and back), so the button that had focus goes
  // away; focus moves to the one that replaced it, so a keyboard user keeps their place.
  const refocus = useRef<{ stage: TicketStage; open: boolean } | null>(null);
  const toggle = (stage: TicketStage, open: boolean) => {
    const column = scroller.current?.querySelector(`[data-testid="column-${stage}"]`);
    refocus.current = column?.contains(document.activeElement) === true ? { stage, open } : null;
    setOpened((prev) => {
      const next = new Set(prev);
      if (open) next.add(stage);
      else next.delete(stage);
      return next;
    });
  };
  useEffect(() => {
    const want = refocus.current;
    if (want === null) return;
    refocus.current = null;
    const word = STAGE_COPY[want.stage].word;
    const column = scroller.current?.querySelector(`[data-testid="column-${want.stage}"]`);
    const target = want.open
      ? column?.querySelector<HTMLElement>(`button[aria-label="${C.hideLabel(word)}"]`)
      : column?.querySelector<HTMLElement>('button');
    target?.focus();
  }, [opened]);
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
      <motion.div
        ref={scroller}
        layoutScroll
        className="relative -mx-1 overflow-x-auto px-1 pt-1 pb-4"
        data-testid="board-columns"
      >
        <div className="flex min-h-[28rem] items-stretch gap-2.5">
          {/* initial={false}: on first paint nothing fades; a column that appears later does. */}
          <AnimatePresence initial={false}>
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
          </AnimatePresence>
        </div>
      </motion.div>
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
