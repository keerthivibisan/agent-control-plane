import type { WorkflowStageId } from '@acp/core';
import type { RunDetailDto } from '@acp/core/api';
import { Button } from '../../components/Button';
import { AlertIcon } from '../../components/icons';
import { continueRun } from '../../lib/api';
import { TICKET_COPY } from '../../lib/copy';
import { ActionError } from '../control/bits';
import { useTicketAction } from './actions';
import { useTicketNav } from './ticket-nav';
import { ACTIVITY_ID } from './ticket-state';

const C = TICKET_COPY.workflow;

/* Parts the live workflow shares between the run's graph and the version 1 stages. */

/** A final stage a restart held: it waits for the owner's Continue (ADR-0021). */
export function HeldNotice({
  runId,
  name,
  stage,
}: {
  runId: string;
  name: string;
  /** The held stage's id (version 1) or block id (the run's graph). */
  stage: string;
}) {
  const go = useTicketAction(continueRun);
  return (
    <div
      role="status"
      data-testid="held-stage"
      data-stage={stage}
      className="mx-5 mb-4 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-control border border-warning/30 bg-warning-soft px-4 py-3"
    >
      <AlertIcon size={16} className="shrink-0 self-start text-warning" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-ink">{C.held.title(name)}</p>
        <p className="text-dim">{C.held.text(name)}</p>
      </div>
      <Button variant="primary" disabled={go.pending} onClick={() => void go.run(runId)}>
        {go.pending ? C.held.pending : C.held.action}
      </Button>
      {go.error ? (
        <div className="basis-full">
          <ActionError error={go.error} message={C.held.failed} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Reviewer findings on this run: a button to them (the hash is the app's route). On the ticket
 * page they are on the Conversation tab (v0.3.0 C-B, ADR-0026), which it opens first.
 */
export function ReviewerFindingsLink({ count }: { count: number }) {
  const nav = useTicketNav();
  return (
    <button
      type="button"
      className="w-fit text-left text-accent hover:underline"
      data-testid="reviewer-findings-link"
      onClick={() =>
        nav !== null
          ? nav.goTo('conversation', ACTIVITY_ID)
          : document.getElementById(ACTIVITY_ID)?.scrollIntoView?.({ behavior: 'smooth' })
      }
    >
      {C.reviewerComments(count)}
    </button>
  );
}

export interface LiveWorkflowProps {
  run: RunDetailDto;
  projectId: string;
  /** Reviewer findings on this run (ticket comments by `reviewer`). */
  reviewerComments: number;
  onSelectAgent: (agentId: string, stage: WorkflowStageId) => void;
}
