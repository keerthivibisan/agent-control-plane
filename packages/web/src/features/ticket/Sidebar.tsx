import type { AgentRunDto, RunDetailDto, TicketDetailDto, TicketDto } from '@acp/core/api';
import type { ComponentType, ReactNode } from 'react';
import { Details } from '../../components/Details';
import {
  BugIcon,
  ChoreIcon,
  FeatureIcon,
  HarnessIcon,
  type IconProps,
} from '../../components/icons';
import { InfoTip } from '../../components/InfoTip';
import { Badge, type PillTone } from '../../components/Pill';
import { RelativeTime } from '../../components/RelativeTime';
import { paths, schemas } from '../../lib/api';
import { REVIEW_LOOP_COPY, RUN_STATUS_COPY, TICKET_COPY, TICKET_PAGE_COPY } from '../../lib/copy';
import { formatCount } from '../../lib/format';
import { useApiQuery } from '../../lib/query';
import { href } from '../../lib/router';
import { sessionName } from '../../lib/session-name';
import { PullRequestInfo } from '../branching/PullRequest';
import { TicketBranchSection } from '../branching/TicketBranchFields';
import { StatusWord } from '../control/bits';
import { TicketRunOptionsSection } from '../review-loop/RunOptions';
import { runBudgetUsed, runNumber } from './ticket-state';

const C = TICKET_COPY;
const S = TICKET_PAGE_COPY.sidebar;
const RL = REVIEW_LOOP_COPY;

/** GitHub's sidebar heading: small, semibold, quiet. */
const HEADING = 'text-caption font-semibold text-dim';

const TYPE_ICON: Record<TicketDto['type'], ComponentType<IconProps>> = {
  feature: FeatureIcon,
  bug: BugIcon,
  chore: ChoreIcon,
  harness: HarnessIcon,
};

/** Urgency reads in the tag's tone as well as its word. */
const PRIORITY_TONE: Record<TicketDto['priority'], PillTone> = {
  low: 'neutral',
  medium: 'neutral',
  high: 'warning',
  urgent: 'danger',
};

/** "Feature" with its icon (the icon adds no text). */
function TypeBadge({ type }: { type: TicketDto['type'] }) {
  const Icon = TYPE_ICON[type];
  return (
    <Badge>
      <span className="inline-flex items-center gap-1">
        <Icon size={12} />
        {C.type[type]}
      </span>
    </Badge>
  );
}

function Section({
  title,
  tip,
  children,
  testId,
}: {
  title: string;
  tip?: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className="flex flex-col gap-2" data-testid={testId} aria-label={title}>
      <h3 className={`flex min-h-7 items-center gap-1 ${HEADING}`}>
        {title}
        {tip ? <InfoTip tip={tip} label={title} /> : null}
      </h3>
      {children}
    </section>
  );
}

/** A label over its value. */
function Fact({
  label,
  children,
  testId,
}: {
  label: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-caption text-dim">{label}</dt>
      <dd className="min-w-0 break-words" data-testid={testId}>
        {children}
      </dd>
    </div>
  );
}

/** One agent's Claude Code session, by the name the Sessions page gives it (ADR-0024). */
function SessionLink({ agent }: { agent: AgentRunDto & { sessionId: string } }) {
  const session = useApiQuery(paths.session(agent.sessionId), schemas.session);
  const name = session.data ? sessionName(session.data) : S.sessionOf(agent.role);
  return (
    <li className="flex min-w-0 flex-col">
      <a href={href.session(agent.sessionId)} className="min-w-0 break-words">
        {name}
      </a>
      <span className="text-caption text-dim">
        {C.roles[agent.kind].term} · {agent.role}
      </span>
    </li>
  );
}

