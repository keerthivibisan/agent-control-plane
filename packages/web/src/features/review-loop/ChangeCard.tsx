import type {
  ChangeReviewDto,
  ChangeReviewRoundDto,
  ReviewDto,
  RunDetailDto,
  TicketCommentDto,
} from '@acp/core/api';
import { Button, ButtonLink } from '../../components/Button';
import { Card } from '../../components/Card';
import { DiffSection } from '../../components/diff';
import { AlertIcon } from '../../components/icons';
import { InfoTip } from '../../components/InfoTip';
import { Badge, Pill } from '../../components/Pill';
import { RelativeTime } from '../../components/RelativeTime';
import { reviewAction } from '../../lib/api';
import { href } from '../../lib/router';
import {
  CONTROL_COPY,
  REVIEW_LOOP_COPY,
  WORKFLOW_LIVE_COPY,
  changeStateWord,
} from '../../lib/copy';
import { ActionError, ConfirmAction } from '../control/bits';
import { REVIEW_PAGE_COPY } from '../review/copy';
import { useTicketAction } from '../ticket/actions';
import { Files } from '../ticket/ChangesTab';
import { ReworkIcon } from './icons';
import {
  changeTone,
  checksSummary,
  leadIsLive,
  ownerMayDecide,
  reworkRoundsBy,
  shortCommit,
} from './logic';
import { ReasonForm } from './ReasonForm';

const C = REVIEW_LOOP_COPY.changes;
const O = REVIEW_LOOP_COPY.changes.owner;
const D = WORKFLOW_LIVE_COPY.changes;
const MAX_REASON = 500;
const MAX_COMMENT = 4000;

type AgentReview = ReviewDto['agents'][number];

/** "Rework round 1 of 2" as a pill with its tip; `data-state` is the change's state. */
export function ChangeStateChip({
  change,
  branch,
}: {
  change: Pick<ChangeReviewDto, 'state' | 'reworkRounds' | 'maxReworkRounds'>;
  branch: string | null;
}) {
  const word = changeStateWord(change.state, {
    round: change.reworkRounds,
    max: change.maxReworkRounds,
    branch,
  });
  return (
    <span
      className="inline-flex items-center gap-1"
      data-testid="change-state"
      data-state={change.state}
    >
      <Pill tone={changeTone(change.state)}>{word}</Pill>
      <InfoTip tip={C.stateTip[change.state]} label={word} />
    </span>
  );
}

/** The checks on the change's own commit: passed, failed (required) or none yet. */
export function ChangeChecks({ change }: { change: Pick<ChangeReviewDto, 'checks'> }) {
  const s = checksSummary(change.checks);
  return (
    <span className="text-caption" data-testid="change-checks" data-checks={s.kind}>
      {s.kind === 'failed' ? (
        <span className="font-medium text-danger">
          <span aria-hidden="true" className="mr-1 font-semibold">
            ✗
          </span>
          {C.checks.failed(s.failing.length)}
        </span>
      ) : s.kind === 'stopped' ? (
        <span className="text-dim">{C.checks.stopped}</span>
      ) : s.kind === 'passed' ? (
        <span className={s.passed === s.total ? 'text-success' : 'text-dim'}>
          <span aria-hidden="true" className="mr-1 font-semibold">
            ✓
          </span>
          {C.checks.passed(s.passed, s.total)}
        </span>
      ) : (
        <span className="text-dim">{C.checks.none}</span>
      )}
    </span>
  );
}

function Conflicts({ files, branch }: { files: readonly string[]; branch: string | null }) {
  if (files.length === 0) return null;
  return (
    <div
      role="note"
      className="flex items-start gap-2 rounded-control border border-warning/30 bg-warning-soft px-3 py-2 text-caption"
      data-testid="change-conflicts"
    >
      <AlertIcon size={14} className="mt-px shrink-0 text-warning" />
      <div className="min-w-0">
        <p className="font-medium text-ink">{C.conflicts(branch ?? C.branchFallback)}</p>
        <ul className="mt-1 flex flex-col gap-0.5">
          {files.map((f) => (
            <li key={f} className="font-mono break-all">
              {f}
            </li>
          ))}
        </ul>
        <p className="mt-1 text-dim">{C.conflictsNote}</p>
      </div>
    </div>
  );
}

/**
 * One round in words: "Review agent asked for rework · Lead sent it back for rework". A round the
 * review agent decided itself (ADR-0023, route "direct") is one sentence: it sent the change
 * straight back to the helper.
 */
