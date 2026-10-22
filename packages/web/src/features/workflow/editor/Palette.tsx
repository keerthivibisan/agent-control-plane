import type { WorkflowGraph } from '@acp/core';
import * as RadixMenu from '@radix-ui/react-dropdown-menu';
import { useState, type Dispatch, type MouseEvent } from 'react';
import { buttonClass } from '../../../components/Button';
import { ChevronDownIcon, PlusSmallIcon } from '../../../components/icons';
import { floatingClass } from '../../../components/Menu';
import { WORKFLOW_GRAPH_COPY, type PaletteItemKey } from '../../../lib/copy';
import { ROLE_ICON } from '../icons';
import { EDITOR_COPY } from './copy';
import { paletteAvailability, type EditorAction } from './state';

const P = WORKFLOW_GRAPH_COPY.palette;
const T = EDITOR_COPY.toolbar;

/** The menu's two groups, in the palette's order. */
const GROUPS: readonly { label: string; items: readonly PaletteItemKey[] }[] = [
  { label: T.agents, items: ['planner', 'helper', 'helper-pool'] },
  { label: T.checkers, items: ['change-reviewer', 'final-reviewer', 'tester'] },
];

const ITEM_ICON: Readonly<Record<PaletteItemKey, (typeof ROLE_ICON)['lead']>> = {
  planner: ROLE_ICON.planner,
  helper: ROLE_ICON.helper,
  'helper-pool': ROLE_ICON.helper,
  'change-reviewer': ROLE_ICON.reviewer,
  'final-reviewer': ROLE_ICON.reviewer,
  tester: ROLE_ICON.tester,
};

/**
 * One block the menu can add: its name and, underneath, what it does, or why it can't be added
 * (the workflow already has the most blocks of its kind). A full item is disabled (Radix skips it
 * with the arrows) but stays readable, so the reason is in plain sight rather than in a tooltip.
 */
function AddItem({
  item,
  graph,
  dispatch,
}: {
  item: PaletteItemKey;
  graph: WorkflowGraph;
  dispatch: Dispatch<EditorAction>;
}) {
  const availability = paletteAvailability(graph, item);
  const Icon = ITEM_ICON[item];
  return (
    <RadixMenu.Item
      disabled={!availability.ok}
      onSelect={() => dispatch({ type: 'add', item })}
      data-testid={`palette-${item}`}
      className="group flex cursor-default items-start gap-2.5 rounded-control px-2 py-1.5 outline-none select-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent focus-visible:outline-solid data-[disabled]:cursor-not-allowed data-[highlighted]:bg-hover"
    >
      <span className="mt-0.5 flex shrink-0 text-dim group-data-[disabled]:opacity-60">
        <Icon size={15} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="font-medium text-ink group-data-[disabled]:text-dim">{P.items[item]}</span>
        <span className="text-caption text-dim" data-testid="palette-hint">
          {availability.ok ? P.hints[item] : availability.reason}
        </span>
      </span>
    </RadixMenu.Item>
  );
}

/**
 * "Add block": a menu button over the blocks the owner can add, in two groups (agents; reviewers
 * and testers), each limited by `NODE_CAPABILITIES`. The new block lands in its kind's place and
 * is selected, so its settings open at once.
 */
export function Palette({
  graph,
  dispatch,
}: {
  graph: WorkflowGraph;
  dispatch: Dispatch<EditorAction>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <RadixMenu.Root open={open} onOpenChange={setOpen} modal={false}>
      <RadixMenu.Trigger
        asChild
        // Radix opens on pointerdown and keys; a click with no pointer behind it (assistive tech,
        // `element.click()`) opens it too, as the shared Menu does.
        onClick={(e: MouseEvent) => {
          if (e.detail === 0) setOpen((o) => !o);
        }}
      >
        <button type="button" className={buttonClass('secondary', 'sm')} data-testid="add-block">
          <PlusSmallIcon size={14} />
          {T.addBlock}
          <ChevronDownIcon size={14} className="-mr-0.5 text-dim" />
        </button>
      </RadixMenu.Trigger>
      <RadixMenu.Portal>
        <RadixMenu.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          loop
          aria-label={P.label}
          data-testid="palette"
          className={`${floatingClass} flex w-80 max-w-[calc(100vw-1rem)] flex-col p-2 focus:outline-none`}
        >
          {GROUPS.map((group, i) => (
            <RadixMenu.Group key={group.label}>
              {i > 0 ? <RadixMenu.Separator className="-mx-2 my-2 h-px bg-line" /> : null}
              <RadixMenu.Label className="px-2 pt-1 pb-1 text-caption font-semibold text-dim">
                {group.label}
              </RadixMenu.Label>
              {group.items.map((item) => (
                <AddItem key={item} item={item} graph={graph} dispatch={dispatch} />
              ))}
            </RadixMenu.Group>
          ))}
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  );
}