function ThisRun({ detail, run }: { detail: TicketDetailDto; run: RunDetailDto | undefined }) {
  if (run === undefined) {
    return (
      <Section title={S.thisRun} testId="sidebar-run">
        <p className="text-dim">{S.noRun}</p>
      </Section>
    );
  }
  const n = runNumber(detail.runs, run.id);
  return (
    <Section title={S.thisRun} testId="sidebar-run">
      <dl className="flex flex-col gap-2">
        <Fact label={n === null ? S.started : S.runOf(n, detail.runs.length)}>
          <span className="inline-flex flex-wrap items-center gap-x-2">
            <StatusWord status={RUN_STATUS_COPY[run.status]} value={run.status} withTip={false} />
            <span className="text-caption text-dim">
              <RelativeTime iso={run.createdAt} />
            </span>
          </span>
        </Fact>
        {run.approvalMode !== undefined ? (
          <Fact label={S.approvals} testId="run-approval-mode">
            {RL.modes.word[run.approvalMode]}
          </Fact>
        ) : null}
        <Fact label={S.budget} testId="run-budget">
          <span className="inline-flex items-center gap-1 tabular-nums">
            {C.summary.budget(runBudgetUsed(run.agents))}
            <InfoTip tip={S.budgetTip} label={S.budget} />
          </span>
        </Fact>
      </dl>
    </Section>
  );
}

/**
 * The Conversation tab's sidebar (v0.3.0 D-B), GitHub's pull request sidebar: small headings over
 * their values. The ticket's branch and target, its pull request, its run options, its labels, the
 * run on screen, and the sessions of that run's agents. Changes open in dialogs.
 */
export function TicketSidebar({
  detail,
  run,
  isCurrent,
}: {
  detail: TicketDetailDto;
  run: RunDetailDto | undefined;
  isCurrent: boolean;
}) {
  const { ticket } = detail;
  const pr = run?.ticketBranch?.pullRequest ?? null;
  const sessions = (run?.agents ?? []).filter(
    (a): a is AgentRunDto & { sessionId: string } => a.sessionId !== null,
  );
  return (
    <aside
      aria-label={S.label}
      data-testid="ticket-sidebar"
      className="flex min-w-0 flex-col divide-y divide-line-muted text-ink [&>*]:py-4 [&>*:first-child]:pt-0"
    >
      <TicketBranchSection key={`branch-${ticket.updatedAt}`} detail={detail} heading={HEADING} />
      <Section title={S.pullRequest} testId="sidebar-pull-request">
        {pr !== null ? (
          // Refresh reads the ticket's current branch: only for the current run's pull request.
          <PullRequestInfo pr={pr} ticketId={isCurrent ? ticket.id : null} />
        ) : (
          <p className="text-caption text-dim">{S.noPullRequest}</p>
        )}
      </Section>
      <TicketRunOptionsSection key={ticket.updatedAt} ticket={ticket} heading={HEADING} />
      <Section title={S.labels} testId="ticket-labels">
        <div className="flex flex-wrap gap-1.5">
          <TypeBadge type={ticket.type} />
          <Badge tone={PRIORITY_TONE[ticket.priority]}>{C.priority[ticket.priority]}</Badge>
          {ticket.labels.map((l) => (
            <Badge key={l}>{l}</Badge>
          ))}
        </div>
      </Section>
      <ThisRun detail={detail} run={run} />
      <Section title={S.sessions} testId="sidebar-sessions">
        {sessions.length === 0 ? (
          <p className="text-caption text-dim">{S.noSessions}</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {sessions.map((a) => (
              <SessionLink key={a.id} agent={a} />
            ))}
          </ul>
        )}
      </Section>
      <div>
        <Details summary={S.details}>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-caption">
            <dt className="text-dim">{C.ticket.ticketId}</dt>
            <dd className="font-mono break-all">{ticket.id}</dd>
            <dt className="text-dim">{C.ticket.created}</dt>
            <dd>
              <RelativeTime iso={ticket.createdAt} />
            </dd>
            <dt className="text-dim">{C.history.runs}</dt>
            <dd className="tabular-nums">{formatCount(detail.runs.length)}</dd>
          </dl>
        </Details>
      </div>
    </aside>
  );
}
