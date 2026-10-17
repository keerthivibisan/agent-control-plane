import { useRef, type KeyboardEvent } from 'react';
import { Menu, MenuItem, MenuSeparator } from '../../components/Menu';
import { BOARD_COPY } from '../../lib/copy';
import { MoveIcon, STAGE_ICON, StartIcon } from './icons';
import type { MoveTarget } from './moves';

const C = BOARD_COPY.move;

const LABEL: Record<MoveTarget, string> = {
  BACKLOG: C.toBacklog,
  READY: C.toReady,
  PLANNING: C.start,
  CANCELLED: C.cancel,
};

function TargetIcon({ target }: { target: MoveTarget }) {
  if (target === 'PLANNING') return <StartIcon size={14} />;
  const { Icon } = STAGE_ICON[target];
  return <Icon size={14} />;
}

/**
 * Arrow keys wrap from the last item to the first and back, as the board's menu always did; the
 * shared Menu (Radix) stops at the ends, so the wrap is added here. Radix has already handled the
 * key (and found nothing further to focus) when the event bubbles up to this wrapper.
 */
function wrapAround(e: KeyboardEvent<HTMLDivElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  const at = items.findIndex((el) => el === document.activeElement);
  if (e.key === 'ArrowDown' && at === items.length - 1) items[0]?.focus();
  else if (e.key === 'ArrowUp' && at === 0) items[items.length - 1]?.focus();
}

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
  const buttonRef = useRef<HTMLButtonElement>(null);
  if (moves.length === 0) return null;
  const open = moves.filter((m) => m !== 'CANCELLED');
  const pick = (target: MoveTarget) => {
    // Focus goes back to the button first, so a dialog opened by the pick (cancel asks first)
    // returns focus there when it closes.
    buttonRef.current?.focus();
    onPick(target);
  };
  return (
    <Menu
      label={C.menuLabel(ticketKey)}
      align="end"
      trigger={
        <button
          ref={buttonRef}
          type="button"
          aria-label={C.menuLabel(ticketKey)}
          disabled={disabled}
          className="relative inline-flex h-6 items-center gap-1 rounded-control px-1.5 text-caption font-medium text-dim transition-colors hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 aria-expanded:bg-hover aria-expanded:text-ink"
        >
          <MoveIcon size={13} />
          {C.button}
        </button>
      }
    >
      <div role="none" onKeyDown={wrapAround} className="flex flex-col">
        {open.map((target) => (
          <MenuItem
            key={target}
            icon={<TargetIcon target={target} />}
            onSelect={() => pick(target)}
          >
            {LABEL[target]}
          </MenuItem>
        ))}
        {moves.includes('CANCELLED') ? (
          <>
            {open.length > 0 ? <MenuSeparator /> : null}
            <MenuItem
              tone="danger"
              icon={<TargetIcon target="CANCELLED" />}
              onSelect={() => pick('CANCELLED')}
            >
              {LABEL.CANCELLED}
            </MenuItem>
          </>
        ) : null}
      </div>
    </Menu>
  );
}
