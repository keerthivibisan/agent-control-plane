import type {
  RunDetailDto,
  TicketBranchDto,
  TicketBranchReviewDto,
  TicketDto,
} from '@acp/core/api';
import { Button } from '../../components/Button';
import { AlertIcon } from '../../components/icons';
import { ticketBranchAction } from '../../lib/api';
import { REVIEW_LOOP_COPY } from '../../lib/copy';
import { useCodeHost } from '../branching/CodeHostCard';
import { hasNewCommits, pushBlockedReason } from '../branching/code-host';
import { PullRequestInfo, PushAndOpenPr, PushNewCommits } from '../branching/PullRequest';
import { ActionError, ConfirmAction } from '../control/bits';
import { useTicketAction } from '../ticket/actions';
import { checksSummary, type TicketBranchMode } from './logic';
import { ReasonForm } from './ReasonForm';

const B = REVIEW_LOOP_COPY.branch;
const MAX_REASON = 500;
const MAX_COMMENT = 8000;

export type FinalStepTicket = Pick<TicketDto, 'id' | 'key' | 'title' | 'projectId'>;

/**
 * Push & open PR beside the merge, for a run of a ticket (ADR-0025): the project's GitHub status
 * is read here, so it is asked for only when the owner's final step is on screen.
 */
function PushAction({
  ticket,
  branch,
  disabled,
}: {
  ticket: FinalStepTicket;
  branch: TicketBranchDto;
  disabled: boolean;
}) {
  const host = useCodeHost(ticket.projectId);
  return (
    <PushAndOpenPr
      ticket={ticket}
      branch={branch.branch}
      target={branch.baseBranch}
      blockedReason={pushBlockedReason(host.data, host.error)}
      disabled={disabled}
    />
  );
}

/**
 * The owner's final step (ADR-0021 §4, ADR-0025 §4): Merge into the target (or merge anyway past
 * a failed required check, with a reason), or Push & open PR for a ticket; Request changes (a
 * comment for the lead; the run goes on); Discard; and Update from the target when it moved. Each
 * asks first; the server checks again. While a pull request is open on GitHub, the merge happens
 * there: only Request changes and Discard stay, with Push new commits when the branch moved on
 * since the last push (G-D).
 */
