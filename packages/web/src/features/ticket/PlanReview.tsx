import type { TicketPlanDto } from '@acp/core/api';
import { useId, useState } from 'react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { inputClass } from '../../components/Input';
import { Badge } from '../../components/Pill';
import { RelativeTime } from '../../components/RelativeTime';
import { decidePlan } from '../../lib/api';
import { PLAN_STATUS_COPY, REVIEW_LOOP_COPY, TICKET_COPY } from '../../lib/copy';
import { ActionError } from '../control/bits';
import { useTicketAction } from './actions';

const C = TICKET_COPY.plan;
const MAX_COMMENT = 8000;

/** Summary and numbered steps (title, who does it, detail) of one plan version. */
export function PlanBody({ plan }: { plan: TicketPlanDto }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="whitespace-pre-wrap">{plan.summary}</p>
      <ol
        className="flex flex-col divide-y divide-line overflow-hidden rounded-card border border-line"
        aria-label={C.title}
      >
        {plan.steps.map((s, i) => (
          <li key={i} className="flex gap-3 px-4 py-3">
            <span
              aria-hidden="true"
              className="flex size-5 shrink-0 translate-y-px items-center justify-center rounded-full border border-accent/25 bg-accent-soft font-mono text-micro font-semibold text-accent tabular-nums"
            >
              {i + 1}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <span className="font-medium">{s.title}</span>
                <Badge>
                  <span className="sr-only">{C.stepRole} </span>
                  {s.role}
                </Badge>
              </div>
              {s.detail.length > 0 ? (
                <p className="text-caption whitespace-pre-wrap text-dim">{s.detail}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Where a plan version stands, in words ("Approved automatically (Full auto)" for Full auto). */
export function planStatusWord(plan: Pick<TicketPlanDto, 'status' | 'decidedBy'>): string {
  return plan.status === 'approved' && plan.decidedBy === 'auto'
    ? REVIEW_LOOP_COPY.fullAuto.planApproved
    : PLAN_STATUS_COPY[plan.status];
}

function PlanMeta({ plan }: { plan: TicketPlanDto }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-dim tabular-nums">
      <span className="font-medium text-ink">{C.version(plan.version)}</span>
      <span>{C.helpers(plan.plannedHelpers)}</span>
      <span data-plan-status={plan.status}>{planStatusWord(plan)}</span>
      <RelativeTime iso={plan.decidedAt ?? plan.createdAt} />
    </span>
  );
}

/**
 * The plan-review state (README §5.3): the lead's newest plan with Approve, or Request changes with
 * a required comment that goes to the lead, which then writes the next version.
 */
export function PlanCard({ ticketId, plan }: { ticketId: string; plan: TicketPlanDto }) {
  const decide = useTicketAction(decidePlan);
  const [comment, setComment] = useState('');
  const [missing, setMissing] = useState(false);
  const inputId = useId();
  const hintId = useId();
  const tooLong = comment.length > MAX_COMMENT;

  const approve = () => void decide.run(ticketId, plan.id, { decision: 'approve' });
  const requestChanges = async () => {
    const text = comment.trim();
    if (text.length === 0) {
      setMissing(true);
      return;
    }
    if (tooLong) return;
    const done = await decide.run(ticketId, plan.id, {
      decision: 'request-changes',
      comment: text,
    });
    if (done !== null) setComment('');
  };

  return (
    <Card
      title={C.title}
      description={C.intro}
      testId="plan-card"
      className="border-accent/35! ring-3 ring-accent/10"
    >
      <div className="flex flex-col gap-5">
        <PlanMeta plan={plan} />
        <PlanBody plan={plan} />
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <label htmlFor={inputId} className="text-caption font-medium">
            {C.commentLabel}
          </label>
          <textarea
            id={inputId}
            rows={3}
            value={comment}
            onChange={(e) => {
              setComment(e.target.value);
              if (missing) setMissing(false);
            }}
            placeholder={C.commentPlaceholder}
            aria-describedby={hintId}
            aria-invalid={missing || tooLong ? true : undefined}
            className={inputClass('resize-y px-3 py-2')}
          />
          <span id={hintId} className="text-caption text-dim">
            {missing ? (
              <span className="text-danger">{C.commentRequired}</span>
            ) : tooLong ? (
              <span className="text-danger">{TICKET_COPY.canvas.tooLong}</span>
            ) : (
              C.commentHint
            )}
          </span>
          <div className="mt-1 flex flex-wrap gap-2">
            <Button variant="primary" disabled={decide.pending} onClick={approve}>
              {decide.pending ? C.approving : C.approve}
            </Button>
            <Button disabled={decide.pending} onClick={() => void requestChanges()}>
              {decide.pending ? C.sending : C.requestChanges}
            </Button>
          </div>
          <ActionError error={decide.error} message={C.failed} />
        </div>
      </div>
    </Card>
  );
}
