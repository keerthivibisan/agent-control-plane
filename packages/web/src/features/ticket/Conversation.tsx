import type {
  CheckRunDto,
  RunDetailDto,
  RunSummaryDto,
  TicketCommentDto,
  TicketDetailDto,
  TicketPlanDto,
} from '@acp/core/api';
import { motion } from 'motion/react';
import { useId, useState, type ReactNode } from 'react';
import { Button } from '../../components/Button';
import { Details } from '../../components/Details';
import { AlertIcon, MergeIcon, TicketIcon } from '../../components/icons';
import { inputClass } from '../../components/Input';
import { enter, fadeUp } from '../../components/motion';
import { Pill } from '../../components/Pill';
import { RelativeTime } from '../../components/RelativeTime';
import { addTicketComment, updateTicket } from '../../lib/api';
import { RUN_STATUS_COPY, RUN_SUMMARY_COPY, TICKET_COPY, TICKET_PAGE_COPY } from '../../lib/copy';
import { Approvals } from '../control/Approvals';
import { ActionError, StatusWord } from '../control/bits';
import { NeedsYouChanges } from '../review-loop/ChangeCard';
import { isReviewLoopRun, ownerMayDecide } from '../review-loop/logic';
import { useTicketAction } from './actions';
import { FinalStepBox } from './FinalStep';
import { AgentsIcon, OwnerIcon, PlanIcon, RunStartedIcon } from './icons';
import { PlanBody, PlanCard, planStatusWord } from './PlanReview';
import { AppComment } from './RunSummary';
import type { AgentReview, TicketBranchReview } from './run-data';
import type { PanelTab } from './SidePanel';
import {
  COMMENTS_ID,
  NEEDS_YOU_ID,
  agentChecks,
  mergeGate,
  planUnderReview,
  runNumber,
} from './ticket-state';

const C = TICKET_COPY;
const P = TICKET_PAGE_COPY.conversation;
const MAX_DESCRIPTION = 20_000;
const MAX_COMMENT = 8000;