function Actions({
  run,
  branch,
  review,
  ticket,
}: {
  run: Pick<RunDetailDto, 'id'>;
  branch: TicketBranchDto;
  review: TicketBranchReviewDto | undefined;
  ticket: FinalStepTicket | null;
}) {
  const act = useTicketAction(ticketBranchAction);
  const checks = checksSummary(review?.checks ?? []);
  const base = branch.baseBranch;
  const prOpen = branch.pullRequest?.state === 'open';
  return (
    <div className="flex flex-col gap-2.5" data-testid="branch-actions">
      {prOpen ? null : checks.kind === 'failed' ? (
        <p
          role="alert"
          className="rounded-control border border-danger/25 bg-danger-soft px-3 py-2 text-danger"
          data-testid="branch-blocked"
        >
          {B.blocked(checks.failing.map((c) => c.name).join(', '))}
        </p>
      ) : checks.kind === 'stopped' ? (
        <p role="note" className="text-caption text-dim" data-testid="branch-checks-stopped">
          {B.checksStopped}
        </p>
      ) : null}
      {!prOpen && review?.baseMoved === true ? (
        <div
          role="note"
          className="flex flex-wrap items-center gap-3 rounded-control border border-warning/30 bg-warning-soft px-3 py-2"
          data-testid="branch-base-moved"
        >
          <AlertIcon size={15} className="shrink-0 text-warning" />
          <span className="min-w-0 flex-1 text-caption">{B.baseMoved(base)}</span>
          <Button
            size="sm"
            disabled={act.pending}
            onClick={() => void act.run(run.id, { action: 'update-from-base' })}
          >
            {act.pending ? B.working : B.update(base)}
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-start gap-2">
        {prOpen ? (
          ticket !== null && branch.pullRequest && hasNewCommits(branch) ? (
            <PushNewCommits
              ticketId={ticket.id}
              branch={branch.branch}
              pr={branch.pullRequest}
              disabled={act.pending}
            />
          ) : null
        ) : checks.kind === 'failed' ? (
          <ReasonForm
            openLabel={B.mergeAnyway}
            title={B.mergeAnywayTitle}
            label={B.reasonLabel}
            hint={B.reasonHint}
            placeholder={B.reasonPlaceholder}
            max={MAX_REASON}
            tooLong={B.reasonTooLong(MAX_REASON)}
            submitLabel={B.confirmMergeAnyway}
            cancelLabel={B.cancel}
            pendingLabel={B.working}
            pending={act.pending}
            tone="danger"
            testId="branch-merge-anyway"
            onConfirm={(reason) => act.run(run.id, { action: 'merge-anyway', reason })}
          />
        ) : (
          <ConfirmAction
            label={B.merge(base)}
            question={B.confirmMerge(branch.branch, base)}
            confirmLabel={B.confirmMergeButton}
            cancelLabel={B.cancel}
            pendingLabel={B.working}
            pending={act.pending}
            disabled={review?.baseMoved === true}
            danger={false}
            primary
            onConfirm={() => act.run(run.id, { action: 'merge' })}
          />
        )}
        {!prOpen && ticket !== null ? (
          <PushAction ticket={ticket} branch={branch} disabled={act.pending} />
        ) : null}
        <ReasonForm
          openLabel={B.requestChanges}
          title={B.requestTitle}
          label={B.requestTitle}
          hint={B.requestHint}
          placeholder={B.requestPlaceholder}
          max={MAX_COMMENT}
          tooLong={B.requestTooLong(MAX_COMMENT)}
          submitLabel={B.sendRequest}
          cancelLabel={B.cancel}
          pendingLabel={B.working}
          pending={act.pending}
          testId="branch-request-changes"
          onConfirm={(comment) => act.run(run.id, { action: 'request-changes', comment })}
        />
        <ConfirmAction
          label={B.discard}
          question={B.confirmDiscard(branch.branch)}
          confirmLabel={B.confirmDiscardButton}
          cancelLabel={B.cancel}
          pendingLabel={B.working}
          pending={act.pending}
          onConfirm={() => act.run(run.id, { action: 'discard' })}
        />
      </div>
      <ActionError error={act.error} message={B.failed} />
    </div>
  );
}

/** A stopped run's open branch can only be discarded (README §5 "Stops"). */
function DiscardOnly({ run, branch }: { run: Pick<RunDetailDto, 'id'>; branch: TicketBranchDto }) {
  const act = useTicketAction(ticketBranchAction);
  return (
    <div className="flex flex-col gap-2" data-testid="branch-actions">
      <p className="text-caption text-dim">{B.discardOnly}</p>
      <ConfirmAction
        label={B.discard}
        question={B.confirmDiscard(branch.branch)}
        confirmLabel={B.confirmDiscardButton}
        cancelLabel={B.cancel}
        pendingLabel={B.working}
        pending={act.pending}
        onConfirm={() => act.run(run.id, { action: 'discard' })}
      />
      <ActionError error={act.error} message={B.failed} />
    </div>
  );
}

/**
 * The ticket branch card's decision part, kept apart from its evidence (checks, files, diff): the
 * pull request when there is one, then the owner's actions for the card's mode.
 */
export function BranchFinalStep({
  mode,
  run,
  branch,
  review,
  ticket,
}: {
  mode: TicketBranchMode;
  run: Pick<RunDetailDto, 'id'>;
  branch: TicketBranchDto;
  review: TicketBranchReviewDto | undefined;
  /** The run's ticket; null for a run without one (no pull request then). */
  ticket: FinalStepTicket | null;
}) {
  const pr = branch.pullRequest ?? null;
  return (
    <>
      {pr !== null ? <PullRequestInfo pr={pr} ticketId={ticket?.id ?? null} /> : null}
      {mode === 'merge' ? (
        <Actions run={run} branch={branch} review={review} ticket={ticket} />
      ) : null}
      {mode === 'discard-only' ? <DiscardOnly run={run} branch={branch} /> : null}
    </>
  );
}
