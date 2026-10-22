import type { WorkflowEdgeType } from '@acp/core';
import { useCallback, useState } from 'react';
import { buttonClass } from '../../../components/Button';
import { Popover } from '../../../components/Popover';
import { WORKFLOW_GRAPH_COPY } from '../../../lib/copy';
import { HelpIcon, LegendIcon, YouIcon } from '../icons';
import { EDITOR_COPY } from './copy';
import { LinkSample } from './edges';

const G = WORKFLOW_GRAPH_COPY;
const L = EDITOR_COPY.legend;
const T = EDITOR_COPY.toolbar;
const LINKS: readonly WorkflowEdgeType[] = [
  'flow',
  'assigns',
  'review',
  'findings',
  'rework',
  'merge',
];
const STORAGE_KEY = 'acp.workflow.legend';

/** Whether the legend is shown, remembered in this browser (every access guarded). */
export function useLegendOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpenState] = useState(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) !== 'hidden';
    } catch {
      return true;
    }
  });
  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    try {
      if (next) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, 'hidden');
    } catch {
      // No storage: the choice lasts for this page.
    }
  }, []);
  return [open, setOpen];
}

/** The legend's toggle, for the canvas toolbar. */
export function LegendToggle({
  open,
  onChange,
}: {
  open: boolean;
  onChange: (open: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={`${buttonClass('quiet', 'sm')} ${open ? 'text-ink' : ''}`}
      aria-expanded={open}
      aria-controls="workflow-legend"
      title={open ? T.hideLegend : T.showLegend}
      onClick={() => onChange(!open)}
      data-testid="legend-toggle"
    >
      <LegendIcon size={14} />
      {T.legend}
    </button>
  );
}

/** "How this works": three plain sentences in a popover. */
export function HowItWorks() {
  return (
    <Popover
      label={T.how}
      align="end"
      testId="how-it-works"
      trigger={
        <button
          type="button"
          className={buttonClass('quiet', 'sm')}
          data-testid="how-it-works-button"
        >
          <HelpIcon size={14} />
          {T.how}
        </button>
      }
    >
      <p className="mb-2 font-semibold">{T.how}</p>
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-caption text-ink">
        {T.howSentences.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </Popover>
  );
}

/** A tiny drawing of a block's shape, for the legend. */
function Shape({ kind }: { kind: 'agent' | 'lead' | 'step' }) {
  const cls =
    kind === 'step'
      ? 'h-3 w-5 rounded-full border border-line-strong bg-subtle'
      : kind === 'lead'
        ? 'h-3.5 w-5 rounded-[2px] border-[1.5px] border-ink/80 bg-panel'
        : 'h-3.5 w-5 rounded-[2px] border border-line-strong bg-panel';
  return <span aria-hidden="true" className={`inline-block shrink-0 ${cls}`} />;
}

/**
 * The legend: the block shapes and the six kinds of link, in short words, on one or two compact
 * lines under the canvas. The full sentence for each kind is in the link's panel.
 */
export function Legend() {
  return (
    <div
      id="workflow-legend"
      className="flex flex-wrap items-center gap-x-6 gap-y-2 text-caption text-dim"
      data-testid="workflow-legend"
    >
      <ul className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5" aria-label={L.blocks}>
        <li className="flex items-center gap-1.5">
          <Shape kind="agent" />
          {L.agent}
        </li>
        <li className="flex items-center gap-1.5">
          <Shape kind="lead" />
          {L.lead}
        </li>
        <li className="flex items-center gap-1.5">
          <Shape kind="step" />
          {L.step}
        </li>
        <li className="flex items-center gap-1.5">
          <YouIcon size={13} className="shrink-0 text-accent" />
          {L.you}
        </li>
      </ul>
      <ul className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5" aria-label={L.links}>
        {LINKS.map((t) => (
          <li key={t} className="flex items-center gap-1.5" title={G.edges[t]}>
            <LinkSample type={t} width={24} />
            {L.edges[t]}
          </li>
        ))}
      </ul>
    </div>
  );
}
