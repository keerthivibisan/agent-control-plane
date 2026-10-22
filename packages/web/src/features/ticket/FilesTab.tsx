import type { ChangeReviewDto, RunDetailDto, TicketDto } from '@acp/core/api';
import { Button, ButtonLink } from '../../components/Button';
import { href } from '../../lib/router';
import { Details } from '../../components/Details';
import { DiffSection } from '../../components/diff';
import { EmptyState } from '../../components/EmptyState';
import { ErrorNotice } from '../../components/ErrorNotice';
import { LoadingBlock } from '../../components/Skeleton';
import { Badge } from '../../components/Pill';
import {
  CONTROL_COPY,
  REVIEW_LOOP_COPY,
  TICKET_PAGE_COPY,
  WORKFLOW_LIVE_COPY,
} from '../../lib/copy';
import { ChangeChecks, ChangeStateChip } from '../review-loop/ChangeCard';
import { BranchIcon, ReworkIcon } from '../review-loop/icons';
import { isReviewLoopRun, reworkRoundsBy, shortCommit } from '../review-loop/logic';
import { Files } from './ChangesTab';
import { FilesChangedIcon } from './icons';
import type { AgentReview, TicketBranchReview } from './run-data';
import type { PanelTab } from './SidePanel';
import { hasWorktree } from './ticket-state';

const B = REVIEW_LOOP_COPY.branch;
const F = TICKET_PAGE_COPY.files;
const R = CONTROL_COPY.review;

type TicketRef = Pick<TicketDto, 'id' | 'projectId'>;

/**
 * How many files the tab's count says: the ticket branch's combined change once it is read, else
 * every distinct path the helpers' reviews list; null when nothing is known yet.
 */
export function filesCount(
  reviews: readonly AgentReview[],
  branchReview: Pick<TicketBranchReview, 'query'>,
): number | null {
  const combined = branchReview.query.data;
  if (combined !== undefined) return combined.files.length;
  if (reviews.length === 0) return null;
  return new Set(reviews.flatMap((r) => r.files.map((f) => f.path))).size;
}

/**
 * The ticket branch at the top (ADR-0021 §4): its name, base and tip, how many changes landed on
 * it, and once the run waits for the final step, its combined files, the diff (collapsed), and
 * the button to the full review page.
 */
