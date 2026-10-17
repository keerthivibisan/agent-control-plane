import type { WorkflowGraph } from '@acp/core';
import type { Dispatch } from 'react';
import { buttonClass } from '../../../components/Button';
import { PlusSmallIcon } from '../../../components/icons';
import { useTooltip } from '../../../components/Tooltip';
import { WORKFLOW_GRAPH_COPY, type PaletteItemKey } from '../../../lib/copy';
import { PALETTE_ITEMS, paletteAvailability, type EditorAction } from './state';

const P = WORKFLOW_GRAPH_COPY.palette;

/**
 * One palette button. When the workflow already has the most blocks of its kind, it stays in the
 * tab order with `aria-disabled` and a tooltip saying why, so the reason can be read by keyboard
 * and by hover (a disabled button gets neither).
 */
function PaletteButton({
  item,
  graph,
  dispatch,
}: {
  item: PaletteItemKey;
  graph: WorkflowGraph;
  dispatch: Dispatch<EditorAction>;
}) {
  const availability = paletteAvailability(graph, item);
  const why = availability.ok ? P.hints[item] : availability.reason;
  const { triggerProps, bubble } = useTooltip(why);
  return (
    <>
      <button
        type="button"
        {...triggerProps}
        aria-disabled={availability.ok ? undefined : true}
        aria-label={P.add(P.items[item])}
        onClick={() => {
          if (availability.ok) dispatch({ type: 'add', item });
        }}
        data-testid={`palette-${item}`}
        className={`${buttonClass('secondary', 'sm')} ${availability.ok ? '' : 'cursor-not-allowed opacity-50'}`}
      >
        <PlusSmallIcon size={14} />
        {P.items[item]}
      </button>
      {bubble}
    </>
  );
}

/** The blocks the owner can add, each limited by `NODE_CAPABILITIES`. */
export function Palette({
  graph,
  dispatch,
}: {
  graph: WorkflowGraph;
  dispatch: Dispatch<EditorAction>;
}) {
  return (
    <div
      role="toolbar"
      aria-label={P.label}
      className="flex flex-wrap items-center gap-1.5"
      data-testid="palette"
    >
      <span className="mr-1 text-caption font-medium text-dim">{P.label}</span>
      {PALETTE_ITEMS.map((item) => (
        <PaletteButton key={item} item={item} graph={graph} dispatch={dispatch} />
      ))}
    </div>
  );
}
