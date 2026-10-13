import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { BOARD_COPY } from '../../lib/copy';
import { MoveIcon } from './icons';
import type { MoveTarget } from './moves';

const C = BOARD_COPY.move;

const LABEL: Record<MoveTarget, string> = {
  BACKLOG: C.toBacklog,
  READY: C.toReady,
  PLANNING: C.start,
  CANCELLED: C.cancel,
};

/**
 * The keyboard alternative to dragging (README §5.2): a "Move" button opening a menu of the moves
 * the owner may make from this card. Arrow keys move between items, Enter picks, Escape closes and
 * puts focus back on the button.
 */
export function MoveMenu({
  ticketKey,
  moves,
  disabled,
  onPick,
}: {
  ticketKey: string;
  moves: readonly MoveTarget[];
  disabled: boolean;
  onPick: (target: MoveTarget) => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  useEffect(() => {
    if (open) itemsRef.current[0]?.focus();
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  const onMenuKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const items = itemsRef.current.filter((el): el is HTMLButtonElement => el !== null);
    const at = items.findIndex((el) => el === document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      (e.key === 'Home' ? items[0] : items[items.length - 1])?.focus();
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  if (moves.length === 0) return null;
  return (
    <div
      className="relative"
      onBlur={(e) => {
        // Close when focus leaves the button and the menu (a click elsewhere, or Tab away).
        if (open && !e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={C.menuLabel(ticketKey)}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 text-caption text-dim hover:bg-sunken hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
      >
        <MoveIcon size={14} />
        {C.button}
      </button>
      {open ? (
        <ul
          id={menuId}
          role="menu"
          aria-label={C.menuLabel(ticketKey)}
          onKeyDown={onMenuKey}
          className="absolute top-full right-0 z-20 mt-1 flex min-w-56 flex-col rounded-control border border-line bg-panel py-1 shadow-pop"
        >
          {moves.map((target, i) => (
            <li key={target} role="none">
              <button
                ref={(el) => {
                  itemsRef.current[i] = el;
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  close(true);
                  onPick(target);
                }}
                className={`w-full px-3 py-1.5 text-left hover:bg-sunken focus-visible:bg-sunken focus-visible:-outline-offset-2 ${
                  target === 'CANCELLED' ? 'text-danger' : 'text-ink'
                }`}
              >
                {LABEL[target]}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
