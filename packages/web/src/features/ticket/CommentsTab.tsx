import type {
  AttachmentDto,
  CheckRunDto,
  RunDetailDto,
  TicketCommentDto,
  TicketDetailDto,
} from '@acp/core/api';
import { motion } from 'motion/react';
import { useId, useState } from 'react';
import { Button } from '../../components/Button';
import { Details } from '../../components/Details';
import { AlertIcon, MergeIcon, TicketIcon } from '../../components/icons';
import { inputClass } from '../../components/Input';
import { enter, fadeUp } from '../../components/motion';
import { Pill } from '../../components/Pill';
import { RelativeTime } from '../../components/RelativeTime';
import { activityPaths, activitySchemas, addTicketComment, updateTicket } from '../../lib/api';
import { TICKET_COPY, TICKET_PAGE_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { commentsTabParts } from '../activity/comment-kind';
import { COMMENTS_COPY } from '../activity/copy';
import { RichText } from '../activity/RichText';
import { BoxHeader, Marker, Row, Thread } from '../activity/timeline-parts';
import { AttachButton, AttachmentList, DropZone, UploadList } from '../attachments/Attachments';
import { useUploads, type Uploads } from '../attachments/use-uploads';
import { Approvals } from '../control/Approvals';
import { ActionError } from '../control/bits';
import { NeedsYouChanges } from '../review-loop/ChangeCard';
import { isReviewLoopRun, ownerMayDecide } from '../review-loop/logic';
import { useTicketAction } from './actions';
import { FinalStepBox } from './FinalStep';
import { AgentsIcon, ConversationIcon, OwnerIcon } from './icons';
import { PlanCard } from './PlanReview';
import type { AgentReview, TicketBranchReview } from './run-data';
import type { PanelTab } from './SidePanel';
import { useTicketNav } from './ticket-nav';
import {
  ACTIVITY_ID,
  COMMENTS_ID,
  NEEDS_YOU_ID,
  agentChecks,
  mergeGate,
  planUnderReview,
} from './ticket-state';

const C = TICKET_COPY;
const P = TICKET_PAGE_COPY.conversation;
const K = COMMENTS_COPY;
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

/** The ticket's attachments, read on their own; none on a server before 0.3.0. */
function useTicketAttachments(ticketId: string): readonly AttachmentDto[] {
  const q = useApiQuery(activityPaths.attachments(ticketId), activitySchemas.attachments);
  return q.data ?? [];
}

/**
 * The first box of the thread, GitHub's pull request body: the ticket's key, its description
 * (Edit sends `{ description }`) and the files attached to the ticket itself, with Attach files.
 */
function Description({
  detail,
  attachments,
  onTicket,
}: {
  detail: TicketDetailDto;
  /** The ticket's own attachments (not a comment's). */
  attachments: readonly AttachmentDto[];
  /** Every attachment on the ticket, for its limit. */
  onTicket: number;
}) {
  const { ticket } = detail;
  const save = useTicketAction(updateTicket);
  const [draft, setDraft] = useState<string | null>(null);
  const textId = useId();
  const uploads = useUploads({ ticketId: ticket.id, onTicket, forComment: false });
  return (
    <Row
      badge={
        <Marker tone="avatar">
          <TicketIcon size={16} />
        </Marker>
      }
      testId="ticket-info"
    >
      <DropZone onFiles={uploads.add} testId="ticket-drop">
        <article
          aria-label={P.description}
          className="overflow-hidden rounded-card border border-line bg-panel shadow-card"
        >
          <BoxHeader>
            <span className="font-mono font-semibold text-ink" data-testid="ticket-key">
              {ticket.key}
            </span>
            <span aria-hidden="true">·</span>
            <h2 className="font-semibold text-ink">{P.description}</h2>
            <span>
              {P.created} <RelativeTime iso={ticket.createdAt} />
            </span>
            {draft === null ? (
              <span className="ml-auto flex items-center gap-1">
                <AttachButton onFiles={uploads.add} />
                <Button
                  variant="quiet"
                  size="sm"
                  aria-label={P.editLabel}
                  onClick={() => {
                    save.reset();
                    setDraft(ticket.description);
                  }}
                >
                  {C.ticket.edit}
                </Button>
              </span>
            ) : null}
          </BoxHeader>
          <div className="flex flex-col gap-3 px-4 py-3">
            {draft === null ? (
              ticket.description.trim().length > 0 ? (
                <RichText text={ticket.description} testId="ticket-description" />
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
            <AttachmentList
              attachments={attachments}
              label={K.ticketAttachments}
              canDelete
              testId="ticket-attachments"
            />
            <UploadList uploads={uploads.uploads} onRemove={uploads.remove} />
          </div>
        </article>
      </DropZone>
    </Row>
  );
}

/** A person's comment: a box with its author, time, text and attachments. */
function CommentBox({
  comment,
  version,
}: {
  comment: TicketCommentDto;
  /** The plan version it was written on (the owner's "request changes"), if any. */
  version?: number | undefined;
}) {
  const owner = comment.author === 'owner';
  return (
    <Row
      author={comment.author}
      testId="comment"
      badge={
        <Marker tone="avatar">{owner ? <OwnerIcon size={16} /> : <AgentsIcon size={16} />}</Marker>
      }
    >
      <article
        className={`overflow-hidden rounded-card border bg-panel ${
          owner ? 'border-line-strong' : 'border-line'
        }`}
      >
        <BoxHeader strong={owner}>
          <span className="font-semibold text-ink" data-testid="comment-author">
            {owner ? C.comments.you : C.comments.lead}
          </span>
          {version !== undefined ? <span>{C.comments.onPlan(version)}</span> : null}
          <RelativeTime iso={comment.createdAt} />
        </BoxHeader>
        <div className="flex flex-col gap-3 px-4 py-3">
          <RichText text={comment.body} testId="comment-body" />
          <AttachmentList
            attachments={comment.attachments ?? []}
            label={C.comments.you}
            canDelete={owner}
            testId="comment-attachments"
          />
        </div>
      </article>
    </Row>
  );
}

/**
 * The lead's summary of the whole ticket (ADR-0026 §2): one card, the newest version, marked
 * "Updated" once a later run rewrote it; earlier versions folded under it.
 */
function TicketSummary({
  summary,
  earlier,
}: {
  summary: TicketCommentDto;
  earlier: readonly TicketCommentDto[];
}) {
  return (
    <Row
      author="lead"
      testId="ticket-summary-comment"
      badge={
        <Marker tone="accent">
          <AgentsIcon size={16} />
        </Marker>
      }
    >
      <article
        aria-label={K.summary.title}
        className="overflow-hidden rounded-card border border-accent/40 bg-panel shadow-card"
      >
        <BoxHeader>
          <span className="font-semibold text-ink" data-testid="comment-author">
            {K.lead}
          </span>
          <Pill tone="accent" title={K.summary.tip}>
            {K.summary.title}
          </Pill>
          {earlier.length > 0 ? (
            <Pill
              tone="neutral"
              testId="summary-updated"
              title={K.summary.updatedTip(earlier.length)}
            >
              {K.summary.updated}
            </Pill>
          ) : null}
          <span className="ml-auto">
            <RelativeTime iso={summary.createdAt} />
          </span>
        </BoxHeader>
        <div className="flex flex-col gap-3 px-4 py-3">
          <RichText text={summary.body} testId="summary-body" />
          {earlier.length > 0 ? (
            <Details summary={K.summary.earlier(earlier.length)} testId="earlier-summaries">
              <ol className="flex flex-col gap-4">
                {earlier.map((c) => (
                  <li key={c.id} className="flex flex-col gap-1">
                    <span className="text-caption text-dim">
                      <RelativeTime iso={c.createdAt} />
                    </span>
                    <RichText text={c.body} className="text-dim" />
                  </li>
                ))}
              </ol>
            </Details>
          ) : null}
        </div>
      </article>
    </Row>
  );
}

/**
 * The comment box: text (safe formatting) and files, attached by the button or by dropping them
 * on the box. Files upload as soon as they are picked; the comment carries their ids.
 */
function CommentForm({ ticketId, uploads }: { ticketId: string; uploads: Uploads }) {
  const add = useTicketAction(addTicketComment);
  const [body, setBody] = useState('');
  const id = useId();
  const hintId = useId();
  const tooLong = body.length > MAX_COMMENT;
  return (
    <Row
      badge={
        <Marker tone="avatar">
          <OwnerIcon size={16} />
        </Marker>
      }
    >
      <DropZone onFiles={uploads.add} testId="comment-drop">
        <form
          className="flex flex-col gap-2 rounded-card border border-line bg-panel p-3"
          data-testid="comment-form"
          onSubmit={(e) => {
            e.preventDefault();
            const text = body.trim();
            if (text.length === 0 || tooLong || uploads.busy) return;
            const ids = uploads.ids;
            void add
              .run(ticketId, ids.length > 0 ? { body: text, attachmentIds: ids } : { body: text })
              .then((done) => {
                if (done !== null) {
                  setBody('');
                  uploads.clear();
                }
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
            aria-describedby={hintId}
            className={inputClass('resize-y px-3 py-2')}
          />
          {tooLong ? <span className="text-caption text-danger">{K.composer.tooLong}</span> : null}
          <UploadList uploads={uploads.uploads} onRemove={uploads.remove} />
          <div className="flex flex-wrap items-center gap-2">
            <AttachButton onFiles={uploads.add} />
            <span id={hintId} className="min-w-0 flex-1 text-caption text-dim">
              {K.composer.formatting}
            </span>
            <Button
              type="submit"
              variant="primary"
              disabled={add.pending || tooLong || uploads.busy || body.trim().length === 0}
            >
              {add.pending ? C.comments.adding : C.comments.add}
            </Button>
          </div>
          <ActionError error={add.error} message={C.comments.failed} />
        </form>
      </DropZone>
    </Row>
  );
}

/** Points to Conversation, where what the agents did is. */
function ActivityHint() {
  const nav = useTicketNav();
  if (nav === null) return null;
  return (
    <p className="flex flex-wrap items-center gap-1.5 pl-12 text-caption text-dim">
      <ConversationIcon size={14} />
      {K.activityHint}
      <button
        type="button"
        className="font-medium text-accent hover:underline"
        data-testid="open-conversation"
        onClick={() => nav.goTo('conversation', ACTIVITY_ID)}
      >
        {K.activityLink}
      </button>
    </p>
  );
}

/**
 * The Comments tab (v0.3.0 C-B, ADR-0026), the ticket's home: what waits for you and the plan to
 * review first, then the thread (the description with the ticket's attachments, the lead's
 * ticket summary and people's comments), the final-step box and the comment box. What the
 * agents did is on Conversation.
 */
export function CommentsTab({
  detail,
  run,
  reviews,
  checks,
  branchReview,
  onOpenAgent,
}: {
  detail: TicketDetailDto;
  run: RunDetailDto | undefined;
  reviews: readonly AgentReview[];
  checks: readonly CheckRunDto[];
  branchReview: TicketBranchReview;
  onOpenAgent: (agentId: string, tab?: PanelTab) => void;
}) {
  const plan = run === undefined ? null : planUnderReview(run, detail.plans);
  const all = useTicketAttachments(detail.ticket.id);
  // The comment box's files are on the ticket until the comment that carries them is posted;
  // they show in the box, not among the ticket's own.
  const pending = useUploads({
    ticketId: detail.ticket.id,
    onTicket: all.length,
    forComment: true,
  });
  const pendingIds = new Set(pending.ids);
  const parts = commentsTabParts(detail.comments);
  const versionOf = new Map(detail.plans.map((p) => [p.id, p.version]));
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="comments-tab">
      {run !== undefined ? (
        <NeedsYou run={run} reviews={reviews} checks={checks} onOpenAgent={onOpenAgent} />
      ) : null}
      {plan !== null ? <PlanCard ticketId={detail.ticket.id} plan={plan} /> : null}
      <section
        id={COMMENTS_ID}
        aria-label={K.thread}
        className="flex scroll-mt-24 flex-col gap-4"
        data-testid="comments"
      >
        <Thread>
          <Description
            key={detail.ticket.updatedAt}
            detail={detail}
            attachments={all.filter((a) => a.commentId === null && !pendingIds.has(a.id))}
            onTicket={all.length}
          />
          {parts.summary !== null ? (
            <TicketSummary summary={parts.summary} earlier={parts.earlierSummaries} />
          ) : null}
          {parts.comments.map((c) => (
            <CommentBox
              key={c.id}
              comment={c}
              version={c.planId ? versionOf.get(c.planId) : undefined}
            />
          ))}
          {run !== undefined && run.ticketBranch ? (
            <Row
              badge={
                <Marker>
                  <MergeIcon size={14} />
                </Marker>
              }
            >
              <FinalStepBox run={run} ticket={detail.ticket} branchReview={branchReview} />
            </Row>
          ) : null}
          <CommentForm ticketId={detail.ticket.id} uploads={pending} />
        </Thread>
        <ActivityHint />
      </section>
    </div>
  );
}
