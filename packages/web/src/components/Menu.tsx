import * as RadixMenu from '@radix-ui/react-dropdown-menu';
import { useState, type MouseEvent, type ReactElement, type ReactNode } from 'react';

/** The floating surface menus and popovers share. */
export const floatingClass =
  'z-50 rounded-card border border-line bg-panel-raised text-ink shadow-pop data-[state=open]:animate-pop-in';

/**
 * A menu button (Radix DropdownMenu): `role="menu"` with `menuitem`s; ArrowDown, Enter or Space on
 * the trigger opens it with the first item focused, arrows and Home/End move, typing jumps to an
 * item, Escape closes it and focus returns to the trigger. With `loop`, the arrows wrap from the
 * last item to the first and back.
 *
 * `trigger` is the button element (it gets `aria-haspopup`, `aria-expanded` and Radix's
 * `data-state`, so it must not carry the app's own `data-state`). Not modal by default: the rest
 * of the page stays readable to assistive tech while the menu is open.
 */
export function Menu({
  trigger,
  children,
  label,
  align = 'start',
  side = 'bottom',
  modal = false,
  loop = false,
  testId,
  className = '',
}: {
  trigger: ReactElement;
  children: ReactNode;
  /** Accessible name of the menu; by default it is named by its trigger. */
  label?: string;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  modal?: boolean;
  /** Arrow keys wrap at the ends. */
  loop?: boolean;
  testId?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <RadixMenu.Root open={open} onOpenChange={setOpen} modal={modal}>
      <RadixMenu.Trigger
        asChild
        // Radix opens on pointerdown and on keys. A click with no pointer behind it (detail 0:
        // assistive tech, `element.click()`) opens it too.
        onClick={(e: MouseEvent) => {
          if (e.detail === 0) setOpen((o) => !o);
        }}
      >
        {trigger}
      </RadixMenu.Trigger>
      <RadixMenu.Portal>
        <RadixMenu.Content
          align={align}
          side={side}
          sideOffset={4}
          collisionPadding={8}
          loop={loop}
          data-testid={testId}
          {...(label ? { 'aria-label': label, 'aria-labelledby': undefined } : {})}
          className={`${floatingClass} flex min-w-56 flex-col p-1 focus:outline-none ${className}`}
        >
          {children}
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  );
}

const itemClass =
  'flex cursor-default items-center gap-2 rounded-control px-2.5 py-1.5 outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-hover';

/** One choice in a `Menu`. `tone="danger"` for a destructive one (cancel, delete). */
export function MenuItem({
  children,
  onSelect,
  tone = 'default',
  disabled = false,
  icon,
  hint,
  testId,
}: {
  children: ReactNode;
  onSelect: () => void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  /** A decorative icon before the label. */
  icon?: ReactNode;
  /** Secondary text after the label (a shortcut, a folder). */
  hint?: ReactNode;
  testId?: string;
}) {
  return (
    <RadixMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      data-testid={testId}
      className={`${itemClass} ${tone === 'danger' ? 'text-danger' : 'text-ink'}`}
    >
      {icon ? <span className="flex shrink-0 text-dim">{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint ? <span className="ml-3 shrink-0 text-caption text-dim">{hint}</span> : null}
    </RadixMenu.Item>
  );
}

/** A small heading over a group of items. */
export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <RadixMenu.Label className="px-2.5 pt-2 pb-1 text-caption font-medium text-dim">
      {children}
    </RadixMenu.Label>
  );
}

export function MenuSeparator() {
  return <RadixMenu.Separator className="-mx-1 my-1 h-px bg-line" />;
}

export const MenuGroup = RadixMenu.Group;
