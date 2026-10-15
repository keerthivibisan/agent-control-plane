import type { AgentRunDto, CheckRunDto, ReviewDto } from '@acp/core/api';
import { useId, useState } from 'react';
import { Button } from '../../components/Button';
import { Details } from '../../components/Details';
import { reviewAction } from '../../lib/api';
import { CONTROL_COPY, TICKET_COPY } from '../../lib/copy';
import { formatCount } from '../../lib/format';
import { ActionError, ConfirmAction, dangerButtonClass } from '../control/bits';
import { DiffView } from '../control/ReviewPanel';
import { isAgentLive } from '../control/run-state';
import { useTicketAction } from './actions';
import { agentChecks, mergeGate } from './ticket-state';

const C = TICKET_COPY.changes;
const R = CONTROL_COPY.review;
const MAX_REASON = 500;

type AgentReview = ReviewDto['agents'][number];

function Files({ review }: { review: AgentReview }) {
  if (review.files.length === 0) return <p className="text-dim">{R.noFiles}</p>;
  return (
    <div>
      <p className="text-caption font-medium">{R.files(review.files.length)}</p>
      <ul className="mt-1 divide-y divide-line">
        {review.files.map((f) => (
          <li key={f.path} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1">
            <span className="w-16 shrink-0 text-caption text-dim">{R.fileStatus[f.status]}</span>
            <span className="min-w-0 flex-1 font-mono text-caption break-all">{f.path}</span>
            {f.additions === null && f.deletions === null ? (
              <span className="text-caption text-unavailable">{R.linesNotReported}</span>
            ) : (
              <span className="flex gap-2 text-caption tabular-nums">
                {f.additions !== null ? (
                  <span className="text-success" title={R.added(f.additions)}>
                    +{formatCount(f.additions)}
                    <span className="sr-only"> {R.added(f.additions)}</span>
                  </span>
                ) : null}
                {f.deletions !== null ? (
                  <span className="text-danger" title={R.removed(f.deletions)}>
                    −{formatCount(f.deletions)}
                    <span className="sr-only"> {R.removed(f.deletions)}</span>
                  </span>
                ) : null}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "Merge anyway": only with a typed reason, which the server keeps with the review. */
function MergeAnyway({
  onConfirm,
  pending,
}: {
  onConfirm: (reason: string) => Promise<unknown>;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const id = useId();
  const hintId = useId();
  const trimmed = reason.trim();
  const tooLong = trimmed.length > MAX_REASON;
  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} disabled={pending}>
        {C.mergeAnyway}
      </Button>
    );
  }
  return (
    <form
      role="group"
      aria-label={C.mergeAnywayTitle}
      data-testid="merge-anyway"
      className="flex w-full flex-col gap-2 rounded-control border border-danger/30 bg-danger-soft px-3 py-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (trimmed.length === 0 || tooLong) return;
        // A refusal keeps the form and the reason, with the server's answer below it.
        void onConfirm(trimmed).then((done) => {
          if (done !== null) setOpen(false);
        });
      }}
    >
      <p className="font-medium">{C.mergeAnywayTitle}</p>
      <label htmlFor={id}>{C.reasonLabel}</label>
      <textarea
        id={id}
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={C.reasonPlaceholder}
        aria-describedby={hintId}
        aria-invalid={tooLong ? true : undefined}
        // Focus lands in the box: the reason comes first.
        autoFocus
        className="resize-y rounded-control border border-line-strong bg-panel px-3 py-2 text-ink placeholder:text-dim/70"
      />
      <span id={hintId} className="text-caption text-dim">
        {tooLong ? <span className="text-danger">{C.reasonTooLong}</span> : C.reasonHint}
      </span>
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          className={dangerButtonClass}
          disabled={pending || trimmed.length === 0 || tooLong}
        >
          {pending ? R.working : C.confirmMergeAnyway}
        </button>
        <Button onClick={() => setOpen(false)} disabled={pending}>
          {C.cancel}
        </Button>
      </div>
    </form>
  );
}

function ReviewActions({
  runId,
  review,
  checks,
}: {
  runId: string;
  review: AgentReview;
  checks: readonly CheckRunDto[];
}) {
  const act = useTicketAction(reviewAction);
  const gate = mergeGate(agentChecks(checks, review.agentRunId).latest);
  const id = review.agentRunId;
  const discard = (
    <ConfirmAction
      label={R.discard}
      question={R.confirmDiscard(review.role)}
      confirmLabel={R.confirmDiscardButton}
      cancelLabel={R.cancel}
      pendingLabel={R.working}
      pending={act.pending}
      onConfirm={() => act.run(runId, { agentRunId: id, action: 'discard' })}
    />
  );
  return (
    <div className="flex flex-col gap-2">
      {gate.kind === 'blocked' ? (
        <p
          role="alert"
          className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-danger"
          data-testid="merge-blocked"
        >
          {C.blocked(gate.failing.map((c) => c.name).join(', '))}
        </p>
      ) : gate.kind === 'no-checks' ? (
        <p className="text-caption text-dim">{C.checksPending}</p>
      ) : null}
      <div className="flex flex-wrap items-start gap-2">
        {gate.kind === 'blocked' ? (
          <MergeAnyway
            pending={act.pending}
            onConfirm={(reason) =>
              act.run(runId, { agentRunId: id, action: 'merge-anyway', reason })
            }
          />
        ) : (
          <ConfirmAction
            label={R.merge}
            question={R.confirmMerge(review.role, review.baseBranch)}
            confirmLabel={R.confirmMergeButton}
            cancelLabel={R.cancel}
            pendingLabel={R.working}
            pending={act.pending}
            danger={false}
            primary
            onConfirm={() => act.run(runId, { agentRunId: id, action: 'merge' })}
          />
        )}
        {discard}
      </div>
      <ActionError error={act.error} message={R.failed} />
    </div>
  );
}

/**
 * One helper agent's changes (README §5.3 "Changes"): files with +/−, the diff, and Merge /
 * Merge anyway / Discard while they wait for review. Merge is blocked by a failed required check.
 */
export function ChangesTab({
  runId,
  agent,
  review,
  checks,
}: {
  runId: string;
  agent: AgentRunDto;
  /** This agent's entry in the run's review, once there is one. */
  review: AgentReview | undefined;
  checks: readonly CheckRunDto[];
}) {
  if (agent.kind === 'lead') return <p className="text-dim">{C.leadNone}</p>;
  if (review === undefined) {
    return <p className="text-dim">{isAgentLive(agent.status) ? C.notYet : C.noReview}</p>;
  }
  const pending = review.state === 'pending';
  return (
    <div className="flex flex-col gap-3" data-testid="changes">
      <p className="flex flex-wrap items-baseline gap-x-3 text-caption">
        <span className="text-dim">{R.into(review.baseBranch)}</span>
        <span
          className={`ml-auto font-medium ${pending ? 'text-warning' : 'text-dim'}`}
          data-state={review.state}
        >
          {R.state[review.state]}
        </span>
      </p>
      <Files review={review} />
      {review.files.length > 0 || review.diff.length > 0 ? (
        <Details summary={R.diff} defaultOpen={pending}>
          <DiffView diff={review.diff} truncated={review.diffTruncated} />
        </Details>
      ) : null}
      {pending ? (
        isAgentLive(agent.status) ? (
          <p className="text-caption text-dim">{R.waitForStop}</p>
        ) : (
          <ReviewActions runId={runId} review={review} checks={checks} />
        )
      ) : null}
    </div>
  );
}
