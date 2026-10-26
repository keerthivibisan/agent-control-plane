import type {
  ActivityItemDto,
  TicketCommentDto,
  TicketDetailDto,
  TicketPlanDto,
} from '@acp/core/api';
import {
  Bot,
  CircleCheck,
  ClipboardList,
  ExternalLink,
  Eye,
  FileDiff,
  FileText,
  Flag,
  GitMerge,
  GitPullRequest,
  MessageSquareText,
  Play,
  Scale,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Button, ButtonLink } from '../../components/Button';
import { Details } from '../../components/Details';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Pill } from '../../components/Pill';
import { RelativeTime } from '../../components/RelativeTime';
import { LoadingBlock } from '../../components/Skeleton';
import { activityPaths, activitySchemas, type ApiError } from '../../lib/api';
import { RUN_SUMMARY_COPY, TICKET_COPY } from '../../lib/copy';
import { formatCount } from '../../lib/format';
import { useApiQuery } from '../../lib/query';
import { href } from '../../lib/router';
import { PlanBody, planStatusWord } from '../ticket/PlanReview';
import { MergeLine, RunSummaryCard } from '../ticket/RunSummary';
import { parseMergeLine } from '../ticket/run-summary';
import { ACTIVITY_ID, runNumber } from '../ticket/ticket-state';
import { activityFromDetail, actorFilters, actorKey } from './activity-from-detail';
import { ACTIVITY_COPY } from './copy';
import { RichText } from './RichText';
import { BoxHeader, Marker, Row, Thread } from './timeline-parts';

const A = ACTIVITY_COPY;

type Item = ActivityItemDto;
type MarkerTone = 'neutral' | 'avatar' | 'accent' | 'success' | 'done';

const ICON: Record<Item['type'], LucideIcon> = {
  'run-started': Play,
  'run-ended': Flag,
  plan: FileText,
  'agent-started': Bot,
  'agent-ended': CircleCheck,
  'agent-note': MessageSquareText,
  review: Eye,
  note: MessageSquareText,
  decision: Scale,
  'run-facts': ClipboardList,
  merge: GitMerge,
  'pull-request': GitPullRequest,
};

const TONE: Partial<Record<Item['type'], MarkerTone>> = {
  review: 'accent',
  merge: 'done',
  'pull-request': 'success',
};

function ItemIcon({ item, size = 14 }: { item: Item; size?: number }) {
  const Lucide = item.actor.kind === 'owner' ? UserRound : ICON[item.type];
  return <Lucide size={size} strokeWidth={1.75} aria-hidden="true" focusable="false" />;
}

/** Item types drawn as a box with the text written for the ticket; the rest are event lines. */
const BOXED: ReadonlySet<Item['type']> = new Set(['agent-note', 'review', 'note', 'decision']);

/** The parts of the item's title after its actor's name, so the name is said once, in bold. */
function TitleWithActor({ item }: { item: Item }) {
  const { label } = item.actor;
  const rest = item.title.startsWith(label) ? item.title.slice(label.length) : null;
  if (item.type === 'review') {
    return (
      <>
        <Pill tone="accent" testId="comment-author" title={TICKET_COPY.comments.reviewerTip}>
          {label}
        </Pill>
        <span className="text-ink">{rest ?? item.title}</span>
      </>
    );
  }
  return rest !== null ? (
    <span className="text-ink">
      <strong className="font-semibold" data-testid="comment-author">
        {label}
      </strong>
      {rest}
    </span>
  ) : (
    <span className="text-ink">
      <strong className="font-semibold" data-testid="comment-author">
        {label}
      </strong>{' '}
      <span aria-hidden="true">·</span> {item.title}
    </span>
  );
}

function RunLabel({ runs, runId }: { runs: TicketDetailDto['runs']; runId: string | null }) {
  const n = runId === null ? null : runNumber(runs, runId);
  return n === null ? null : <span className="tabular-nums">{RUN_SUMMARY_COPY.ofRun(n)}</span>;
}

/** Where the item points (ActivityItemDto.link): a change, the ticket's files, a pull request. */
function ItemLink({ item, detail }: { item: Item; detail: TicketDetailDto }) {
  const link = item.link;
  if (link === null || link.kind === 'plan') return null;
  const ticket = { projectId: detail.ticket.projectId, ticketId: detail.ticket.id };
  if (link.kind === 'pull-request') {
    return (
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-caption font-medium text-accent hover:underline"
        data-testid="activity-link"
        data-link="pull-request"
      >
        <GitPullRequest size={13} strokeWidth={1.75} aria-hidden="true" />
        {A.pullRequest}
        <ExternalLink size={12} strokeWidth={1.75} aria-hidden="true" />
        <span className="sr-only">{A.opensOnGitHub}</span>
      </a>
    );
  }
  const to =
    link.kind === 'change'
      ? href.ticketChange({ ...ticket, agentRunId: link.agentRunId, runId: item.runId })
      : href.ticketFiles({ ...ticket, runId: item.runId });
  return (
    <ButtonLink
      href={to}
      size="sm"
      className="w-fit"
      data-testid="activity-link"
      data-link={link.kind}
    >
      <FileDiff size={14} strokeWidth={1.75} aria-hidden="true" />
      {link.kind === 'change' ? A.filesChanged : A.ticketFiles}
    </ButtonLink>
  );
}

