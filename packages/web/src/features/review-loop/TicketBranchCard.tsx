import type { RunDetailDto, TicketBranchDto, TicketBranchReviewDto } from '@acp/core/api';
import { Card } from '../../components/Card';
import { Details } from '../../components/Details';
import { DiffSection } from '../../components/diff';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Pill, type PillTone } from '../../components/Pill';
import { LoadingBlock } from '../../components/Skeleton';
import { reviewLoopPaths, reviewLoopSchemas } from '../../lib/api';
import { PULL_REQUEST_COPY, REVIEW_LOOP_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { Files } from '../ticket/ChangesTab';
import { CheckRow } from '../ticket/ChecksTab';
import { BranchIcon } from './icons';
import { BranchFinalStep, type FinalStepTicket } from './BranchFinalStep';
import { latestChecks, shortCommit, ticketBranchMode } from './logic';

const B = REVIEW_LOOP_COPY.branch;

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
        <DiffSection
          summary={B.diff}
          diff={review.diff}
          truncated={review.diffTruncated}
          files={review.files.map((f) => f.path)}
          testId="branch-diff"
        />
      ) : null}
    </div>
  );
}

/**
 * The run's ticket branch (ADR-0021 §4; named by the project's strategy since ADR-0025): where
 * every merged change lands, with the owner's single final step at the end, a merge into the
 * target or a pull request on GitHub. While agents work it only says so; at REVIEW it loads the
 * combined change (`GET /runs/:id/ticket-branch`) and offers the final step (`BranchFinalStep`).
 */
export function TicketBranchCard({
  run,
  branch,
  ticket = null,
}: {
  run: Pick<RunDetailDto, 'id' | 'status' | 'changes'>;
  branch: TicketBranchDto;
  /** The run's ticket, for Push & open PR; null for a run without one. */
  ticket?: FinalStepTicket | null;
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
            {branch.state !== 'merged'
              ? B.state[branch.state]
              : branch.pullRequest?.state === 'merged'
                ? PULL_REQUEST_COPY.mergedOnGitHub(branch.baseBranch)
                : B.mergedInto(branch.baseBranch)}
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
        <BranchFinalStep mode={mode} run={run} branch={branch} review={q.data} ticket={ticket} />
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