export function roundSentence(r: ChangeReviewRoundDto): string {
  if (r.decidedBy === 'reviewer' && r.decision !== null) {
    return r.decision === 'rework'
      ? D.directRework
      : `${C.decider.reviewer} ${C.decision[r.decision]}`;
  }
  const parts: string[] = [];
  if (r.reviewer === 'agent' && r.verdict !== null) {
    parts.push(`${C.reviewer.agent} ${C.verdict[r.verdict]}`);
  } else if (r.reviewer === 'agent' && r.decision === null) {
    parts.push(`${C.reviewer.agent} ${C.reviewing}`);
  }
  if (r.decision !== null && r.decidedBy !== null) {
    parts.push(`${C.decider[r.decidedBy]} ${C.decision[r.decision]}`);
  }
  return parts.join(' · ');
}

/** The rounds, oldest first, each with the findings or note kept as a ticket comment. */
function History({
  change,
  comments,
}: {
  change: Pick<ChangeReviewDto, 'reviews'>;
  comments: readonly TicketCommentDto[];
}) {
  return (
    <section aria-label={C.history} className="flex flex-col gap-2" data-testid="change-history">
      <h4 className="text-caption font-medium">{C.history}</h4>
      {change.reviews.length === 0 ? (
        <p className="text-caption text-dim">{C.historyEmpty}</p>
      ) : (
        <ol className="relative flex flex-col gap-3 before:absolute before:top-2 before:bottom-2 before:left-[3px] before:border-l before:border-line">
          {change.reviews.map((r, i) => {
            const comment =
              r.commentId === null ? null : (comments.find((c) => c.id === r.commentId) ?? null);
            // A decider's note on a round the review agent commented on is its own row with the
            // same decision (RL-V); the reviewer's row then says only what the reviewer said.
            const notedLater = change.reviews
              .slice(i + 1)
              .some(
                (o) =>
                  o.round === r.round &&
                  o.decision !== null &&
                  o.decision === r.decision &&
                  o.decidedBy === r.decidedBy &&
                  o.reviewer === o.decidedBy,
              );
            const sentence = roundSentence(
              notedLater ? { ...r, decision: null, decidedBy: null } : r,
            );
            return (
              <li key={r.id} className="relative flex flex-col gap-1.5 pl-4" data-round={r.round}>
                <span
                  aria-hidden="true"
                  className={`absolute top-1.5 left-0 size-[7px] rounded-full ring-3 ring-panel ${
                    r.decision === 'rework' || r.verdict === 'rework'
                      ? 'bg-warning'
                      : r.decision === 'merge' || r.decision === 'merge-anyway'
                        ? 'bg-success'
                        : 'bg-line-strong'
                  }`}
                />
                <p className="flex flex-wrap items-baseline gap-x-2 text-caption">
                  <span className="font-medium">{C.round(r.round)}</span>
                  <span className="text-ink">{sentence}</span>
                  <span className="ml-auto text-dim tabular-nums">
                    <RelativeTime iso={r.decidedAt ?? r.createdAt} />
                  </span>
                </p>
                {r.commentId !== null ? (
                  comment === null ? (
                    <p className="text-caption text-dim">{C.commentGone}</p>
                  ) : (
                    <blockquote
                      className="max-h-48 overflow-auto rounded-control border border-line bg-hover px-3 py-2 text-caption whitespace-pre-wrap"
                      data-testid="change-finding"
                    >
                      {comment.body}
                    </blockquote>
                  )
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/**
 * Route "direct" (ADR-0023): how often the review agent sent this change straight back to its
 * helper, and the lead's own rounds. Nothing for a change only the lead sent back.
 */
function DirectRounds({ change }: { change: Pick<ChangeReviewDto, 'reviews'> }) {
  const reviewer = reworkRoundsBy(change, 'reviewer');
  if (reviewer === 0) return null;
  const text = D.directRounds(reviewer, reworkRoundsBy(change, 'lead'));
  return (
    <p className="flex items-center gap-1 text-caption text-dim" data-testid="change-direct-rounds">
      <ReworkIcon size={12} className="shrink-0" />
      <span>{text}</span>
      <InfoTip tip={D.directRoundsTip} label={text} />
    </p>
  );
}

/**
 * The owner's override (README §7): only for a change the lead handed over, or once the lead has
 * ended. Merge into the ticket branch (or merge anyway past a failed required check, with a
 * reason), send back for rework with a comment, or discard. The server checks again.
 */
function OwnerDecision({
  run,
  change,
  branch,
}: {
  run: Pick<RunDetailDto, 'id' | 'agents'>;
  change: ChangeReviewDto;
  branch: string | null;
}) {
  const act = useTicketAction(reviewAction);
  const checks = checksSummary(change.checks);
  const id = change.agentRunId;
  const into = branch ?? C.branchFallback;
  return (
    <section
      aria-label={O.title}
      className="flex flex-col gap-2.5 rounded-control border border-warning/30 bg-warning-soft px-3.5 py-3"
      data-testid="owner-decision"
    >
      <p className="flex items-center gap-2 font-medium">
        <AlertIcon size={15} className="shrink-0 text-warning" />
        {O.title}
      </p>
      <p className="text-caption text-dim">
        {change.state === 'needs-owner' && leadIsLive(run) ? O.asked : O.leadEnded}
      </p>
      <div className="flex flex-wrap items-start gap-2">
        {checks.kind === 'failed' ? (
          <ReasonForm
            openLabel={REVIEW_LOOP_COPY.branch.mergeAnyway}
            title={REVIEW_LOOP_COPY.branch.mergeAnywayTitle}
            label={REVIEW_LOOP_COPY.branch.reasonLabel}
            hint={REVIEW_LOOP_COPY.branch.reasonHint}
            placeholder={REVIEW_LOOP_COPY.branch.reasonPlaceholder}
            max={MAX_REASON}
            tooLong={REVIEW_LOOP_COPY.branch.reasonTooLong(MAX_REASON)}
            submitLabel={REVIEW_LOOP_COPY.branch.confirmMergeAnyway}
            cancelLabel={O.cancel}
            pendingLabel={O.working}
            pending={act.pending}
            tone="danger"
            testId="change-merge-anyway"
            onConfirm={(reason) =>
              act.run(run.id, { agentRunId: id, action: 'merge-anyway', reason })
            }
          />
        ) : (
          <ConfirmAction
            label={O.merge(into)}
            question={O.confirmMerge(change.role, into)}
            confirmLabel={O.confirmMergeButton}
            cancelLabel={O.cancel}
            pendingLabel={O.working}
            pending={act.pending}
            danger={false}
            primary
            onConfirm={() => act.run(run.id, { agentRunId: id, action: 'merge' })}
          />
        )}
        <ReasonForm
          openLabel={O.rework}
          title={O.reworkTitle}
          label={O.reworkTitle}
          hint={O.reworkHint}
          placeholder={O.reworkPlaceholder}
          max={MAX_COMMENT}
          tooLong={O.reworkTooLong(MAX_COMMENT)}
          submitLabel={O.sendRework}
          cancelLabel={O.cancel}
          pendingLabel={O.working}
          pending={act.pending}
          testId="change-rework"
          extra={
            change.reworkRounds >= change.maxReworkRounds
              ? O.reworkExtra(change.reworkRounds, change.maxReworkRounds)
              : undefined
          }
          onConfirm={(comment) => act.run(run.id, { agentRunId: id, action: 'rework', comment })}
        />
        <ConfirmAction
          label={O.discard}
          question={O.confirmDiscard(change.role)}
          confirmLabel={O.confirmDiscardButton}
          cancelLabel={O.cancel}
          pendingLabel={O.working}
          pending={act.pending}
          onConfirm={() => act.run(run.id, { agentRunId: id, action: 'discard' })}
        />
      </div>
      <ActionError error={act.error} message={O.failed} />
    </section>
  );
}

/**
 * One helper's change in the review loop (ADR-0021, the ticket page's Changes tab): its state,
 * checks on its commit, conflicting files, the decisions with the reviewer's findings, the files
 * and diff, and the owner's override when it is the owner's turn.
 */
export function ChangeCard({
  run,
  change,
  review,
  comments,
  branch,
}: {
  /** With the run's project and ticket, the card links to the change's review page (D-A). */
  run: Pick<RunDetailDto, 'id' | 'agents'> & Partial<Pick<RunDetailDto, 'projectId' | 'ticketId'>>;
  change: ChangeReviewDto;
  /** The change's files and diff from `GET /runs/:id/review`, once the server lists it there. */
  review: AgentReview | undefined;
  comments: readonly TicketCommentDto[];
  /** The run's ticket branch name, once it exists. */
  branch: string | null;
}) {
  return (
    <article
      aria-label={C.cardLabel(change.role)}
      className="flex flex-col gap-3"
      data-testid="change-card"
      data-agent={change.agentRunId}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <ChangeStateChip change={change} branch={branch} />
        <ChangeChecks change={change} />
        <span className="ml-auto text-caption text-dim tabular-nums">
          {/* The file list below says how many once the review has it. */}
          {review === undefined ? C.files(change.changedFiles) : null}
          {change.headCommit !== null ? (
            <span className="ml-2 font-mono" title={change.headCommit}>
              {shortCommit(change.headCommit)}
            </span>
          ) : null}
        </span>
        {change.headCommit !== null && run.projectId !== undefined && run.ticketId ? (
          <ButtonLink
            size="sm"
            href={href.ticketChange({
              projectId: run.projectId,
              ticketId: run.ticketId,
              agentRunId: change.agentRunId,
              runId: run.id,
            })}
            data-testid="change-review-files"
          >
            {REVIEW_PAGE_COPY.entry.change}
          </ButtonLink>
        ) : null}
      </div>
      <DirectRounds change={change} />
      <Conflicts files={change.conflictFiles} branch={branch} />
      {ownerMayDecide(change, run) ? (
        <OwnerDecision run={run} change={change} branch={branch} />
      ) : null}
      <History change={change} comments={comments} />
      {review !== undefined ? (
        <>
          <Files files={review.files} />
          {review.files.length > 0 || review.diff.length > 0 ? (
            <DiffSection
              summary={CONTROL_COPY.review.diff}
              diff={review.diff}
              truncated={review.diffTruncated}
              files={review.files.map((f) => f.path)}
              testId="change-diff"
            />
          ) : null}
        </>
      ) : null}
    </article>
  );
}

/**
 * Every change of the run in one card under the agents (README §7): one row each with its state,
 * checks and rounds, and Open, which shows the change in the side panel.
 */
export function ChangesOverview({
  run,
  branch,
  onOpen,
}: {
  run: Pick<RunDetailDto, 'agents' | 'changes'>;
  branch: string | null;
  onOpen: (agentRunId: string) => void;
}) {
  const changes = run.changes ?? [];
  if (changes.length === 0) return null;
  return (
    <Card title={C.allTitle} padded={false} testId="changes-overview">
      <ul className="flex flex-col divide-y divide-line">
        {changes.map((c) => (
          <li
            key={c.agentRunId}
            className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3"
            data-testid="change-row"
            data-agent={c.agentRunId}
          >
            <span className="min-w-0 font-medium">{c.role}</span>
            <ChangeStateChip change={c} branch={branch} />
            <ChangeChecks change={c} />
            {c.reworkRounds - reworkRoundsBy(c, 'reviewer') > 0 ? (
              <Badge>
                <span className="inline-flex items-center gap-1">
                  <ReworkIcon size={12} />
                  {REVIEW_LOOP_COPY.graph.rework(c.reworkRounds - reworkRoundsBy(c, 'reviewer'))}
                </span>
              </Badge>
            ) : null}
            {reworkRoundsBy(c, 'reviewer') > 0 ? (
              <Badge>
                <span className="inline-flex items-center gap-1" data-testid="change-direct-badge">
                  <ReworkIcon size={12} />
                  {D.directBadge(reworkRoundsBy(c, 'reviewer'))}
                </span>
              </Badge>
            ) : null}
            {c.conflictFiles.length > 0 ? <Badge tone="warning">{C.conflictsShort}</Badge> : null}
            <Button size="sm" className="ml-auto" onClick={() => onOpen(c.agentRunId)}>
              {C.needsYou.open}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** "2 changes need your decision": above the agents while any change waits for the owner. */
export function NeedsYouChanges({
  run,
  onOpen,
}: {
  run: Pick<RunDetailDto, 'agents' | 'changes'>;
  onOpen: (agentRunId: string) => void;
}) {
  const waiting = (run.changes ?? []).filter((c) => ownerMayDecide(c, run));
  if (waiting.length === 0) return null;
  return (
    <section
      aria-label={C.needsYou.title(waiting.length)}
      data-testid="changes-need-you"
      className="rounded-card border border-warning/30 bg-warning-soft px-5 py-4"
    >
      <h2 className="flex items-center gap-2 text-title font-semibold">
        <AlertIcon size={16} className="text-warning" />
        {C.needsYou.title(waiting.length)}
      </h2>
      <p className="mt-0.5 text-dim">{C.needsYou.description}</p>
      <ul className="mt-3 flex flex-col divide-y divide-line overflow-hidden rounded-control border border-line bg-panel">
        {waiting.map((c) => (
          <li
            key={c.agentRunId}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5"
          >
            <span className="font-medium">{c.role}</span>
            <ChangeChecks change={c} />
            <Button size="sm" className="ml-auto" onClick={() => onOpen(c.agentRunId)}>
              {C.needsYou.open}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
