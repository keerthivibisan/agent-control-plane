import type { TicketDetailDto } from '@acp/core/api';
import { useId, useState } from 'react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Details } from '../../components/Details';
import { RelativeTime } from '../../components/RelativeTime';
import { addTicketComment, updateTicket } from '../../lib/api';
import { RUN_STATUS_COPY, TICKET_COPY } from '../../lib/copy';
import { ActionError, StatusWord } from '../control/bits';
import { useTicketAction } from './actions';
import { EarlierPlans } from './PlanReview';
import { runNumber } from './ticket-state';

const C = TICKET_COPY;
const MAX_DESCRIPTION = 20_000;
const MAX_COMMENT = 8000;

const fieldClass =
  'rounded-control border border-line-strong bg-panel px-3 py-2 text-ink placeholder:text-dim/70';

function Description({ detail }: { detail: TicketDetailDto }) {
  const { ticket } = detail;
  const save = useTicketAction(updateTicket);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(ticket.title);
  const [text, setText] = useState(ticket.description);
  const titleId = useId();
  const textId = useId();
  const valid =
    title.trim().length > 0 && title.trim().length <= 200 && text.length <= MAX_DESCRIPTION;

  if (!editing) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h3 className="font-medium">{C.ticket.description}</h3>
          <Button
            variant="quiet"
            className="ml-auto"
            onClick={() => {
              setTitle(ticket.title);
              setText(ticket.description);
              setEditing(true);
            }}
          >
            {C.ticket.edit}
          </Button>
        </div>
        {ticket.description.trim().length > 0 ? (
          <p className="whitespace-pre-wrap" data-testid="ticket-description">
            {ticket.description}
          </p>
        ) : (
          <p className="text-dim">{C.ticket.noDescription}</p>
        )}
      </div>
    );
  }
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        void save.run(ticket.id, { title: title.trim(), description: text }).then((done) => {
          if (done !== null) setEditing(false);
        });
      }}
    >
      <label htmlFor={titleId} className="font-medium">
        {C.ticket.titleLabel}
      </label>
      <input
        id={titleId}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className={fieldClass}
      />
      <label htmlFor={textId} className="font-medium">
        {C.ticket.description}
      </label>
      <textarea
        id={textId}
        rows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className={`resize-y ${fieldClass}`}
      />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={save.pending || !valid}>
          {save.pending ? C.ticket.saving : C.ticket.save}
        </Button>
        <Button onClick={() => setEditing(false)} disabled={save.pending}>
          {C.ticket.cancel}
        </Button>
      </div>
      <ActionError error={save.error} message={C.ticket.saveFailed} />
    </form>
  );
}

function Comments({ detail }: { detail: TicketDetailDto }) {
  const add = useTicketAction(addTicketComment);
  const [body, setBody] = useState('');
  const id = useId();
  const versionOf = new Map(detail.plans.map((p) => [p.id, p.version]));
  const sorted = [...detail.comments].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const tooLong = body.length > MAX_COMMENT;
  return (
    <div className="flex flex-col gap-3" data-testid="comments">
      <h3 className="font-medium">{C.comments.title}</h3>
      {sorted.length === 0 ? (
        <p className="text-dim">{C.comments.empty}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {sorted.map((c) => {
            const version = c.planId ? versionOf.get(c.planId) : undefined;
            return (
              <li key={c.id} className="flex flex-col gap-1" data-author={c.author}>
                <span className="flex flex-wrap items-center gap-x-2 text-caption text-dim">
                  <span className="font-medium text-ink">
                    {c.author === 'owner' ? C.comments.you : C.comments.lead}
                  </span>
                  {version !== undefined ? <span>{C.comments.onPlan(version)}</span> : null}
                  <RelativeTime iso={c.createdAt} />
                </span>
                <p
                  className={`rounded-card px-3.5 py-2.5 whitespace-pre-wrap ${
                    c.author === 'owner' ? 'bg-accent-soft' : 'border border-line bg-sunken'
                  }`}
                >
                  {c.body}
                </p>
              </li>
            );
          })}
        </ol>
      )}
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const text = body.trim();
          if (text.length === 0 || tooLong) return;
          void add.run(detail.ticket.id, { body: text }).then((done) => {
            if (done !== null) setBody('');
          });
        }}
      >
        <label htmlFor={id} className="sr-only">
          {C.comments.label}
        </label>
        <textarea
          id={id}
          rows={2}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={C.comments.placeholder}
          aria-invalid={tooLong ? true : undefined}
          className={`resize-y ${fieldClass}`}
        />
        {tooLong ? <span className="text-caption text-danger">{C.canvas.tooLong}</span> : null}
        <Button
          type="submit"
          className="self-end"
          disabled={add.pending || tooLong || body.trim().length === 0}
        >
          {add.pending ? C.comments.adding : C.comments.add}
        </Button>
        <ActionError error={add.error} message={C.comments.failed} />
      </form>
    </div>
  );
}

function Runs({
  detail,
  shownRunId,
  onShowRun,
}: {
  detail: TicketDetailDto;
  shownRunId: string | null;
  onShowRun: (runId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2" data-testid="run-history">
      <h3 className="font-medium">{C.history.runs}</h3>
      {detail.runs.length === 0 ? (
        <p className="text-dim">{C.history.noRuns}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {detail.runs.map((r) => {
            const n = runNumber(detail.runs, r.id) ?? 0;
            const shown = r.id === shownRunId;
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="font-medium tabular-nums">{C.history.run(n)}</span>
                <StatusWord status={RUN_STATUS_COPY[r.status]} value={r.status} withTip={false} />
                <span className="text-caption text-dim">
                  <RelativeTime iso={r.createdAt} />
                </span>
                {shown ? (
                  <span className="ml-auto text-caption text-dim">{C.history.showing}</span>
                ) : (
                  <Button variant="quiet" className="ml-auto" onClick={() => onShowRun(r.id)}>
                    {C.history.show}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * The ticket under the agents (README §5.3 bottom row): description, comments, the plan history of
 * every run, and the runs themselves.
 */
export function TicketInfo({
  detail,
  shownRunId,
  onShowRun,
}: {
  detail: TicketDetailDto;
  shownRunId: string | null;
  onShowRun: (runId: string) => void;
}) {
  const plans = [...detail.plans].sort((a, b) =>
    a.runId === b.runId ? b.version - a.version : a.createdAt < b.createdAt ? 1 : -1,
  );
  return (
    <Card title={C.ticket.title} testId="ticket-info">
      <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-8">
          <Description key={detail.ticket.updatedAt} detail={detail} />
          <Comments detail={detail} />
        </div>
        <div className="flex min-w-0 flex-col gap-8">
          <div className="flex flex-col gap-2" data-testid="plan-history">
            <h3 className="font-medium">{C.history.plans}</h3>
            {plans.length === 0 ? (
              <p className="text-dim">{C.history.noPlans}</p>
            ) : (
              <EarlierPlans plans={plans} comments={detail.comments} label={C.history.plans} />
            )}
          </div>
          <Runs detail={detail} shownRunId={shownRunId} onShowRun={onShowRun} />
          <Details>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-caption">
              <dt className="text-dim">{C.ticket.ticketId}</dt>
              <dd className="font-mono break-all">{detail.ticket.id}</dd>
              <dt className="text-dim">{C.ticket.created}</dt>
              <dd>
                <RelativeTime iso={detail.ticket.createdAt} />
              </dd>
            </dl>
          </Details>
        </div>
      </div>
    </Card>
  );
}