/** In review (a run before the review loop): one line per helper with its changes and checks. */
function ReviewList({
  run,
  reviews,
  checks,
  onOpen,
}: {
  run: RunDetailDto;
  reviews: readonly AgentReview[];
  checks: readonly CheckRunDto[];
  onOpen: (agentId: string) => void;
}) {
  // Only once every agent has stopped; a helper that stopped early is reviewed from its card.
  if (run.status !== 'REVIEW' && run.status !== 'NEEDS_REVIEW') return null;
  const waiting = run.agents.filter((a) => a.review?.state === 'pending');
  if (waiting.length === 0) return null;
  return (
    <section
      aria-label={C.review.title}
      data-testid="review-list"
      className="rounded-card border border-warning/30 bg-warning-soft px-5 py-4"
    >
      <h2 className="flex items-center gap-2 text-title font-semibold">
        <AlertIcon size={16} className="text-warning" />
        {C.review.title}
      </h2>
      <p className="mt-0.5 text-dim">{C.review.description}</p>
      <ul className="mt-3 flex flex-col divide-y divide-line overflow-hidden rounded-control border border-line bg-panel">
        {waiting.map((a) => {
          const gate = mergeGate(agentChecks(checks, a.id).latest);
          const review = reviews.find((r) => r.agentRunId === a.id);
          return (
            <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
              <span className="font-medium">{a.role}</span>
              <span className="text-caption text-dim">
                {C.review.files(review ? review.files.length : (a.review?.changedFiles ?? null))}
              </span>
              <span className="text-caption">
                {gate.kind === 'blocked' ? (
                  <span aria-hidden="true" className="mr-1.5 font-semibold text-danger">
                    ✗
                  </span>
                ) : gate.kind === 'passed' ? (
                  <span aria-hidden="true" className="mr-1.5 font-semibold text-success">
                    ✓
                  </span>
                ) : null}
                <span className={gate.kind === 'blocked' ? 'text-danger' : 'text-dim'}>
                  {gate.kind === 'blocked'
                    ? C.review.checksFailed
                    : gate.kind === 'passed'
                      ? C.review.checksPassed
                      : C.review.checksNone}
                </span>
              </span>
              <Button size="sm" className="ml-auto" onClick={() => onOpen(a.id)}>
                {C.review.open}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * What waits for the owner in this run, first on the tab: the agents' requests, the changes the
 * lead handed over (review loop) or, before the loop, the helpers to review.
 */
function NeedsYou({
  run,
  reviews,
  checks,
  onOpenAgent,
}: {
  run: RunDetailDto;
  reviews: readonly AgentReview[];
  checks: readonly CheckRunDto[];
  onOpenAgent: (agentId: string, tab?: PanelTab) => void;
}) {
  const pending = run.approvals.filter((a) => a.status === 'pending');
  const loop = isReviewLoopRun(run);
  const changes = loop && (run.changes ?? []).some((c) => ownerMayDecide(c, run));
  const legacy =
    !loop &&
    (run.status === 'REVIEW' || run.status === 'NEEDS_REVIEW') &&
    run.agents.some((a) => a.review?.state === 'pending');
  if (pending.length === 0 && !changes && !legacy) return null;
  return (
    <div id={NEEDS_YOU_ID} className="flex scroll-mt-24 flex-col gap-4" aria-label={P.needsYou}>
      {pending.length > 0 ? (
        <motion.div {...enter(fadeUp)}>
          <Approvals approvals={pending} agents={run.agents} />
        </motion.div>
      ) : null}
      {loop ? (
        <NeedsYouChanges run={run} onOpen={(id) => onOpenAgent(id, 'changes')} />
      ) : (
        <ReviewList
          run={run}
          reviews={reviews}
          checks={checks}
          onOpen={(id) => onOpenAgent(id, 'changes')}
        />
      )}
    </div>
  );
}

/** A round marker on the timeline's line, behind an item: an icon or an avatar, decorative. */
function Marker({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'avatar';
}) {
  return (
    <span
      aria-hidden="true"
      className={`absolute top-0 left-0 flex size-8 items-center justify-center rounded-full border ${
        tone === 'avatar' ? 'border-line bg-panel text-ink' : 'border-line bg-subtle text-dim'
      }`}
    >
      {children}
    </span>
  );
}

/** One timeline row: the marker on the line, then the item. */
function Row({
  badge,
  children,
  testId,
  author,
  event = false,
}: {
  badge: ReactNode;
  children: ReactNode;
  testId?: string;
  author?: string;
  /** A small event line (run started, a plan, a merge) instead of a comment box. */
  event?: boolean;
}) {
  return (
    <li
      className={`relative min-w-0 pl-12 ${event ? 'flex min-h-8 flex-col justify-center' : ''}`}
      data-testid={testId}
      data-author={author}
    >
      {badge}
      {children}
    </li>
  );
}

/** The ticket's description as the first box of the timeline, with Edit (GitHub's PR body). */
function Description({ detail }: { detail: TicketDetailDto }) {
  const { ticket } = detail;
  const save = useTicketAction(updateTicket);
  const [draft, setDraft] = useState<string | null>(null);
  const textId = useId();
  return (
    <Row
      badge={
        <Marker tone="avatar">
          <TicketIcon size={16} />
        </Marker>
      }
      testId="ticket-info"
    >
      <article
        aria-label={P.description}
        className="overflow-hidden rounded-card border border-line bg-panel shadow-card"
      >
        <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-subtle px-4 py-2 text-caption text-dim">
          <h2 className="font-semibold text-ink">{P.description}</h2>
          <span>
            {P.created} <RelativeTime iso={ticket.createdAt} />
          </span>
          {draft === null ? (
            <Button
              variant="quiet"
              size="sm"
              className="ml-auto"
              aria-label={P.editLabel}
              onClick={() => {
                save.reset();
                setDraft(ticket.description);
              }}
            >
              {C.ticket.edit}
            </Button>
          ) : null}
        </header>
        <div className="px-4 py-3">
          {draft === null ? (
            ticket.description.trim().length > 0 ? (
              <p className="leading-6 whitespace-pre-wrap" data-testid="ticket-description">
                {ticket.description}
              </p>
            ) : (
              <p className="text-dim">{C.ticket.noDescription}</p>
            )
          ) : (
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (draft.length > MAX_DESCRIPTION) return;
                void save.run(ticket.id, { description: draft }).then((done) => {
                  if (done !== null) setDraft(null);
                });
              }}
            >
              <label htmlFor={textId} className="sr-only">
                {C.ticket.description}
              </label>
              <textarea
                id={textId}
                rows={6}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                // The box replaces the text the owner just chose to edit.
                autoFocus
                className={inputClass('resize-y px-3 py-2')}
              />
              <div className="flex flex-wrap justify-end gap-2">
                <Button onClick={() => setDraft(null)} disabled={save.pending}>
                  {C.ticket.cancel}
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={save.pending || draft.length > MAX_DESCRIPTION}
                >
                  {save.pending ? C.ticket.saving : C.ticket.save}
                </Button>
              </div>
              <ActionError error={save.error} message={C.ticket.saveFailed} />
            </form>
          )}
        </div>
      </article>
    </Row>
  );
}

/** A comment by you, the lead or the reviewer, as a box with its author and time. */
function CommentBox({
  comment,
  version,
}: {
  comment: TicketCommentDto;
  version?: number | undefined;
}) {
  const reviewer = comment.author === 'reviewer';
  const owner = comment.author === 'owner';
  return (
    <Row
      author={comment.author}
      badge={
        <Marker tone="avatar">{owner ? <OwnerIcon size={16} /> : <AgentsIcon size={16} />}</Marker>
      }
    >
      <article
        className={`overflow-hidden rounded-card border bg-panel ${
          owner
            ? 'border-line-strong'
            : reviewer
              ? 'border-line border-l-2 border-l-accent'
              : 'border-line'
        }`}
      >
        <header
          className={`flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-2 text-caption text-dim ${
            owner ? 'border-line-strong bg-panel' : 'border-line bg-subtle'
          }`}
        >
          {reviewer ? (
            // The reviewer's findings get their own label, apart from you and the lead.
            <Pill tone="accent" testId="comment-author" title={C.comments.reviewerTip}>
              {C.comments.reviewer}
            </Pill>
          ) : (
            <span className="font-semibold text-ink" data-testid="comment-author">
              {owner ? C.comments.you : C.comments.lead}
            </span>
          )}
          {version !== undefined ? <span>{C.comments.onPlan(version)}</span> : null}
          <RelativeTime iso={comment.createdAt} />
        </header>
        <p className="px-4 py-3 leading-6 whitespace-pre-wrap">{comment.body}</p>
      </article>
    </Row>
  );
}

/** "Run 2 started · Agents working · 3 min ago", and Show for a run that isn't on screen. */
function RunEvent({
  runs,
  run,
  shown,
  onShow,
}: {
  runs: readonly RunSummaryDto[];
  run: RunSummaryDto;
  shown: boolean;
  onShow: () => void;
}) {
  const n = runNumber(runs, run.id) ?? 0;
  return (
    <Row
      event
      testId="timeline-run"
      badge={
        <Marker>
          <RunStartedIcon size={14} />
        </Marker>
      }
    >
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-dim tabular-nums">
        <span className="font-medium text-ink">{P.runStarted(n)}</span>
        <StatusWord status={RUN_STATUS_COPY[run.status]} value={run.status} withTip={false} />
        <span aria-hidden="true">·</span>
        <RelativeTime iso={run.createdAt} />
        {shown ? (
          <span className="text-caption">({P.shownRun})</span>
        ) : (
          <Button variant="quiet" size="sm" onClick={onShow}>
            {P.showRun}
          </Button>
        )}
      </p>
    </Row>
  );
}

/** A plan version: where it stands, and its steps behind "Show the plan". */
function PlanEvent({ plan }: { plan: TicketPlanDto }) {
  return (
    <Row
      event
      testId="timeline-plan"
      badge={
        <Marker>
          <PlanIcon size={14} />
        </Marker>
      }
    >
      <div className="flex flex-col gap-2">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-dim tabular-nums">
          <span className="font-medium text-ink">{P.plan(plan.version)}</span>
          <span data-plan-status={plan.status}>{planStatusWord(plan)}</span>
          <span aria-hidden="true">·</span>
          <span>{C.plan.helpers(plan.plannedHelpers)}</span>
          <span aria-hidden="true">·</span>
          <RelativeTime iso={plan.createdAt} />
        </p>
        <Details summary={P.showPlan}>
          <PlanBody plan={plan} />
        </Details>
      </div>
    </Row>
  );
}

type Item =
  | { kind: 'run'; at: string; run: RunSummaryDto }
  | { kind: 'plan'; at: string; plan: TicketPlanDto }
  | { kind: 'comment'; at: string; comment: TicketCommentDto };

/** Same moment: the run first, then its plan, then what was said about it. */
const ORDER: Record<Item['kind'], number> = { run: 0, plan: 1, comment: 2 };

/**
 * Everything that happened on the ticket, oldest first: each run starting, each plan version
 * (except the one waiting for you, shown above), and the comments of you, the lead, the reviewer
 * and the app (run summaries and merge lines).
 */
export function timelineItems(
  detail: Pick<TicketDetailDto, 'runs' | 'plans' | 'comments'>,
  skipPlanId: string | null,
): Item[] {
  const items: Item[] = [
    ...detail.runs.map((run): Item => ({ kind: 'run', at: run.createdAt, run })),
    ...detail.plans
      .filter((p) => p.id !== skipPlanId)
      .map((plan): Item => ({ kind: 'plan', at: plan.createdAt, plan })),
    ...detail.comments.map((comment): Item => ({
      kind: 'comment',
      at: comment.createdAt,
      comment,
    })),
  ];
  return items.sort((a, b) =>
    a.at === b.at ? ORDER[a.kind] - ORDER[b.kind] : a.at < b.at ? -1 : 1,
  );
}

function CommentForm({ ticketId }: { ticketId: string }) {
  const add = useTicketAction(addTicketComment);
  const [body, setBody] = useState('');
  const id = useId();
  const tooLong = body.length > MAX_COMMENT;
  return (
    <Row
      badge={
        <Marker tone="avatar">
          <OwnerIcon size={16} />
        </Marker>
      }
    >
      <form
        className="flex flex-col gap-2 rounded-card border border-line bg-panel p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const text = body.trim();
          if (text.length === 0 || tooLong) return;
          void add.run(ticketId, { body: text }).then((done) => {
            if (done !== null) setBody('');
          });
        }}
      >
        <label htmlFor={id} className="text-caption font-semibold">
          {C.comments.label}
        </label>
        <textarea
          id={id}
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={C.comments.placeholder}
          aria-invalid={tooLong ? true : undefined}
          className={inputClass('resize-y px-3 py-2')}
        />
        {tooLong ? <span className="text-caption text-danger">{C.canvas.tooLong}</span> : null}
        <div className="flex justify-end">
          <Button
            type="submit"
            variant="primary"
            disabled={add.pending || tooLong || body.trim().length === 0}
          >
            {add.pending ? C.comments.adding : C.comments.add}
          </Button>
        </div>
        <ActionError error={add.error} message={C.comments.failed} />
      </form>
    </Row>
  );
}

/**
 * The Conversation tab (v0.3.0 D-B), GitHub's: what waits for you and the plan to review first,
 * then the timeline (the description, runs, plan versions and comments), the final-step box and
 * the comment box.
 */
export function Conversation({
  detail,
  run,
  reviews,
  checks,
  branchReview,
  onOpenAgent,
  onShowRun,
}: {
  detail: TicketDetailDto;
  run: RunDetailDto | undefined;
  reviews: readonly AgentReview[];
  checks: readonly CheckRunDto[];
  branchReview: TicketBranchReview;
  onOpenAgent: (agentId: string, tab?: PanelTab) => void;
  onShowRun: (runId: string) => void;
}) {
  const plan = run === undefined ? null : planUnderReview(run, detail.plans);
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="conversation">
      {run !== undefined ? (
        <NeedsYou run={run} reviews={reviews} checks={checks} onOpenAgent={onOpenAgent} />
      ) : null}
      {plan !== null ? <PlanCard ticketId={detail.ticket.id} plan={plan} /> : null}
      <Timeline
        detail={detail}
        shownRunId={run?.id ?? null}
        skipPlanId={plan?.id ?? null}
        onShowRun={onShowRun}
        finalStep={
          run !== undefined && run.ticketBranch ? (
            <FinalStepBox run={run} ticket={detail.ticket} branchReview={branchReview} />
          ) : null
        }
      />
    </div>
  );
}

/**
 * The timeline: the description, then every run, plan version and comment oldest first, the
 * final-step box (`finalStep`) and the comment box.
 */
export function Timeline({
  detail,
  shownRunId,
  skipPlanId = null,
  onShowRun,
  finalStep = null,
}: {
  detail: TicketDetailDto;
  /** The run on screen: its line says so instead of offering Show. */
  shownRunId: string | null;
  /** The plan shown above the timeline for your decision. */
  skipPlanId?: string | null;
  onShowRun: (runId: string) => void;
  finalStep?: ReactNode;
}) {
  const versionOf = new Map(detail.plans.map((p) => [p.id, p.version]));
  const items = timelineItems(detail, skipPlanId);
  return (
    <section
      id={COMMENTS_ID}
      aria-label={P.timeline}
      className="flex scroll-mt-24 flex-col"
      data-testid="comments"
    >
      <ol className="relative flex flex-col gap-5 before:absolute before:top-4 before:bottom-4 before:left-4 before:border-l-2 before:border-line-muted">
        <Description key={detail.ticket.updatedAt} detail={detail} />
        {items.map((item) => {
          if (item.kind === 'run') {
            return (
              <RunEvent
                key={`run-${item.run.id}`}
                runs={detail.runs}
                run={item.run}
                shown={item.run.id === shownRunId}
                onShow={() => onShowRun(item.run.id)}
              />
            );
          }
          if (item.kind === 'plan')
            return <PlanEvent key={`plan-${item.plan.id}`} plan={item.plan} />;
          const c = item.comment;
          if (c.author === 'app') {
            // Written by the app itself: the run summary card, or the line after a merge.
            const n = c.runId ? runNumber(detail.runs, c.runId) : null;
            return (
              <Row
                key={c.id}
                author={c.author}
                badge={
                  <Marker>
                    <TicketIcon size={14} />
                  </Marker>
                }
              >
                <AppComment comment={c} runLabel={n === null ? null : RUN_SUMMARY_COPY.ofRun(n)} />
              </Row>
            );
          }
          const version = c.planId ? versionOf.get(c.planId) : undefined;
          return <CommentBox key={c.id} comment={c} version={version} />;
        })}
        {finalStep !== null ? (
          <Row
            badge={
              <Marker>
                <MergeIcon size={14} />
              </Marker>
            }
          >
            {finalStep}
          </Row>
        ) : null}
        <CommentForm ticketId={detail.ticket.id} />
      </ol>
    </section>
  );
}
