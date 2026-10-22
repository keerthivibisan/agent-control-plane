import type { RunDetailDto, TicketDetailDto } from '@acp/core/api';
import { useState, type ReactNode } from 'react';
import { ButtonLink } from '../../components/Button';
import { Details } from '../../components/Details';
import { EmptyState } from '../../components/EmptyState';
import { ErrorNotice } from '../../components/ErrorNotice';
import { PageHeader } from '../../components/PageHeader';
import { Pill, type PillTone } from '../../components/Pill';
import { QueryView } from '../../components/QueryView';
import { LoadingBlock } from '../../components/Skeleton';
import {
  addTicketComment,
  controlPaths,
  controlSchemas,
  reviewAction,
  reviewLoopPaths,
  reviewLoopSchemas,
  ticketBranchAction,
  ticketPaths,
  ticketSchemas,
} from '../../lib/api';
import { REVIEW_LOOP_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { href } from '../../lib/router';
import { BranchIcon } from '../review-loop/icons';
import { ChangeChecks, ChangeStateChip } from '../review-loop/ChangeCard';
import { shortCommit } from '../review-loop/logic';
import { useTicketAction } from '../ticket/actions';
import { reviewChoices, type ReviewChoiceId } from './choices';
import { REVIEW_PAGE_COPY as T } from './copy';
import { FilesChanged } from './FilesChanged';

/**
 * The review pages (v0.3.0 D-A), GitHub's "Files changed" for a ticket:
 *
 * - `#/p/:projectId/tickets/:ticketId/changes/:agentRunId`: one helper's change in its latest
 *   round (`GET /runs/:id/review`), with "Request changes" sending the comments back to the helper
 *   as rework (`POST /runs/:id/review`) when it is the owner's turn;
 * - `#/p/:projectId/tickets/:ticketId/files`: the ticket branch's combined change
 *   (`GET /runs/:id/ticket-branch`), with "Request changes" to the lead (`POST` the same path)
 *   while the branch waits for the owner's final step.
 *
 * "Comment" adds the review to the ticket's comments. Only existing endpoints; no new storage.
 */

type Run = RunDetailDto;

/** One send through whichever existing endpoint the choice needs; true when it went through. */
function useSend(run: Run, ticketId: string, agentRunId: string | null) {
  const rework = useTicketAction(reviewAction);
  const request = useTicketAction(ticketBranchAction);
  const comment = useTicketAction(addTicketComment);
  const [last, setLast] = useState<ReviewChoiceId | null>(null);
  const send = async (choice: ReviewChoiceId, text: string): Promise<boolean> => {
    setLast(choice);
    if (choice === 'rework' && agentRunId !== null) {
      return (await rework.run(run.id, { agentRunId, action: 'rework', comment: text })) !== null;
    }
    if (choice === 'request-changes') {
      return (await request.run(run.id, { action: 'request-changes', comment: text })) !== null;
    }
    return (await comment.run(ticketId, { body: text })) !== null;
  };
  const used = last === 'rework' ? rework : last === 'request-changes' ? request : comment;
  return {
    send,
    sending: rework.pending || request.pending || comment.pending,
    error: last === null ? null : used.error,
  };
}

function Notice({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p
      role="note"
      className="rounded-card border border-line bg-sunken px-4 py-3 text-dim"
      data-testid={testId}
    >
      {children}
    </p>
  );
}

function Header({
  detail,
  title,
  description,
  context,
  actions,
}: {
  detail: TicketDetailDto;
  title: string;
  description: string;
  context: ReactNode;
  actions?: ReactNode;
}) {
  const { ticket } = detail;
  return (
    <PageHeader
      eyebrow={
        <a
          href={href.ticket({ id: ticket.id, projectId: ticket.projectId })}
          className="text-dim no-underline hover:text-ink"
          aria-label={T.back(ticket.key)}
          data-testid="review-back"
        >
          ← <span className="font-mono">{ticket.key}</span> {ticket.title}
        </a>
      }
      title={title}
      tip={T.tip}
      description={
        <span className="flex flex-col gap-2">
          <span>{description}</span>
          <span
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-caption"
            data-testid="review-context"
          >
            {context}
          </span>
        </span>
      }
      actions={actions}
    />
  );
}

function ChangeReview({
  detail,
  run,
  agentRunId,
}: {
  detail: TicketDetailDto;
  run: Run;
  agentRunId: string;
}) {
  const { ticket } = detail;
  const change = run.changes?.find((c) => c.agentRunId === agentRunId) ?? null;
  const agent = run.agents.find((a) => a.id === agentRunId);
  const q = useApiQuery(controlPaths.review(run.id), controlSchemas.review);
  const entry = q.data?.agents.find((a) => a.agentRunId === agentRunId);
  const sender = useSend(run, ticket.id, agentRunId);
  const ticketHref = href.ticket({ id: ticket.id, projectId: ticket.projectId });

  if (change === null && agent === undefined) {
    return (
      <EmptyState
        title={T.noChange.title}
        text={T.noChange.text}
        action={
          <ButtonLink href={ticketHref} variant="primary">
            {T.back(ticket.key)}
          </ButtonLink>
        }
      />
    );
  }
  const role = change?.role ?? entry?.role ?? agent?.role ?? agentRunId;
  const branchName = run.ticketBranch?.branch ?? null;
  const commit = change?.headCommit ?? null;
  const choices = reviewChoices({ kind: 'change', run, change });

  return (
    <div>
      <Header
        detail={detail}
        title={T.title.change(role)}
        description={T.description.change}
        context={
          change !== null ? (
            <>
              <ChangeStateChip change={change} branch={branchName} />
              <span className="font-medium text-ink">{T.round(change.reworkRounds)}</span>
              <ChangeChecks change={change} />
              {commit !== null ? (
                <span className="font-mono text-dim" title={commit}>
                  {shortCommit(commit)}
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-dim">{role}</span>
          )
        }
        actions={
          run.ticketBranch ? (
            <ButtonLink
              size="sm"
              href={href.ticketFiles({
                projectId: ticket.projectId,
                ticketId: ticket.id,
                runId: run.id === ticket.currentRunId ? null : run.id,
              })}
            >
              <BranchIcon size={14} />
              {T.branchFilesLink}
            </ButtonLink>
          ) : undefined
        }
      />
      {entry !== undefined ? (
        <FilesChanged
          key={`${agentRunId}:${commit ?? ''}`}
          scope={{ runId: run.id, agentRunId }}
          commit={commit}
          diff={entry.diff}
          truncated={entry.diffTruncated}
          listed={entry.files.map((f) => f.path)}
          choices={choices}
          send={sender.send}
          sending={sender.sending}
          sendError={sender.error}
          ticketHref={ticketHref}
        />
      ) : q.data !== undefined ? (
        <Notice testId="review-unavailable">
          {change !== null && change.headCommit === null ? T.notSaved : T.changeGone}
        </Notice>
      ) : q.error !== null ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-danger">{T.loadFailed}</p>
          <Details>
            <ErrorNotice error={q.error} />
          </Details>
        </div>
      ) : (
        <LoadingBlock label={T.loading} />
      )}
    </div>
  );
}

const BRANCH_TONE: Record<'open' | 'merged' | 'discarded', PillTone> = {
  open: 'accent',
  merged: 'success',
  discarded: 'neutral',
};

function BranchReview({ detail, run }: { detail: TicketDetailDto; run: Run }) {
  const { ticket } = detail;
  const branch = run.ticketBranch ?? null;
  const q = useApiQuery(
    branch !== null && branch.state === 'open' ? reviewLoopPaths.ticketBranch(run.id) : null,
    reviewLoopSchemas.ticketBranch,
  );
  const sender = useSend(run, ticket.id, null);
  const ticketHref = href.ticket({ id: ticket.id, projectId: ticket.projectId });
  const merged = (run.changes ?? []).filter((c) => c.state === 'merged').length;
  const choices = reviewChoices({ kind: 'branch', run, branch });
  // The tip as the server read it with the diff, else as the run knows it.
  const tip = q.data?.ticketBranch.headCommit ?? branch?.headCommit ?? null;

  return (
    <div>
      <Header
        detail={detail}
        title={T.title.branch}
        description={T.description.branch}
        context={
          branch !== null ? (
            <>
              <span data-testid="branch-state" data-state={branch.state}>
                <Pill tone={BRANCH_TONE[branch.state]}>
                  {branch.state === 'merged'
                    ? REVIEW_LOOP_COPY.branch.mergedInto(branch.baseBranch)
                    : REVIEW_LOOP_COPY.branch.state[branch.state]}
                </Pill>
              </span>
              <span className="inline-flex items-center gap-1.5 font-mono text-ink">
                <BranchIcon size={14} className="shrink-0 text-dim" />
                {branch.branch}
                <span className="font-sans text-dim">{T.into(branch.baseBranch)}</span>
              </span>
              {q.data !== undefined ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-dim">{T.checksOnTip}</span>
                  <ChangeChecks change={{ checks: q.data.checks }} />
                </span>
              ) : null}
              <span className="text-dim tabular-nums">{T.changesMerged(merged)}</span>
              {tip !== null ? (
                <span className="font-mono text-dim" title={tip}>
                  {shortCommit(tip)}
                </span>
              ) : null}
            </>
          ) : null
        }
      />
      {branch === null ? (
        <EmptyState title={T.noBranch.title} text={T.noBranch.text} />
      ) : branch.state !== 'open' ? (
        <Notice testId="review-unavailable">
          {branch.state === 'merged'
            ? T.branchClosed.merged(branch.baseBranch)
            : T.branchClosed.discarded}
        </Notice>
      ) : q.data !== undefined ? (
        <FilesChanged
          key={tip ?? ''}
          scope={{ runId: run.id, agentRunId: null }}
          commit={tip}
          diff={q.data.diff}
          truncated={q.data.diffTruncated}
          listed={q.data.files.map((f) => f.path)}
          choices={choices}
          send={sender.send}
          sending={sender.sending}
          sendError={sender.error}
          ticketHref={ticketHref}
        />
      ) : q.error !== null ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-danger">{T.loadFailed}</p>
          <Details>
            <ErrorNotice error={q.error} />
          </Details>
        </div>
      ) : (
        <LoadingBlock label={T.loading} />
      )}
    </div>
  );
}