/** A comment shape for the run summary card and the merge line, which read only these. */
function asComment(item: Item, detail: TicketDetailDto): TicketCommentDto {
  return {
    id: item.id,
    ticketId: detail.ticket.id,
    runId: item.runId,
    planId: null,
    author: 'app',
    body: item.body ?? item.title,
    createdAt: item.at,
  };
}

function PlanDisclosure({ plan }: { plan: TicketPlanDto | undefined }) {
  if (plan === undefined) return <p className="text-caption text-dim">{A.planGone}</p>;
  return (
    <Details summary={A.showPlan}>
      <PlanBody plan={plan} />
    </Details>
  );
}

function ItemView({
  item,
  detail,
  shownRunId,
  onShowRun,
}: {
  item: Item;
  detail: TicketDetailDto;
  shownRunId: string | null;
  onShowRun: (runId: string) => void;
}) {
  const data = { 'data-type': item.type };
  const author = item.actor.kind;

  if (item.type === 'run-facts') {
    const n = item.runId === null ? null : runNumber(detail.runs, item.runId);
    return (
      <Row
        author={author}
        testId="activity-item"
        data={data}
        badge={
          <Marker>
            <ItemIcon item={item} />
          </Marker>
        }
      >
        <div className="flex flex-col gap-2">
          <RunSummaryCard
            comment={asComment(item, detail)}
            runLabel={n === null ? null : RUN_SUMMARY_COPY.ofRun(n)}
          />
          <ItemLink item={item} detail={detail} />
        </div>
      </Row>
    );
  }

  if (item.type === 'merge' || item.type === 'pull-request') {
    const note = parseMergeLine(item.body ?? item.title);
    if (note !== null) {
      return (
        <Row
          event
          author={author}
          testId="activity-item"
          data={data}
          badge={
            <Marker tone={TONE[item.type] ?? 'neutral'}>
              <ItemIcon item={item} />
            </Marker>
          }
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <MergeLine comment={asComment(item, detail)} note={note} />
            <ItemLink item={item} detail={detail} />
          </div>
        </Row>
      );
    }
  }

  if (BOXED.has(item.type) && item.body !== null) {
    const reviewer = item.type === 'review';
    return (
      <Row
        author={author}
        testId="activity-item"
        data={data}
        badge={
          <Marker tone={item.actor.kind === 'owner' ? 'avatar' : (TONE[item.type] ?? 'avatar')}>
            <ItemIcon item={item} size={16} />
          </Marker>
        }
      >
        <article
          aria-label={item.title}
          className={`overflow-hidden rounded-card border bg-panel ${
            reviewer ? 'border-line border-l-2 border-l-accent' : 'border-line'
          }`}
        >
          <BoxHeader>
            <TitleWithActor item={item} />
            <RunLabel runs={detail.runs} runId={item.runId} />
            <span className="ml-auto">
              <RelativeTime iso={item.at} />
            </span>
          </BoxHeader>
          <div className="flex flex-col gap-3 px-4 py-3">
            <RichText text={item.body} testId="activity-body" />
            <ItemLink item={item} detail={detail} />
          </div>
        </article>
      </Row>
    );
  }

  const plan =
    item.link?.kind === 'plan'
      ? detail.plans.find((p) => p.id === (item.link?.kind === 'plan' ? item.link.planId : ''))
      : undefined;
  const runKnown = item.runId !== null && detail.runs.some((r) => r.id === item.runId);
  return (
    <Row
      event
      author={author}
      testId={
        item.type === 'run-started'
          ? 'timeline-run'
          : item.type === 'plan'
            ? 'timeline-plan'
            : 'activity-item'
      }
      data={{ ...data, 'data-activity': '' }}
      badge={
        <Marker tone={TONE[item.type] ?? 'neutral'}>
          <ItemIcon item={item} />
        </Marker>
      }
    >
      <div className="flex flex-col gap-2">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-dim tabular-nums">
          <span className="font-medium text-ink">{item.title}</span>
          {item.type !== 'run-started' &&
          item.type !== 'plan' &&
          !item.title.startsWith(item.actor.label) ? (
            <span>{item.actor.label}</span>
          ) : null}
          {plan !== undefined ? (
            <span data-plan-status={plan.status}>{planStatusWord(plan)}</span>
          ) : null}
          <span aria-hidden="true">·</span>
          <RelativeTime iso={item.at} />
          {item.type === 'run-started' && runKnown && item.runId !== null ? (
            item.runId === shownRunId ? (
              <span className="text-caption">({A.shownRun})</span>
            ) : (
              <Button
                variant="quiet"
                size="sm"
                onClick={() => item.runId !== null && onShowRun(item.runId)}
              >
                {A.showRun}
              </Button>
            )
          ) : null}
          <ItemLink item={item} detail={detail} />
        </p>
        {item.body !== null && item.type !== 'run-started' ? (
          <RichText text={item.body} className="text-ink" testId="activity-body" />
        ) : null}
        {item.link?.kind === 'plan' ? <PlanDisclosure plan={plan} /> : null}
      </div>
    </Row>
  );
}

