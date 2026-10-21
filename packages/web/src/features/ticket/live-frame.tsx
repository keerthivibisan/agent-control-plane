import type { WorkflowStageState } from '@acp/core/api';
import type { ReactNode } from 'react';
import { Pill, type PillTone } from '../../components/Pill';
import { TICKET_COPY } from '../../lib/copy';

/*
 * The state drawn around a live workflow block (the version 1 stages and the run's graph): a ring
 * while it works or waits for you, and the state's word on top. Working is the brand's lime;
 * warning and danger only for the real states (DESIGN.md, "Agent views").
 */

export const STATE_TONE: Record<WorkflowStageState, PillTone> = {
  off: 'neutral',
  waiting: 'neutral',
  active: 'accent',
  'needs-you': 'warning',
  done: 'success',
  failed: 'danger',
  skipped: 'neutral',
};

// A 1.5px state outline just outside the square node, with a soft halo; the graph's own
// background (`canvas`) shows between them. Working is the brand's lime (an olive line with a lime
// halo on ivory, lime on graphite); warning and danger only for the real states.
export const STATE_RING: Record<WorkflowStageState, string> = {
  off: '',
  waiting: '',
  active:
    'outline-[1.5px] outline-offset-2 outline-accent-fill-edge outline-solid shadow-[0_0_0_6px_color-mix(in_srgb,var(--color-accent-fill)_45%,transparent)] dark:shadow-[0_0_0_6px_color-mix(in_srgb,var(--color-accent-fill)_14%,transparent)]',
  'needs-you':
    'outline-[1.5px] outline-offset-2 outline-warning outline-solid shadow-[0_0_0_6px_color-mix(in_srgb,var(--color-warning)_14%,transparent)]',
  done: '',
  failed:
    'outline-[1.5px] outline-offset-2 outline-danger outline-solid shadow-[0_0_0_6px_color-mix(in_srgb,var(--color-danger)_12%,transparent)]',
  skipped: '',
};

export const DONE_RING =
  'outline-[1.5px] outline-offset-2 outline-success outline-solid shadow-[0_0_0_6px_color-mix(in_srgb,var(--color-success)_12%,transparent)]';

/** A block with its state: the ring, a faded body while it waits or was skipped, the word on top. */
export function StateFrame({
  state,
  testId,
  word = true,
  ring = STATE_RING[state],
  rounded = 'rounded-[2px]',
  children,
}: {
  state: WorkflowStageState;
  testId: string;
  /** False: no word on top (small steps say only what needs attention). */
  word?: boolean;
  ring?: string;
  rounded?: string;
  children: ReactNode;
}) {
  const faded = state === 'waiting' || state === 'skipped';
  return (
    <div
      className={`relative h-full w-full ${rounded} ${ring}`}
      data-testid={testId}
      data-state={state}
    >
      <div className={`h-full w-full ${faded ? 'opacity-60' : ''}`}>{children}</div>
      {/* "Off" is already on the node itself. */}
      {state === 'off' || !word ? null : (
        <span className="pointer-events-none absolute -top-2.5 right-3 rounded-full bg-panel">
          <Pill tone={STATE_TONE[state]} testId="stage-state-word">
            {TICKET_COPY.workflow.states[state]}
          </Pill>
        </span>
      )}
    </div>
  );
}
