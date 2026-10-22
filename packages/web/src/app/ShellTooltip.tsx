import * as RadixTooltip from '@radix-ui/react-tooltip';
import { useState, type ReactElement, type ReactNode } from 'react';

/*
 * Tooltips for the shell's icon controls: the rail's entries (to the right of the icon), the
 * sidebar toggle and the top bar's buttons. They need a side and an edge-aware position, which the
 * shared Tooltip (always centred above or below) can't give an icon at the screen edge, so these use
 * Radix Tooltip, styled like the shared bubble. Only hover and keyboard focus open them: they
 * repeat a name the control already has, and never carry information of their own (except the
 * theme tip, which was the button's `title`).
 */

/** Wraps the shell so moving along the rail shows the next label at once. */
export function ShellTooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={150} skipDelayDuration={400}>
      {children}
    </RadixTooltip.Provider>
  );
}

export function ShellTooltip({
  content,
  children,
  side = 'right',
  align = 'center',
  describe = false,
  disabled = false,
  wrapperClassName = 'flex',
}: {
  content: ReactNode;
  /** The control: one element that takes a ref (a link, a button, a focusable span). */
  children: ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /**
   * Whether the control is `aria-describedby` the tip while it is open. Off when the tip only
   * repeats the control's own name (a rail entry), so screen readers don't hear it twice: the tip
   * then hangs on a plain wrapper around the control (focus inside it still opens the tip).
   */
  describe?: boolean;
  /** Never opens (the label is on screen). The tree stays the same, so focus is kept. */
  disabled?: boolean;
  /** Layout of that wrapper (`describe` false). */
  wrapperClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <RadixTooltip.Root open={open && !disabled} onOpenChange={setOpen}>
      <RadixTooltip.Trigger asChild>
        {describe ? children : <span className={wrapperClassName}>{children}</span>}
      </RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          align={align}
          sideOffset={8}
          collisionPadding={8}
          className="z-[60] flex max-w-72 animate-fade-in items-center gap-2 rounded-control bg-tooltip px-2 py-1 text-caption leading-[1.125rem] text-tooltip-ink shadow-pop select-none"
        >
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

/** A shortcut inside a tooltip, e.g. ⌘B. */
export function TipKey({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-[4px] border border-current/25 px-1 font-sans text-micro leading-4 opacity-80">
      {children}
    </kbd>
  );
}
