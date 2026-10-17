import type { RunDetailDto, TicketBranchDto, TicketBranchReviewDto } from '@acp/core/api';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Details } from '../../components/Details';
import { ErrorNotice } from '../../components/ErrorNotice';
import { AlertIcon } from '../../components/icons';
import { Pill, type PillTone } from '../../components/Pill';
import { LoadingBlock } from '../../components/Skeleton';
import { reviewLoopPaths, reviewLoopSchemas, ticketBranchAction } from '../../lib/api';
import { REVIEW_LOOP_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { ActionError, ConfirmAction } from '../control/bits';
import { DiffView } from '../control/ReviewPanel';
import { useTicketAction } from '../ticket/actions';
import { Files } from '../ticket/ChangesTab';
import { CheckRow } from '../ticket/ChecksTab';
import { BranchIcon } from './icons';
import { checksSummary, latestChecks, shortCommit, ticketBranchMode } from './logic';
import { ReasonForm } from './ReasonForm';

const B = REVIEW_LOOP_COPY.branch;
const MAX_REASON = 500;
const MAX_COMMENT = 8000;

const STATE_TONE: Record<TicketBranchDto['state'], PillTone> = {
  open: 'accent',
  merged: 'success',
  discarded: 'neutral',
};

/** The tip's checks, the combined files and diff, and the "base moved" notice. */
function Combined({ review }: { review: TicketBranchReviewDto }) {
  const latest = latestChecks(review.checks);
  return (
    <div className="flex flex-col gap-4">
      <section aria-label={B.checksTitle} className="flex flex-col gap-2">
        <h3 className="text-caption font-medium">{B.checksTitle}</h3>
        {latest.length === 0 ? (
          <p className="text-caption text-dim">{B.checksNone}</p>
        ) : (
          <ul
            className="flex flex-col divide-y divide-line rounded-card border border-line"
            data-testid="branch-checks"
          >
            {latest.map((c) => (
              <CheckRow key={c.id} check={c} />
            ))}
          </ul>
        )}
      </section>
      {review.files.length === 0 ? (
        <p className="text-dim">{B.noFiles}</p>
      ) : (
        <Files files={review.files} />
      )}
      {review.files.length > 0 || review.diff.length > 0 ? (
        <Details summary={B.diff} testId="branch-diff">
          <DiffView diff={review.diff} truncated={review.diffTruncated} />
        </Details>
      ) : null}
    </div>
  );
}

/**
 * The owner's one merge (ADR-0021 §4): Merge into main (or merge anyway past a failed required
 * check, with a reason), Request changes (a comment for the lead; the run goes on), Discard, and
 * Update from main when main moved. Each asks first; the server checks again.
 */
function Actions({
  run,
  branch,
  review,
}: {
  run: Pick<RunDetailDto, 'id'>;
  branch: TicketBranchDto;
  review: TicketBranchReviewDto | undefined;
}) {
  const act = useTicketAction(ticketBranchAction);
  const checks = checksSummary(review?.checks ?? []);
  const base = branch.baseBranch;
  return (
    <div className="flex flex-col gap-2.5" data-testid="branch-actions">
      {checks.kind === 'failed' ? (
        <p
          role="alert"
          className="rounded-control border border-danger/25 bg-danger-soft px-3 py-2 text-danger"
          data-testid="branch-blocked"
        >
          {B.blocked(checks.failing.map((c) => c.name).join(', '))}
        </p>
      ) : null}
      {review?.baseMoved === true ? (
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
        {checks.kind === 'failed' ? (
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
 * The run's ticket branch `acp/<KEY>` (ADR-0021 §4): where every merged change lands, with the
 * owner's single merge into main at the end. While agents work it only says so; at REVIEW it loads
 * the combined change (`GET /runs/:id/ticket-branch`) and offers the final actions.
 */
export function TicketBranchCard({
  run,
  branch,
}: {
  run: Pick<RunDetailDto, 'id' | 'status' | 'changes'>;
  branch: TicketBranchDto;
}) {
  const mode = ticketBranchMode(run, branch);
  const live = mode === 'merge' || mode === 'discard-only';
  const q = useApiQuery(
    live ? reviewLoopPaths.ticketBranch(run.id) : null,
    reviewLoopSchemas.ticketBranch,
  );
  const merged = (run.changes ?? []).filter((c) => c.state === 'merged').length;
  return (
    <Card
      title={B.title}
      tip={B.tip}
      description={B.description}
      testId="ticket-branch"
      actions={
        <span data-testid="branch-state" data-state={branch.state}>
          <Pill tone={STATE_TONE[branch.state]}>
            {branch.state === 'merged' ? B.mergedInto(branch.baseBranch) : B.state[branch.state]}
          </Pill>
        </span>
      }
      className={mode === 'merge' ? 'border-accent-fill-edge/50' : ''}
    >
      <div className="flex flex-col gap-4">
        <dl className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-caption">
          <div className="flex items-center gap-1.5">
            <BranchIcon size={14} className="shrink-0 text-dim" />
            <dt className="sr-only">{B.title}</dt>
            <dd className="font-mono font-medium text-ink" data-testid="branch-name">
              {branch.branch}
            </dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="text-dim">{B.base}</dt>
            <dd className="font-mono">
              {branch.baseBranch}{' '}
              <span className="text-dim" title={branch.baseCommit}>
                {shortCommit(branch.baseCommit)}
              </span>
            </dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="text-dim">{B.tipCommit}</dt>
            <dd className="font-mono" title={branch.headCommit}>
              {shortCommit(branch.headCommit)}
            </dd>
          </div>
          <div>
            <dt className="sr-only">{B.changesMerged(merged)}</dt>
            <dd className="text-dim tabular-nums">{B.changesMerged(merged)}</dd>
          </div>
        </dl>
        {mode === 'waiting' ? <p className="text-dim">{B.waiting}</p> : null}
        {/* The decision first, the evidence (checks, files, diff) under it. */}
        {mode === 'merge' ? <Actions run={run} branch={branch} review={q.data} /> : null}
        {mode === 'discard-only' ? <DiscardOnly run={run} branch={branch} /> : null}
        {live ? (
          q.data !== undefined ? (
            <Combined review={q.data} />
          ) : q.error !== null ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-danger">{B.loadFailed}</p>
              <Details>
                <ErrorNotice error={q.error} />
              </Details>
            </div>
          ) : (
            <LoadingBlock label={B.loading} />
          )
        ) : null}
        {branch.state === 'merged' && branch.mergedCommit !== null ? (
          <p className="text-caption text-dim">
            {B.mergedAt(branch.baseBranch)}{' '}
            <span className="font-mono" title={branch.mergedCommit}>
              {shortCommit(branch.mergedCommit)}
            </span>
          </p>
        ) : null}
      </div>
    </Card>
  );
}