/** Everyone, then one chip per actor, each with how many items it has. */
function Filters({
  items,
  chosen,
  onChoose,
}: {
  items: readonly Item[];
  chosen: string | null;
  onChoose: (key: string | null) => void;
}) {
  const actors = actorFilters(items);
  if (actors.length < 2) return null;
  const chip = (key: string | null, label: string, count: number) => {
    const pressed = chosen === key;
    return (
      <button
        key={key ?? 'all'}
        type="button"
        aria-pressed={pressed}
        onClick={() => onChoose(key)}
        data-testid="activity-filter"
        data-actor={key ?? 'all'}
        className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-caption font-medium transition-colors ${
          pressed
            ? 'border-accent bg-accent-soft text-accent'
            : 'border-line bg-panel text-dim hover:border-line-strong hover:text-ink'
        }`}
      >
        {label}
        <span className="tabular-nums opacity-80">{formatCount(count)}</span>
      </button>
    );
  };
  return (
    <div role="group" aria-label={A.filter} className="flex flex-wrap items-center gap-2">
      <span className="text-caption font-semibold text-dim">{A.filter}</span>
      {chip(null, A.all, items.length)}
      {actors.map((a) => chip(a.key, a.label, a.count))}
    </div>
  );
}

/** The items, from the server's activity, or from the ticket's records on a server without it. */
export function useActivity(detail: TicketDetailDto): {
  items: Item[] | null;
  error: ApiError | null;
} {
  const q = useApiQuery(activityPaths.activity(detail.ticket.id), activitySchemas.activity);
  if (q.data !== undefined) return { items: q.data.items, error: null };
  if (q.error === null) return { items: null, error: null };
  // A server before 0.3.0 has no such route: read what the ticket's own records say.
  const missing = q.error.kind === 'http' && q.error.status === 404;
  return { items: activityFromDetail(detail), error: missing ? null : q.error };
}

/**
 * The Conversation tab (v0.3.0 C-B, ADR-0026): what happened on the ticket, oldest first, from
 * `GET /api/tickets/:id/activity`: runs and plan versions, agents starting and ending and their
 * notes, the reviewer's findings, the lead's notes and decisions, the run facts, merges and pull
 * requests. Chips above it show one actor's items only.
 */
export function ActivityTimeline({
  detail,
  shownRunId,
  onShowRun,
}: {
  detail: TicketDetailDto;
  /** The run on screen: its line says so instead of offering Show. */
  shownRunId: string | null;
  onShowRun: (runId: string) => void;
}) {
  const { items, error } = useActivity(detail);
  if (items === null) return <LoadingBlock label={A.loading} />;
  return (
    <ActivityView
      detail={detail}
      items={items}
      error={error}
      shownRunId={shownRunId}
      onShowRun={onShowRun}
    />
  );
}

/** The timeline of `items`, with its filter chips (the tab's body once the items are known). */
export function ActivityView({
  detail,
  items,
  error = null,
  shownRunId,
  onShowRun,
}: {
  detail: TicketDetailDto;
  items: readonly Item[];
  /** Why the server's activity couldn't be read, when `items` are the page's own instead. */
  error?: ApiError | null;
  shownRunId: string | null;
  onShowRun: (runId: string) => void;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  // A chip whose actor has no items any more falls back to everyone.
  const active = chosen !== null && items.some((i) => actorKey(i.actor) === chosen) ? chosen : null;
  const shown = active === null ? items : items.filter((i) => actorKey(i.actor) === active);
  const activeLabel = actorFilters(items).find((a) => a.key === active)?.label;
  return (
    <section
      id={ACTIVITY_ID}
      aria-label={A.label}
      className="flex min-w-0 scroll-mt-24 flex-col gap-4"
      data-testid="activity"
    >
      {error !== null ? (
        <Details summary={A.failed}>
          <ErrorNotice error={error} />
        </Details>
      ) : null}
      <Filters items={items} chosen={active} onChoose={setChosen} />
      {items.length === 0 ? (
        <p className="text-dim">{A.empty}</p>
      ) : shown.length === 0 ? (
        <p className="text-dim">{A.noneFor(activeLabel ?? '')}</p>
      ) : (
        <Thread label={A.label}>
          {shown.map((item) => (
            <ItemView
              key={item.id}
              item={item}
              detail={detail}
              shownRunId={shownRunId}
              onShowRun={onShowRun}
            />
          ))}
        </Thread>
      )}
    </section>
  );
}

/** The Conversation tab's count: its items once known. */
export function useActivityCount(detail: TicketDetailDto): number | null {
  return useActivity(detail).items?.length ?? null;
}
