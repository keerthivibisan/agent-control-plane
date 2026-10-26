import * as RadixMenu from '@radix-ui/react-dropdown-menu';
import { floatingClass, MenuItem, MenuLabel } from '../../../components/Menu';
import { EDITOR_COPY } from './copy';
import { LinkSample } from './edges';
import type { LinkChoice } from './linking';

const L = EDITOR_COPY.linkTo;

/**
 * "Link to…" (v0.3.1 P-C): the blocks a link from this block may end on, one item per kind that
 * fits (the block's name, then the kind in short: "Change reviewer · Review"), only what core
 * allows (`linkChoices`). Inside a Radix menu, so the arrows, Home/End, typing and Escape work as
 * in every menu of the app.
 */
export function LinkChoiceItems({
  choices,
  onPick,
}: {
  choices: readonly LinkChoice[];
  onPick: (choice: LinkChoice) => void;
}) {
  if (choices.length === 0) {
    return (
      <MenuItem disabled onSelect={() => undefined} testId="link-to-none">
        {L.none}
      </MenuItem>
    );
  }
  return (
    <>
      {choices.map((c) => (
        <MenuItem
          key={`${c.to}-${c.type}`}
          icon={<LinkSample type={c.type} width={24} />}
          hint={EDITOR_COPY.legend.edges[c.type]}
          onSelect={() => onPick(c)}
          testId={`link-to-${c.to}-${c.type}`}
        >
          {c.label}
        </MenuItem>
      ))}
    </>
  );
}

/**
 * The block's menu on the canvas (a right-click, or the context-menu key or Shift+F10 on a focused
 * block): "Link <block> to…" at the pointer. Focus goes back to the block when it closes.
 */
export function LinkMenuAt({
  at,
  label,
  choices,
  onPick,
  onClose,
  restoreFocus,
}: {
  /** Where it opens, in the canvas frame's pixels. */
  at: { x: number; y: number };
  label: string;
  choices: readonly LinkChoice[];
  onPick: (choice: LinkChoice) => void;
  onClose: () => void;
  restoreFocus: () => void;
}) {
  return (
    <RadixMenu.Root open onOpenChange={(open) => (open ? undefined : onClose())} modal={false}>
      <RadixMenu.Trigger asChild>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute size-px"
          style={{ left: at.x, top: at.y }}
        />
      </RadixMenu.Trigger>
      <RadixMenu.Portal>
        <RadixMenu.Content
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          loop
          aria-label={L.title(label)}
          data-testid="block-menu"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            restoreFocus();
          }}
          className={`${floatingClass} flex max-h-[min(24rem,70vh)] w-72 max-w-[calc(100vw-1rem)] flex-col overflow-y-auto p-2 focus:outline-none`}
        >
          <MenuLabel>{L.title(label)}</MenuLabel>
          <LinkChoiceItems choices={choices} onPick={onPick} />
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  );
}
