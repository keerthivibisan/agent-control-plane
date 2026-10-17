import * as RadixPopover from '@radix-ui/react-popover';
import type { ReactElement, ReactNode } from 'react';
import { floatingClass } from './Menu';

/**
 * A small floating panel opened by a button (Radix Popover): richer than a tooltip (it may hold
 * links and controls), lighter than a dialog. The trigger toggles it on click; Escape and a click
 * outside close it and focus returns to the trigger. The content is a `role="dialog"` named by
 * `label`.
 *
 * Uncontrolled unless `open`/`onOpenChange` are given. The trigger gets Radix's `data-state`, so
 * it must not carry the app's own `data-state`.
 */
export function Popover({
  trigger,
  children,
  label,
  open,
  onOpenChange,
  align = 'center',
  side = 'bottom',
  testId,
  className = '',
}: {
  trigger: ReactElement;
  children: ReactNode;
  label: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  testId?: string;
  className?: string;
}) {
  return (
    <RadixPopover.Root
      {...(open !== undefined ? { open } : {})}
      {...(onOpenChange ? { onOpenChange } : {})}
    >
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          align={align}
          side={side}
          sideOffset={6}
          collisionPadding={8}
          aria-label={label}
          data-testid={testId}
          className={`${floatingClass} w-72 max-w-[calc(100vw-1rem)] p-3 focus:outline-none ${className}`}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}

/** A button inside a `Popover` that closes it. */
export const PopoverClose = RadixPopover.Close;
