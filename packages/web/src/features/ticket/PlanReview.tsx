import type { TicketPlanDto, TicketPlanOptionDto } from '@acp/core/api';
import { useId, useState } from 'react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { inputClass } from '../../components/Input';
import { Badge } from '../../components/Pill';
import { RelativeTime } from '../../components/RelativeTime';
import { decidePlan, decidePlanOption } from '../../lib/api';
import { PLAN_STATUS_COPY, REVIEW_LOOP_COPY, TICKET_COPY } from '../../lib/copy';
import { ActionError } from '../control/bits';
import { useTicketAction } from './actions';

const C = TICKET_COPY.plan;
const MAX_COMMENT = 8000;

/** Summary and numbered steps (title, who does it, detail) of one plan version or option. */
export function PlanBody({ plan }: { plan: Pick<TicketPlanDto, 'summary' | 'steps'> }) {
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
              {s.files !== undefined && s.files.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5" aria-label={C.stepFiles}>
                  {s.files.map((f) => (
                    <li
                      key={f}
                      className="max-w-full truncate rounded border border-line bg-panel px-1.5 py-0.5 font-mono text-micro text-dim"
                      title={f}
                    >
                      {f}
                    </li>
                  ))}
                </ul>
              ) : null}
              {s.notes !== undefined && s.notes.length > 0 ? (
                <p className="text-caption whitespace-pre-wrap text-dim">
                  <span className="font-medium text-ink">{C.stepNotes}: </span>
                  {s.notes}
                </p>
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
  const approve = () => void decide.run(ticketId, plan.id, { decision: 'approve' });
  const requestChanges = (comment: string) =>
    decide.run(ticketId, plan.id, { decision: 'request-changes', comment });

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
        <DecisionBox
          pending={decide.pending}
          error={decide.error}
          hint={C.commentHint}
          approve={{ label: C.approve, run: approve }}
          requestChanges={requestChanges}
        />
      </div>
    </Card>
  );
}

/**
 * The comment box under a plan, and its buttons: Approve (when the card has one) and Request
 * changes, which needs a comment of at most 8,000 characters. `requestChanges` answers null when
 * the decision failed, so the comment stays for another try.
 */
function DecisionBox({
  pending,
  error,
  hint,
  approve,
  requestChanges,
}: {
  pending: boolean;
  error: ReturnType<typeof useTicketAction>['error'];
  hint: string;
  approve?: { label: string; run: () => void };
  requestChanges: (comment: string) => Promise<unknown>;
}) {
  const [comment, setComment] = useState('');
  const [missing, setMissing] = useState(false);
  const inputId = useId();
  const hintId = useId();
  const tooLong = comment.length > MAX_COMMENT;
  const send = async () => {
    const text = comment.trim();
    if (text.length === 0) {
      setMissing(true);
      return;
    }
    if (tooLong) return;
    const done = await requestChanges(text);
    if (done !== null) setComment('');
  };
  return (
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
          hint
        )}
      </span>
      <div className="mt-1 flex flex-wrap gap-2">
        {approve !== undefined ? (
          <Button variant="primary" disabled={pending} onClick={approve.run}>
            {pending ? C.approving : approve.label}
          </Button>
        ) : null}
        <Button disabled={pending} onClick={() => void send()} data-testid="plan-request-changes">
          {pending ? C.sending : C.requestChanges}
        </Button>
      </div>
      <ActionError error={error} message={C.failed} />
    </div>
  );
}

/** The plan options waiting for the owner: `proposed` ones while the run is in plan review. */
export function optionsUnderReview(
  runStatus: string | undefined,
  options: readonly TicketPlanOptionDto[] | undefined,
): TicketPlanOptionDto[] {
  if (runStatus !== 'PLAN_REVIEW') return [];
  return (options ?? []).filter((o) => o.status === 'proposed');
}

/**
 * ADR-0037 §4: several planners' plans side by side (stacked on narrow screens), each with its
 * planner's name and "Approve this plan"; Request changes goes to every planner, with the comment.
 */
export function PlanOptionsCard({
  ticketId,
  options,
}: {
  ticketId: string;
  options: readonly TicketPlanOptionDto[];
}) {
  const decide = useTicketAction(decidePlanOption);
  const requestChanges = (comment: string) =>
    decide.run(ticketId, { decision: 'request-changes', comment });
  return (
    <Card
      title={C.optionsTitle}
      description={C.optionsIntro(options.length)}
      testId="plan-options-card"
      className="border-accent/35! ring-3 ring-accent/10"
    >
      <div className="flex flex-col gap-5">
        <ul
          className={`grid grid-cols-1 gap-4 ${options.length > 1 ? 'lg:grid-cols-2' : ''}`}
          aria-label={C.optionsLabel}
        >
          {options.map((o) => (
            <li
              key={o.id}
              className="flex min-w-0 flex-col gap-4 rounded-card border border-line p-4"
              data-testid="plan-option"
              data-option={o.id}
            >
              <div className="flex flex-col gap-1">
                <h3 className="text-title font-semibold">{C.optionBy(o.label)}</h3>
                <span className="text-caption text-dim tabular-nums">
                  {C.helpers(o.plannedHelpers)}
                </span>
              </div>
              <PlanBody plan={o} />
              <Button
                variant="primary"
                className="mt-auto w-fit"
                disabled={decide.pending}
                aria-label={C.approveThisLabel(o.label)}
                onClick={() =>
                  void decide.run(ticketId, { decision: 'approve', planOptionId: o.id })
                }
                data-testid="plan-option-approve"
              >
                {decide.pending ? C.approving : C.approveThis}
              </Button>
            </li>
          ))}
        </ul>
        <DecisionBox
          pending={decide.pending}
          error={decide.error}
          hint={C.optionsCommentHint}
          requestChanges={requestChanges}
        />
      </div>
    </Card>
  );
}
