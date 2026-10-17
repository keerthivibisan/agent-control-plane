import type { AgentRunDto, ReviewDto } from '@acp/core/api';
import { Card } from '../../components/Card';
import { Details } from '../../components/Details';
import { Pill } from '../../components/Pill';
import { QueryView } from '../../components/QueryView';
import { controlPaths, controlSchemas, reviewAction } from '../../lib/api';
import { CONTROL_COPY } from '../../lib/copy';
import { formatCount } from '../../lib/format';
import { useApiQuery } from '../../lib/query';
import { useControlAction } from './actions';
import { ActionError, ConfirmAction } from './bits';
import { diffLines, isAgentLive, type DiffLineKind } from './run-state';

const C = CONTROL_COPY.review;

type AgentReview = ReviewDto['agents'][number];
type ChangedFile = AgentReview['files'][number];

const LINE: Record<DiffLineKind, string> = {
  file: 'mt-3 first:mt-0 border-b border-line bg-panel px-3 py-1.5 font-sans font-semibold text-ink',
  hunk: 'px-3 py-0.5 text-dim bg-sunken',
  add: 'px-3 bg-success/10 text-ink',
  del: 'px-3 bg-danger/10 text-ink',
  context: 'px-3 text-ink',
  meta: 'px-3 italic text-dim',
};

/** A unified diff, readable: file headings, green added and red removed lines (+/− kept). */
export function DiffView({ diff, truncated }: { diff: string; truncated: boolean }) {
  const lines = diffLines(diff);
  return (
    <div className="flex flex-col gap-2">
      {lines.length === 0 ? (
        <p className="text-dim">{C.diffEmpty}</p>
      ) : (
        <pre
          className="max-h-[28rem] overflow-auto rounded-control border border-line bg-canvas py-1 font-mono text-caption leading-5"
          data-testid="diff"
        >
          {lines.map((l, i) => (
            <div key={i} className={`${LINE[l.kind]} min-w-max whitespace-pre`} data-kind={l.kind}>
              {l.text.length > 0 ? l.text : ' '}
            </div>
          ))}
        </pre>
      )}
      {truncated ? (
        <p
          role="note"
          className="rounded-control border border-warning/30 bg-warning-soft px-3 py-2 text-caption"
          data-testid="diff-truncated"
        >
          {C.truncated}
        </p>
      ) : null}
    </div>
  );
}

function FileRow({ f }: { f: ChangedFile }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1">
      <span className="w-16 shrink-0 text-caption text-dim">{C.fileStatus[f.status]}</span>
      <span className="min-w-0 flex-1 font-mono text-caption break-all">{f.path}</span>
      {f.additions === null && f.deletions === null ? (
        <span className="text-caption text-unavailable">{C.linesNotReported}</span>
      ) : (
        <span className="flex gap-2 text-caption tabular-nums">
          {f.additions !== null ? (
            <span className="text-success" title={C.added(f.additions)}>
              +{formatCount(f.additions)}
              <span className="sr-only"> {C.added(f.additions)}</span>
            </span>
          ) : null}
          {f.deletions !== null ? (
            <span className="text-danger" title={C.removed(f.deletions)}>
              −{formatCount(f.deletions)}
              <span className="sr-only"> {C.removed(f.deletions)}</span>
            </span>
          ) : null}
        </span>
      )}
    </li>
  );
}

function AgentReviewCard({
  runId,
  review,
  agent,
}: {
  runId: string;
  review: AgentReview;
  agent: AgentRunDto | undefined;
}) {
  const act = useControlAction(reviewAction);
  const stillWorking = agent !== undefined && isAgentLive(agent.status);
  const pending = review.state === 'pending';
  return (
    <article
      aria-label={review.role}
      data-testid={`review-${review.agentRunId}`}
      className="flex flex-col gap-3 rounded-card border border-line bg-panel px-4 py-3 shadow-card"
    >
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-medium">{review.role}</h3>
        <span className="text-caption text-dim">{C.into(review.baseBranch)}</span>
        <span className="ml-auto" data-state={review.state}>
          <Pill tone={pending ? 'warning' : 'neutral'}>{C.state[review.state]}</Pill>
        </span>
      </header>
      {review.files.length === 0 ? (
        <p className="text-dim">{C.noFiles}</p>
      ) : (
        <div>
          <p className="text-caption font-medium">{C.files(review.files.length)}</p>
          <ul className="mt-1 divide-y divide-line">
            {review.files.map((f) => (
              <FileRow key={f.path} f={f} />
            ))}
          </ul>
        </div>
      )}
      {review.files.length > 0 || review.diff.length > 0 ? (
        <Details summary={C.diff} defaultOpen={pending}>
          <DiffView diff={review.diff} truncated={review.diffTruncated} />
        </Details>
      ) : null}
      {pending ? (
        stillWorking ? (
          <p className="text-caption text-dim">{C.waitForStop}</p>
        ) : (
          <div className="flex flex-wrap items-start gap-2">
            <ConfirmAction
              label={C.merge}
              question={C.confirmMerge(review.role, review.baseBranch)}
              confirmLabel={C.confirmMergeButton}
              cancelLabel={C.cancel}
              pendingLabel={C.working}
              pending={act.pending}
              danger={false}
              primary
              onConfirm={() => act.run(runId, { agentRunId: review.agentRunId, action: 'merge' })}
            />
            <ConfirmAction
              label={C.discard}
              question={C.confirmDiscard(review.role)}
              confirmLabel={C.confirmDiscardButton}
              cancelLabel={C.cancel}
              pendingLabel={C.working}
              pending={act.pending}
              onConfirm={() => act.run(runId, { agentRunId: review.agentRunId, action: 'discard' })}
            />
          </div>
        )
      ) : null}
      <ActionError error={act.error} message={C.failed} />
      <Details summary={CONTROL_COPY.technical.summary}>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-caption">
          <dt className="text-dim">{C.branch}</dt>
          <dd className="font-mono break-all">{review.branch}</dd>
          <dt className="text-dim">{C.baseBranch}</dt>
          <dd className="font-mono break-all">{review.baseBranch}</dd>
          <dt className="text-dim">{CONTROL_COPY.technical.agentId}</dt>
          <dd className="font-mono break-all">{review.agentRunId}</dd>
        </dl>
      </Details>
    </article>
  );
}

/** Per helper agent: changed files, the diff, and Merge / Discard (ADR-0013: always the owner). */
export function ReviewPanel({ runId, agents }: { runId: string; agents: readonly AgentRunDto[] }) {
  const review = useApiQuery(controlPaths.review(runId), controlSchemas.review);
  return (
    <Card title={C.title} description={C.description} testId="review">
      <QueryView query={review} loading={C.loading}>
        {(r) => (
          <div className="flex flex-col gap-4">
            {r.agents.map((a) => (
              <AgentReviewCard
                key={a.agentRunId}
                runId={runId}
                review={a}
                agent={agents.find((x) => x.id === a.agentRunId)}
              />
            ))}
          </div>
        )}
      </QueryView>
    </Card>
  );
}
