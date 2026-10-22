import * as RadixMenu from '@radix-ui/react-dropdown-menu';
import { useState, type MouseEvent, type ReactNode } from 'react';
import { buttonClass } from '../../components/Button';
import { CheckIcon, ChevronDownIcon } from '../../components/icons';
import { floatingClass, MenuLabel } from '../../components/Menu';
import { REVIEW_PAGE_COPY } from './copy';

const P = REVIEW_PAGE_COPY.picker;

/** One helper's change in the picker: its agent run, its helper's role, and its state word. */
export interface ChangeOption {
  id: string;
  role: string;
  /** The change's state (a chip), or null when the run doesn't say. */
  state: ReactNode;
  /** Its files' count line, or null when unknown. */
  files: string | null;
}

/** "All changes" in the picker's value. */
export const ALL_CHANGES = '';

const itemClass =
  'flex cursor-default items-start gap-2 rounded-control px-2 py-1.5 text-ink outline-none select-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent focus-visible:outline-solid data-[highlighted]:bg-hover';

/**
 * GitHub's "Changes from" menu on Files changed (v0.3.0 C-D): all changes (the ticket branch, base
 * → tip) or one helper's change. A menu of `menuitemradio`s (Radix DropdownMenu, like the theme
 * menu): arrows move, Enter or Space choose, Escape closes it to the button, the chosen one is
 * checked. `allowAll` is false when the run has no ticket branch (a run before the review loop).
 */
export function ChangePicker({
  options,
  value,
  allowAll,
  onChange,
}: {
  options: readonly ChangeOption[];
  /** The chosen change's id, or `ALL_CHANGES`. */
  value: string;
  allowAll: boolean;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const chosen = options.find((o) => o.id === value);
  const word = chosen !== undefined ? P.change(chosen.role) : P.all;
  return (
    <RadixMenu.Root open={open} onOpenChange={setOpen} modal={false}>
      <RadixMenu.Trigger
        asChild
        // Radix opens on pointerdown and keys; a click with no pointer (assistive tech,
        // `element.click()`) toggles it too.
        onClick={(e: MouseEvent) => {
          if (e.detail === 0) setOpen((o) => !o);
        }}
      >
        <button
          type="button"
          className={`${buttonClass('secondary', 'sm')} max-w-full min-w-0`}
          aria-label={P.button(word)}
          title={P.button(word)}
          data-testid="change-picker"
          data-value={value}
        >
          <span className="hidden text-dim sm:inline">{P.label}</span>
          <span className="min-w-0 truncate">{word}</span>
          <ChevronDownIcon size={14} className="text-dim" />
        </button>
      </RadixMenu.Trigger>
      <RadixMenu.Portal>
        <RadixMenu.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          loop
          aria-label={P.menu}
          aria-labelledby={undefined}
          data-testid="change-picker-menu"
          className={`${floatingClass} flex max-h-[min(28rem,70vh)] w-80 max-w-[calc(100vw-2rem)] flex-col overflow-y-auto p-2 focus:outline-none`}
        >
          <MenuLabel>{P.menu}</MenuLabel>
          <RadixMenu.RadioGroup value={value} onValueChange={onChange}>
            {allowAll ? (
              <RadixMenu.RadioItem
                value={ALL_CHANGES}
                className={itemClass}
                data-testid="change-option-all"
              >
                <Indicator />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{P.all}</span>
                  <span className="block text-caption text-dim">{P.allHint}</span>
                </span>
              </RadixMenu.RadioItem>
            ) : null}
            {options.map((o) => (
              <RadixMenu.RadioItem
                key={o.id}
                value={o.id}
                className={itemClass}
                data-testid="change-option"
                data-agent={o.id}
              >
                <Indicator />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate font-medium">{P.change(o.role)}</span>
                  {o.state !== null || o.files !== null ? (
                    <span className="flex flex-wrap items-center gap-2 text-caption text-dim">
                      {o.state}
                      {o.files !== null ? <span className="tabular-nums">{o.files}</span> : null}
                    </span>
                  ) : null}
                </span>
              </RadixMenu.RadioItem>
            ))}
          </RadixMenu.RadioGroup>
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  );
}

function Indicator() {
  return (
    <span className="flex h-5 w-4 shrink-0 items-center justify-center text-accent">
      <RadixMenu.ItemIndicator>
        <CheckIcon size={16} />
      </RadixMenu.ItemIndicator>
    </span>
  );
}