function BranchFiles({
  run,
  ticket,
  branchReview,
}: {
  run: RunDetailDto;
  ticket: TicketRef;
  branchReview: TicketBranchReview;
}) {
  const { branch, mode, live, query } = branchReview;
  if (branch === null) return null;
  const merged = (run.changes ?? []).filter((c) => c.state === 'merged').length;
  const review = query.data;
  return (
    <section
      aria-label={B.title}
      data-testid="branch-files"
      className="min-w-0 overflow-hidden rounded-card border border-line bg-panel shadow-card"
    >
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-subtle px-4 py-3">
        <h2 className="flex min-w-0 items-center gap-1.5 text-title font-semibold">
          <BranchIcon size={16} className="shrink-0 text-dim" />
          <span className="sr-only">{F.branchTitle}: </span>
          <span className="min-w-0 font-mono break-all" data-testid="branch-name">
            {branch.branch}
          </span>
        </h2>
        <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-dim">
          <div className="flex items-center gap-1.5">
            <dt>{B.base}</dt>
            <dd className="font-mono text-ink">
              {branch.baseBranch}{' '}
              <span className="text-dim" title={branch.baseCommit}>
                {shortCommit(branch.baseCommit)}
              </span>
            </dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt>{B.tipCommit}</dt>
            <dd className="font-mono text-ink" title={branch.headCommit}>
              {shortCommit(branch.headCommit)}
            </dd>
          </div>
          <div>
            <dt className="sr-only">{B.changesMerged(merged)}</dt>
            <dd className="tabular-nums">{B.changesMerged(merged)}</dd>
          </div>
        </dl>
        {branch.state !== 'discarded' ? (
          <ButtonLink
            href={href.ticketFiles({ projectId: ticket.projectId, ticketId: ticket.id })}
            size="sm"
            className="ml-auto"
            title={F.reviewAllTip}
            data-testid="review-all-files"
          >
            <FilesChangedIcon size={14} />
            {F.reviewAll}
          </ButtonLink>
        ) : null}
      </header>
      <div className="flex flex-col gap-4 px-4 py-3">
        {mode === 'waiting' ? <p className="text-dim">{B.waiting}</p> : null}
        {live ? (
          review !== undefined ? (
            <>
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
            </>
          ) : query.error !== null ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-danger">{B.loadFailed}</p>
              <Details>
                <ErrorNotice error={query.error} />
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
    </section>
  );
}

/** The row's two ways in: the change's own review page, and the agent's panel on Agents. */
function RowActions({
  ticket,
  agentRunId,
  role,
  sealed,
  onOpen,
}: {
  ticket: TicketRef;
  agentRunId: string;
  role: string;
  /** The change has a commit to review. */
  sealed: boolean;
  onOpen: () => void;
}) {
  return (
    <span className="ml-auto flex flex-wrap items-center gap-2">
      {sealed ? (
        <ButtonLink
          href={href.ticketChange({ projectId: ticket.projectId, ticketId: ticket.id, agentRunId })}
          size="sm"
          aria-label={F.filesChangedFor(role)}
          data-testid="change-files-link"
        >
          <FilesChangedIcon size={14} />
          {F.filesChanged}
        </ButtonLink>
      ) : null}
      <Button size="sm" variant="quiet" aria-label={F.openFor(role)} onClick={onOpen}>
        {F.open}
      </Button>
    </span>
  );
}

function filesOf(
  change: Pick<ChangeReviewDto, 'agentRunId' | 'changedFiles'>,
  reviews: readonly AgentReview[],
): number | null {
  const review = reviews.find((r) => r.agentRunId === change.agentRunId);
  return review !== undefined ? review.files.length : change.changedFiles;
}

/**
 * The Files changed tab (v0.3.0 D-B): the ticket branch's combined change on top, then every
 * helper's change with its state and checks, a button to its review page and one to show it in
 * the Agents tab's side panel (where the owner decides when it is their turn).
 */
export function FilesTab({
  ticket,
  run,
  reviews,
  branchReview,
  onOpenAgent,
}: {
  ticket: TicketRef;
  run: RunDetailDto | undefined;
  reviews: readonly AgentReview[];
  branchReview: TicketBranchReview;
  onOpenAgent: (agentId: string, tab?: PanelTab) => void;
}) {
  if (run === undefined) {
    return (
      <EmptyState
        icon={<FilesChangedIcon size={20} />}
        title={TICKET_PAGE_COPY.tabs.files}
        text={F.noRun}
      />
    );
  }
  const loop = isReviewLoopRun(run);
  const branchName = run.ticketBranch?.branch ?? null;
  const helpers = run.agents.filter((a) => hasWorktree(a.kind));
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="files-tab">
      {run.ticketBranch ? (
        <BranchFiles run={run} ticket={ticket} branchReview={branchReview} />
      ) : null}
      <section
        aria-label={loop ? F.changesTitle : F.helpersTitle}
        data-testid="changes-overview"
        className="min-w-0 overflow-hidden rounded-card border border-line bg-panel shadow-card"
      >
        <h2 className="border-b border-line bg-subtle px-4 py-3 text-title font-semibold">
          {loop ? F.changesTitle : F.helpersTitle}
        </h2>
        {loop ? (
          (run.changes ?? []).length === 0 ? (
            <p className="px-4 py-3 text-dim">{F.changesNone}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line-muted">
              {(run.changes ?? []).map((c) => {
                const n = filesOf(c, reviews);
                return (
                  <li
                    key={c.agentRunId}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
                    data-testid="change-row"
                    data-agent={c.agentRunId}
                  >
                    <span className="min-w-0 font-medium">{c.role}</span>
                    <ChangeStateChip change={c} branch={branchName} />
                    <ChangeChecks change={c} />
                    {c.reworkRounds - reworkRoundsBy(c, 'reviewer') > 0 ? (
                      <Badge>
                        <span className="inline-flex items-center gap-1">
                          <ReworkIcon size={12} />
                          {REVIEW_LOOP_COPY.graph.rework(
                            c.reworkRounds - reworkRoundsBy(c, 'reviewer'),
                          )}
                        </span>
                      </Badge>
                    ) : null}
                    {reworkRoundsBy(c, 'reviewer') > 0 ? (
                      <Badge>
                        <span
                          className="inline-flex items-center gap-1"
                          data-testid="change-direct-badge"
                        >
                          <ReworkIcon size={12} />
                          {WORKFLOW_LIVE_COPY.changes.directBadge(reworkRoundsBy(c, 'reviewer'))}
                        </span>
                      </Badge>
                    ) : null}
                    {c.conflictFiles.length > 0 ? (
                      <Badge tone="warning">{REVIEW_LOOP_COPY.changes.conflictsShort}</Badge>
                    ) : null}
                    <span className="text-caption text-dim tabular-nums">
                      {n === null ? null : B.files(n)}
                    </span>
                    <RowActions
                      ticket={ticket}
                      agentRunId={c.agentRunId}
                      role={c.role}
                      sealed={c.headCommit !== null}
                      onOpen={() => onOpenAgent(c.agentRunId, 'changes')}
                    />
                  </li>
                );
              })}
            </ul>
          )
        ) : helpers.length === 0 ? (
          <p className="px-4 py-3 text-dim">{F.changesNone}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line-muted">
            {helpers.map((a) => {
              const review = reviews.find((r) => r.agentRunId === a.id);
              return (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
                  data-testid="change-row"
                  data-agent={a.id}
                >
                  <span className="min-w-0 font-medium">{a.role}</span>
                  {review !== undefined ? (
                    <span className="text-caption text-dim" data-state={review.state}>
                      {R.state[review.state]}
                    </span>
                  ) : null}
                  <span className="text-caption text-dim tabular-nums">
                    {review !== undefined
                      ? B.files(review.files.length)
                      : (a.review?.changedFiles ?? null) === null
                        ? null
                        : B.files(a.review?.changedFiles ?? 0)}
                  </span>
                  <RowActions
                    ticket={ticket}
                    agentRunId={a.id}
                    role={a.role}
                    sealed={review !== undefined}
                    onOpen={() => onOpenAgent(a.id, 'changes')}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
