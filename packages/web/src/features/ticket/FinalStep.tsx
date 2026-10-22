import type { RunDetailDto, TicketBranchDto } from '@acp/core/api';
import { useId, type ComponentType } from 'react';
import { Details } from '../../components/Details';
import { ErrorNotice } from '../../components/ErrorNotice';
import { AlertIcon, CheckIcon, MergeIcon, type IconProps } from '../../components/icons';
import { Pill, type PillTone } from '../../components/Pill';
import { LoadingBlock } from '../../components/Skeleton';
import { PULL_REQUEST_COPY, REVIEW_LOOP_COPY, TICKET_PAGE_COPY } from '../../lib/copy';
import { PullRequestIcon } from '../branching/icons';
import { BranchFinalStep, type FinalStepTicket } from '../review-loop/BranchFinalStep';
import { BranchIcon } from '../review-loop/icons';
import { checksSummary, shortCommit, type ChecksSummary } from '../review-loop/logic';
import type { TicketBranchReview } from './run-data';
import { useTicketNav } from './ticket-nav';
import { FINAL_STEP_ID } from './ticket-state';

const B = REVIEW_LOOP_COPY.branch;
const F = TICKET_PAGE_COPY.finalStep;

const STATE_TONE: Record<TicketBranchDto['state'], PillTone> = {
  open: 'accent',
  merged: 'success',
  discarded: 'neutral',
};

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent' | 'done';

const ICON_TONE: Record<Tone, string> = {
  neutral: 'bg-subtle text-dim border-line',
  success: 'bg-success-soft text-success border-success/40',
  warning: 'bg-warning-soft text-warning border-warning/40',
  danger: 'bg-danger-soft text-danger border-danger/40',
  accent: 'bg-accent-soft text-accent border-accent/40',
  done: 'bg-done-soft text-done border-done/40',
};

/** The box's headline: what stands between the ticket and its target now. */
function headline(
  mode: NonNullable<TicketBranchReview['mode']>,
  branch: TicketBranchDto,
  checks: ChecksSummary,
  baseMoved: boolean,
): { text: string; tone: Tone; Icon: ComponentType<IconProps> } {
  const target = branch.baseBranch;
  const pr = branch.pullRequest ?? null;
  if (mode === 'waiting') return { text: F.waiting, tone: 'neutral', Icon: BranchIcon };
  if (mode === 'discard-only') return { text: F.stopped, tone: 'neutral', Icon: BranchIcon };
  if (mode === 'closed') {
    if (branch.state === 'merged') return { text: F.merged, tone: 'done', Icon: MergeIcon };
    return { text: F.discarded, tone: 'neutral', Icon: BranchIcon };
  }
  if (pr?.state === 'open')
    return { text: F.prOpen(pr.number), tone: 'accent', Icon: PullRequestIcon };
  if (checks.kind === 'failed') return { text: F.blocked, tone: 'danger', Icon: AlertIcon };
  if (baseMoved) return { text: F.baseMoved(target), tone: 'warning', Icon: AlertIcon };
  return { text: F.ready(target), tone: 'success', Icon: CheckIcon };
}

/** "2 of 3 checks passed on the tip", with a link to the Checks tab. */
function ChecksLine({ checks }: { checks: ChecksSummary }) {
  const nav = useTicketNav();
  const text =
    checks.kind === 'none'
      ? F.checksNone
      : checks.kind === 'passed'
        ? F.checks(checks.passed, checks.total)
        : checks.kind === 'stopped'
          ? F.checksStopped
          : F.checksFailed(checks.failing.length);
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-dim">
      <span className={checks.kind === 'failed' ? 'text-danger' : ''}>{text}</span>
      {nav !== null && checks.kind !== 'none' ? (
        <button
          type="button"
          className="font-medium text-accent hover:underline"
          onClick={() => nav.goTo('checks')}
        >
          {TICKET_PAGE_COPY.tabs.checks}
        </button>
      ) : null}
    </p>
  );
}

/**
 * The final step (v0.3.0 D-B), at the end of the Comments tab like GitHub's merge box: where
 * the ticket branch stands in one line, the tip's checks in one line, then the owner's actions
 * (`BranchFinalStep`: merge into the target, Push & open PR, Request changes, Discard, Update from
 * the target). The pull request itself is in the sidebar. While agents work it only says so.
 */
export function FinalStepBox({
  run,
  ticket,
  branchReview,
}: {
  run: Pick<RunDetailDto, 'id' | 'status' | 'changes'>;
  ticket: FinalStepTicket;
  branchReview: TicketBranchReview;
}) {
  const titleId = useId();
  const { branch, mode, live, query } = branchReview;
  if (branch === null || mode === null) return null;
  const review = query.data;
  const checks = checksSummary(review?.checks ?? []);
  const head = headline(mode, branch, checks, review?.baseMoved === true);
  return (
    <section
      id={FINAL_STEP_ID}
      tabIndex={-1}
      aria-labelledby={titleId}
      data-testid="ticket-branch"
      data-mode={mode}
      className={`scroll-mt-24 overflow-hidden rounded-card border bg-panel shadow-card focus-visible:outline-offset-2 ${
        mode === 'merge' ? 'border-line-strong' : 'border-line'
      }`}
    >
      <header className="flex items-start gap-3 border-b border-line bg-subtle px-4 py-3">
        <span
          aria-hidden="true"
          className={`flex size-8 shrink-0 items-center justify-center rounded-full border ${ICON_TONE[head.tone]}`}
        >
          <head.Icon size={16} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-title font-semibold">
            <span className="sr-only">{F.title}: </span>
            <span id={titleId}>{head.text}</span>
          </h2>
          {live ? <ChecksLine checks={checks} /> : null}
        </div>
        <span data-testid="branch-state" data-state={branch.state} className="shrink-0">
          <Pill tone={STATE_TONE[branch.state]}>
            {branch.state !== 'merged'
              ? B.state[branch.state]
              : branch.pullRequest?.state === 'merged'
                ? PULL_REQUEST_COPY.mergedOnGitHub(branch.baseBranch)
                : B.mergedInto(branch.baseBranch)}
          </Pill>
        </span>
      </header>
      <div className="flex flex-col gap-3 px-4 py-3">
        {mode === 'waiting' ? <p className="text-dim">{B.waiting}</p> : null}
        {branch.pullRequest?.state === 'open' && mode === 'merge' ? (
          <p className="text-caption text-dim">
            {PULL_REQUEST_COPY.openNote(branch.baseBranch)} {F.prNote}
          </p>
        ) : null}
        {live && review === undefined ? (
          query.error !== null ? (
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
        <BranchFinalStep
          mode={mode}
          run={run}
          branch={branch}
          review={review}
          ticket={ticket}
          showPullRequest={false}
        />
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