function ForTicket({
  detail,
  runId,
  agentRunId,
}: {
  detail: TicketDetailDto;
  runId: string | null;
  agentRunId: string | null;
}) {
  const { ticket } = detail;
  const id = runId ?? ticket.currentRunId ?? detail.runs[0]?.id ?? null;
  // The run itself is fetched too: run notices refresh it, so the state and choices stay live.
  const runQuery = useApiQuery(id !== null ? controlPaths.run(id) : null, controlSchemas.run);
  const run =
    runQuery.data ??
    (detail.currentRun !== null && detail.currentRun.id === id ? detail.currentRun : undefined);
  if (id === null) {
    return (
      <EmptyState
        title={T.noRun.title}
        text={T.noRun.text}
        action={
          <ButtonLink
            href={href.ticket({ id: ticket.id, projectId: ticket.projectId })}
            variant="primary"
          >
            {T.back(ticket.key)}
          </ButtonLink>
        }
      />
    );
  }
  if (run === undefined) {
    return (
      <QueryView query={runQuery} loading={T.loading}>
        {() => null}
      </QueryView>
    );
  }
  return agentRunId !== null ? (
    <ChangeReview detail={detail} run={run} agentRunId={agentRunId} />
  ) : (
    <BranchReview detail={detail} run={run} />
  );
}

export function ReviewPage({
  ticketId,
  agentRunId,
  runId,
}: {
  /** From the address; the ticket's own project is what the page uses. */
  projectId: string;
  ticketId: string;
  agentRunId: string | null;
  runId: string | null;
}) {
  const detail = useApiQuery(ticketPaths.ticket(ticketId), ticketSchemas.detail);
  if (detail.data === undefined && detail.error?.kind === 'http' && detail.error.status === 404) {
    return (
      <EmptyState
        title={T.ticketNotFound.title}
        text={T.ticketNotFound.text}
        action={
          <ButtonLink href={href.board()} variant="primary">
            {T.ticketNotFound.action}
          </ButtonLink>
        }
      />
    );
  }
  return (
    <QueryView query={detail} loading={T.loading}>
      {(d) => <ForTicket detail={d} runId={runId} agentRunId={agentRunId} />}
    </QueryView>
  );
}
