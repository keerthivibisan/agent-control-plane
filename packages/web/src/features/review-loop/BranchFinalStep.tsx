import type {
  RunDetailDto,
  TicketBranchDto,
  TicketBranchReviewDto,
  TicketDto,
} from '@acp/core/api';
import { reviewLoopPaths, reviewLoopSchemas, ticketBranchAction } from '../../lib/api';
import { MERGE_PR_COPY, REVIEW_LOOP_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { useCodeHost } from '../branching/CodeHostCard';
import { hasNewCommits, pushBlockedReason } from '../branching/code-host';
import { DeleteTicketBranch, MergePullRequest } from '../branching/MergeAndDelete';
import { PullRequestInfo, PushAndOpenPr, PushNewCommits } from '../branching/PullRequest';
import { ActionError, ConfirmAction } from '../control/bits';
import { useTicketAction } from '../ticket/actions';
import { checksSummary, type TicketBranchMode } from './logic';
import { MovedOutsideBanner } from './MovedOutsideBanner';
import { ReasonForm } from './ReasonForm';
import { ResolutionPanel } from './ResolutionPanel';

const B = REVIEW_LOOP_COPY.branch;
const MAX_REASON = 500;
const MAX_COMMENT = 8000;

export type FinalStepTicket = Pick<TicketDto, 'id' | 'key' | 'title' | 'projectId'> &
  Partial<Pick<TicketDto, 'currentRunId'>>;

/**
 * Merge pull request and Delete branch act on the ticket's current run (the server's rule): only
 * offered for the run on screen when it is that run.
 */
function isCurrentRun(ticket: FinalStepTicket | null, runId: string): ticket is FinalStepTicket {
  return ticket !== null && ticket.currentRunId === runId;
}

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
 * comment for the lead; the run goes on); Discard; and "Update target / Resolve conflicts" when it
 * moved (ADR-0030, also with a pull request open). Each asks first; the server checks again. While a pull request is open on GitHub, the merge happens
 * there: Merge pull request (G-G; off until new commits are pushed), Request changes and Discard,
 * with Push new commits when the branch moved on since the last push (G-D).
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
  const pr = branch.pullRequest ?? null;
  const prOpen = pr?.state === 'open';
  const newCommits = hasNewCommits(branch);
  return (
    <div className="flex flex-col gap-2.5" data-testid="branch-actions">
      {prOpen && pr !== null && isCurrentRun(ticket, run.id) ? (
        // G-G (ADR-0025 §9): merge it on GitHub, from here.
        <MergePullRequest
          ticket={ticket}
          branch={branch}
          pr={pr}
          blockedReason={newCommits ? MERGE_PR_COPY.needsPush : null}
          disabled={act.pending}
        />
      ) : null}
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
      {/* ADR-0030: offered whenever the target moved, also while a pull request is open. */}
      <ResolutionPanel runId={run.id} branch={branch} baseMoved={review?.baseMoved === true} />
      <div className="flex flex-wrap items-start gap-2">
        {prOpen ? (
          ticket !== null && branch.pullRequest && newCommits ? (
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
 * A merged or discarded branch (G-G, ADR-0025 §9): Delete branch while git says it still exists
 * in the project folder or on GitHub, then "Branch deleted". Where it exists is read with the
 * combined change (`GET /runs/:id/ticket-branch`, local refs only), as the Files tab reads it.
 */
function FinishedBranch({ runId, ticket }: { runId: string; ticket: FinalStepTicket }) {
  const q = useApiQuery(reviewLoopPaths.ticketBranch(runId), reviewLoopSchemas.ticketBranch);
  const branch = q.data?.ticketBranch;
  if (branch === undefined) return null;
  return <DeleteTicketBranch ticketId={ticket.id} branch={branch} />;
}

/**
 * The ticket branch card's decision part, kept apart from its evidence (checks, files, diff): the
 * pull request when there is one, then the owner's actions for the card's mode (with Merge pull
 * request while one is open, and Delete branch once the branch is finished; G-G).
 */
export function BranchFinalStep({
  mode,
  run,
  branch,
  review,
  ticket,
  showPullRequest = true,
}: {
  mode: TicketBranchMode;
  run: Pick<RunDetailDto, 'id'>;
  branch: TicketBranchDto;
  review: TicketBranchReviewDto | undefined;
  /** The run's ticket; null for a run without one (no pull request then). */
  ticket: FinalStepTicket | null;
  /** False where the pull request is shown elsewhere (the ticket page's sidebar, v0.3.0 D-B). */
  showPullRequest?: boolean;
}) {
  const pr = branch.pullRequest ?? null;
  // F-1: only the combined-change read (`review`) says whether the branch moved outside the app.
  const movedOutside = review?.ticketBranch.movedOutside ?? branch.movedOutside;
  return (
    <>
      {mode !== 'closed' ? (
        <MovedOutsideBanner runId={run.id} branch={{ ...branch, movedOutside }} />
      ) : null}
      {pr !== null && showPullRequest ? (
        <PullRequestInfo pr={pr} ticketId={ticket?.id ?? null} />
      ) : null}
      {mode === 'merge' ? (
        <Actions run={run} branch={branch} review={review} ticket={ticket} />
      ) : null}
      {mode === 'discard-only' ? <DiscardOnly run={run} branch={branch} /> : null}
      {mode === 'closed' && isCurrentRun(ticket, run.id) ? (
        <FinishedBranch runId={run.id} ticket={ticket} />
      ) : null}
    </>
  );
}
