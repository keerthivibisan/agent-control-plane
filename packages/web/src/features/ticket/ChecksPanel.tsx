import type { CheckRunDto, RunDetailDto, SetupRunDto } from '@acp/core/api';
import type { ReactNode } from 'react';
import { EmptyState } from '../../components/EmptyState';
import { InfoTip } from '../../components/InfoTip';
import { ticketPaths, ticketSchemas } from '../../lib/api';
import {
  HARNESS_BLOCKS_COPY,
  REVIEW_LOOP_COPY,
  TICKET_COPY,
  TICKET_PAGE_COPY,
} from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { SetupRunList } from '../harness/SetupRuns';
import { canRecheckChange, isReviewLoopRun, latestChecks } from '../review-loop/logic';
import { CheckRow, ChecksTab, checkPlace } from './ChecksTab';
import { ChecksIcon } from './icons';
import type { AgentReview, TicketBranchReview } from './run-data';
import { agentChecks, hasWorktree } from './ticket-state';

const B = REVIEW_LOOP_COPY.branch;
const K = TICKET_PAGE_COPY.checks;
const HT = HARNESS_BLOCKS_COPY.ticket;

/**
 * The tab's count: the latest run of each check on the tip, and on each change at each place it
 * ran (on the change and before the lead's merge are separate results).
 */
export function checksCount(
  run: Pick<RunDetailDto, 'agents'> | undefined,
  checks: readonly CheckRunDto[],
  branchReview: Pick<TicketBranchReview, 'query'>,
): number {
  if (run === undefined) return 0;
  const tip = latestChecks(branchReview.query.data?.checks ?? []).length;
  const places = ['change', 'merge'] as const;
  return run.agents
    .filter((a) => hasWorktree(a.kind))
    .reduce(
      (sum, a) =>
        sum +
        places.reduce(
          (n, p) =>
            n +
            agentChecks(
              checks.filter((c) => checkPlace(c) === p),
              a.id,
            ).latest.length,
          0,
        ),
      tip,
    );
}

/** A run's setup runs by the copy they prepared: an agent's own copy, or a checks copy (null). */
export interface SetupGroup {
  agentRunId: string | null;
  runs: SetupRunDto[];
}

/** Groups setup runs by agent, in the order they first ran; the steps keep their run order. */
export function groupSetupRuns(runs: readonly SetupRunDto[]): SetupGroup[] {
  const sorted = [...runs].sort((a, b) =>
    a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0,
  );
  const groups: SetupGroup[] = [];
  for (const r of sorted) {
    const group = groups.find((g) => g.agentRunId === r.agentRunId);
    if (group === undefined) groups.push({ agentRunId: r.agentRunId, runs: [r] });
    else group.runs.push(r);
  }
  return groups;
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

/** A group of boxes under one heading (one place where checks run). */
function Group({
  title,
  tip,
  testId,
  children,
}: {
  title: string;
  tip: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-3" data-testid={testId}>
      <h2 className="flex items-center gap-1 text-title font-semibold">
        {title}
        <InfoTip tip={tip} label={title} />
      </h2>
      {children}
    </section>
  );
}

function CheckList({ checks, testId }: { checks: readonly CheckRunDto[]; testId?: string }) {
  return (
    <ul
      className="flex flex-col divide-y divide-line rounded-card border border-line"
      data-testid={testId}
    >
      {checks.map((c) => (
        <CheckRow key={c.id} check={c} />
      ))}
    </ul>
  );
}

/**
 * The Checks tab (v0.3.0 D-B; grouped by block since ADR-0027, H-D): the setup runs first (per
 * agent copy, then the checks' copies), then the check runs by where they ran: on each change
 * (per helper), before the lead's merge (per helper, with "Run checks again" while the change
 * still waits; rows from before ADR-0027 have no place and show here, as they always did), on the
 * ticket branch (the tip the final merge counts) and "Run now" on the main branch.
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
  // The ticket page has the ticket's detail cached already; its setup runs are the current run's.
  const ticketId = run?.ticketId ?? null;
  const detail = useApiQuery(
    ticketId === null ? null : ticketPaths.ticket(ticketId),
    ticketSchemas.detail,
  ).data;
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
  const setup = groupSetupRuns((detail?.setupRuns ?? []).filter((r) => r.runId === run.id));
  const roleOf = (id: string | null) =>
    id === null ? HT.setupForChecks : HT.setupFor(run.agents.find((a) => a.id === id)?.role ?? id);

  const byPlace = (p: string) => checks.filter((c) => checkPlace(c) === p);
  const onChange = helpers.filter((a) => byPlace('change').some((c) => c.agentRunId === a.id));
  // The tip's checks come from the ticket branch's review while it is open, else from the run.
  const reviewTip = latestChecks(branchReview.query.data?.checks ?? []);
  const tip = reviewTip.length > 0 ? reviewTip : latestChecks(byPlace('branch'));
  const main = latestChecks(byPlace('main'));

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="checks-tab">
      {setup.length > 0 ? (
        <Group title={HT.setupTitle} tip={HT.setupTip} testId="setup-runs">
          {setup.map((g) => (
            <Box
              key={g.agentRunId ?? 'checks'}
              title={roleOf(g.agentRunId)}
              level={3}
              testId={`setup-runs-${g.agentRunId ?? 'checks'}`}
            >
              <SetupRunList runs={g.runs} label={roleOf(g.agentRunId)} />
            </Box>
          ))}
        </Group>
      ) : null}
      {onChange.length > 0 ? (
        <Group title={HT.groups.change} tip={HT.groupTips.change} testId="change-checks">
          {onChange.map((a) => (
            <Box key={a.id} title={a.role} level={3} testId={`change-checks-${a.id}`}>
              <ChecksTab
                runId={run.id}
                agent={a}
                checks={checks}
                canRunAgain={false}
                place="change"
              />
            </Box>
          ))}
        </Group>
      ) : null}
      {helpers.length === 0 ? (
        <p className="text-dim">{K.none}</p>
      ) : (
        <Group title={HT.groups.merge} tip={HT.groupTips.merge} testId="merge-checks">
          {helpers.map((a) => (
            <Box key={a.id} title={a.role} level={3} testId={`agent-checks-${a.id}`}>
              <ChecksTab
                runId={run.id}
                agent={a}
                checks={checks}
                place="merge"
                canRunAgain={
                  loop
                    ? canRecheckChange(run, a.id)
                    : reviews.find((r) => r.agentRunId === a.id)?.state === 'pending'
                }
              />
            </Box>
          ))}
        </Group>
      )}
      {run.ticketBranch || tip.length > 0 ? (
        <Box title={HT.groups.branch} tip={TICKET_COPY.checks.tip} testId="tip-checks">
          {branchReview.mode === 'waiting' && tip.length === 0 ? (
            <p className="text-dim">{B.waiting}</p>
          ) : tip.length === 0 ? (
            <p className="text-caption text-dim">{B.checksNone}</p>
          ) : (
            <CheckList checks={tip} testId="branch-checks" />
          )}
        </Box>
      ) : null}
      {main.length > 0 ? (
        <Box title={HT.groups.main} tip={HT.groupTips.main} testId="main-checks">
          <CheckList checks={main} />
        </Box>
      ) : null}
    </div>
  );
}
