import type { CheckRunDto, RunDetailDto } from '@acp/core/api';
import type { ReactNode } from 'react';
import { EmptyState } from '../../components/EmptyState';
import { InfoTip } from '../../components/InfoTip';
import { REVIEW_LOOP_COPY, TICKET_COPY, TICKET_PAGE_COPY } from '../../lib/copy';
import { canRecheckChange, isReviewLoopRun, latestChecks } from '../review-loop/logic';
import { CheckRow, ChecksTab } from './ChecksTab';
import { ChecksIcon } from './icons';
import type { AgentReview, TicketBranchReview } from './run-data';
import { agentChecks, hasWorktree } from './ticket-state';

const B = REVIEW_LOOP_COPY.branch;
const K = TICKET_PAGE_COPY.checks;

/** The tab's count: the latest run of each check, on the tip and on each change. */
export function checksCount(
  run: Pick<RunDetailDto, 'agents'> | undefined,
  checks: readonly CheckRunDto[],
  branchReview: Pick<TicketBranchReview, 'query'>,
): number {
  if (run === undefined) return 0;
  const tip = latestChecks(branchReview.query.data?.checks ?? []).length;
  return run.agents
    .filter((a) => hasWorktree(a.kind))
    .reduce((sum, a) => sum + agentChecks(checks, a.id).latest.length, tip);
}

function Box({
  title,
  tip,
  children,
  testId,
  level = 2,
}: {
  title: string;
  tip?: string;
  children: ReactNode;
  level?: 2 | 3;
  testId?: string;
}) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <section
      aria-label={title}
      data-testid={testId}
      className="min-w-0 overflow-hidden rounded-card border border-line bg-panel shadow-card"
    >
      <Heading className="flex items-center gap-1 border-b border-line bg-subtle px-4 py-3 text-title font-semibold">
        {title}
        {tip ? <InfoTip tip={tip} label={title} /> : null}
      </Heading>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

/**
 * The Checks tab (v0.3.0 D-B): the harness checks on the ticket branch's tip (the ones the final
 * merge counts), then the checks on each helper's change, with their output and "Run checks
 * again" while that change still waits for a decision.
 */
export function ChecksPanel({
  run,
  checks,
  reviews,
  branchReview,
}: {
  run: RunDetailDto | undefined;
  checks: readonly CheckRunDto[];
  reviews: readonly AgentReview[];
  branchReview: TicketBranchReview;
}) {
  if (run === undefined) {
    return (
      <EmptyState
        icon={<ChecksIcon size={20} />}
        title={TICKET_PAGE_COPY.tabs.checks}
        text={K.noRun}
      />
    );
  }
  const loop = isReviewLoopRun(run);
  const helpers = run.agents.filter((a) => hasWorktree(a.kind));
  const tip = latestChecks(branchReview.query.data?.checks ?? []);
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="checks-tab">
      {run.ticketBranch ? (
        <Box title={K.tipTitle} tip={TICKET_COPY.checks.tip} testId="tip-checks">
          {branchReview.mode === 'waiting' ? (
            <p className="text-dim">{B.waiting}</p>
          ) : tip.length === 0 ? (
            <p className="text-caption text-dim">{B.checksNone}</p>
          ) : (
            <ul
              className="flex flex-col divide-y divide-line rounded-card border border-line"
              data-testid="branch-checks"
            >
              {tip.map((c) => (
                <CheckRow key={c.id} check={c} />
              ))}
            </ul>
          )}
        </Box>
      ) : null}
      {helpers.length === 0 ? (
        <p className="text-dim">{K.none}</p>
      ) : (
        <section aria-label={K.changesTitle} className="flex flex-col gap-3">
          <h2 className="text-title font-semibold">{K.changesTitle}</h2>
          {helpers.map((a) => (
            <Box key={a.id} title={a.role} level={3} testId={`agent-checks-${a.id}`}>
              <ChecksTab
                runId={run.id}
                agent={a}
                checks={checks}
                canRunAgain={
                  loop
                    ? canRecheckChange(run, a.id)
                    : reviews.find((r) => r.agentRunId === a.id)?.state === 'pending'
                }
              />
            </Box>
          ))}
        </section>
      )}
    </div>
  );
}
