import type {
  AgentRunDto,
  CheckRunDto,
  ReviewDto,
  RunDetailDto,
  TicketDetailDto,
} from '@acp/core/api';
import { useId, useState } from 'react';
import { ButtonLink } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/QueryView';
import {
  controlPaths,
  controlSchemas,
  rerunTicket,
  stopRun,
  ticketPaths,
  ticketSchemas,
} from '../../lib/api';
import { CONTROL_COPY, RUN_STATUS_COPY, TICKET_COPY, TICKET_STAGE_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { href } from '../../lib/router';
import { Approvals } from '../control/Approvals';
import { ActionError, ConfirmAction, StatusWord } from '../control/bits';
import { canChat, hasReview } from '../control/run-state';
import { useTicketAction } from './actions';
import { AgentCanvas } from './AgentCanvas';
import { PlanCard } from './PlanReview';
import { SidePanel, type PanelTab } from './SidePanel';
import { TicketInfo } from './TicketInfo';
import {
  agentBranch,
  agentChecks,
  canStopRun,
  lastRunNote,
  mergeGate,
  pendingByAgent,
  planUnderReview,
  plansOfRun,
  runBudgetUsed,
  runNumber,
  startAction,
} from './ticket-state';

const C = TICKET_COPY;

type AgentReview = ReviewDto['agents'][number];

function StopAll({ runId }: { runId: string }) {
  const stop = useTicketAction(stopRun);
  const S = CONTROL_COPY.stopAll;
  return (
    <div className="flex max-w-md flex-col items-end gap-2">
      <ConfirmAction
        label={S.button}
        question={S.confirm}
        confirmLabel={S.confirmButton}
        cancelLabel={S.keep}
        pendingLabel={S.stopping}
        pending={stop.pending}
        onConfirm={() => stop.run(runId)}
      />
      <ActionError error={stop.error} message={S.failed} />
    </div>
  );
}

function StartButton({ ticketId, kind }: { ticketId: string; kind: 'start' | 'rerun' }) {
  const start = useTicketAction(rerunTicket);
  return (
    <div className="flex max-w-md flex-col items-end gap-2">
      <button
        type="button"
        title={kind === 'rerun' ? C.actions.rerunTip : undefined}
        disabled={start.pending}
        onClick={() => void start.run(ticketId)}
        className="inline-flex items-center gap-1.5 rounded-control border border-accent bg-accent px-3 py-1.5 font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
      >
        {start.pending ? C.actions.starting : kind === 'rerun' ? C.actions.rerun : C.actions.start}
      </button>
      <ActionError error={start.error} message={C.actions.startFailed} />
    </div>
  );
}

function RunPicker({
  detail,
  runId,
  onPick,
}: {
  detail: TicketDetailDto;
  runId: string;
  onPick: (runId: string) => void;
}) {
  const id = useId();
  const total = detail.runs.length;
  if (total < 2) return null;
  return (
    <span className="inline-flex items-center gap-2">
      <label htmlFor={id} className="sr-only">
        {C.runPicker.label}
      </label>
      <select
        id={id}
        value={runId}
        onChange={(e) => onPick(e.target.value)}
        className="rounded-control border border-line bg-panel px-2.5 py-1.5 text-ink"
      >
        {detail.runs.map((r) => (
          <option key={r.id} value={r.id}>
            {C.runPicker.option(
              runNumber(detail.runs, r.id) ?? 0,
              total,
              RUN_STATUS_COPY[r.status].word,
            )}
          </option>
        ))}
      </select>
    </span>
  );
}

/** "4 agents · 1 request waits for you · 182,000 budget tokens used". */
function Summary({ run }: { run: RunDetailDto | undefined }) {
  if (run === undefined) return <p className="text-dim">{C.summary.noRun}</p>;
  const waiting = run.approvals.filter((a) => a.status === 'pending').length;
  return (
    <p
      className="flex flex-wrap items-center gap-x-2 gap-y-1 tabular-nums"
      data-testid="ticket-summary"
    >
      <StatusWord status={RUN_STATUS_COPY[run.status]} value={run.status} />
      <span aria-hidden="true" className="text-dim">
        ·
      </span>
      <span>{C.summary.agents(run.agents.length)}</span>
      {waiting > 0 ? (
        <>
          <span aria-hidden="true" className="text-dim">
            ·
          </span>
          <span className="font-medium text-warning">{C.summary.needsYou(waiting)}</span>
        </>
      ) : null}
      <span aria-hidden="true" className="text-dim">
        ·
      </span>
      <span>{C.summary.budget(runBudgetUsed(run.agents))}</span>
    </p>
  );
}

/** In review: one line per helper with its changes and checks, and a button to open it. */
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
      className="rounded-card border border-warning/40 bg-warning-soft px-5 py-4 shadow-card"
    >
      <h2 className="text-title font-semibold">{C.review.title}</h2>
      <p className="mt-0.5 text-dim">{C.review.description}</p>
      <ul className="mt-3 flex flex-col gap-2">
        {waiting.map((a) => {
          const gate = mergeGate(agentChecks(checks, a.id).latest);
          const review = reviews.find((r) => r.agentRunId === a.id);
          return (
            <li
              key={a.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-control border border-line bg-panel px-4 py-2.5"
            >
              <span className="font-medium">{a.role}</span>
              <span className="text-caption text-dim">
                {C.review.files(review ? review.files.length : (a.review?.changedFiles ?? null))}
              </span>
              <span className="text-caption">
                {gate.kind === 'blocked' ? (
                  <span aria-hidden="true" className="mr-1 font-bold text-danger">
                    ✗
                  </span>
                ) : gate.kind === 'passed' ? (
                  <span aria-hidden="true" className="mr-1 font-bold text-success">
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
              <button
                type="button"
                onClick={() => onOpen(a.id)}
                className="ml-auto inline-flex items-center rounded-control border border-line bg-panel px-3 py-1 font-medium hover:bg-sunken"
              >
                {C.review.open}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function defaultAgent(run: RunDetailDto): AgentRunDto | undefined {
  return run.agents.find((a) => a.kind === 'lead') ?? run.agents[0];
}

function RunView({
  detail,
  run,
  isCurrent,
  selectedId,
  onSelect,
  tab,
  onTab,
}: {
  detail: TicketDetailDto;
  run: RunDetailDto;
  isCurrent: boolean;
  selectedId: string | null;
  onSelect: (agentId: string, tab?: PanelTab) => void;
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
}) {
  const reviewQuery = useApiQuery(
    hasReview(run) ? controlPaths.review(run.id) : null,
    controlSchemas.review,
  );
  // The ticket carries the current run's checks; an earlier run's are fetched on their own.
  const olderChecks = useApiQuery(
    isCurrent ? null : ticketPaths.runChecks(run.id),
    ticketSchemas.checks,
  );
  const checks = isCurrent
    ? detail.checks.filter((c) => c.runId === run.id)
    : (olderChecks.data ?? []);
  const reviews = reviewQuery.data?.agents ?? [];
  const reviewOf = new Map(reviews.map((r) => [r.agentRunId, r]));
  const branches = new Map<string, string>();
  for (const a of run.agents) {
    const branch = agentBranch(a, reviewOf.get(a.id));
    if (branch !== null) branches.set(a.id, branch);
  }
  const plan = planUnderReview(run, detail.plans);
  const selected = run.agents.find((a) => a.id === selectedId) ?? defaultAgent(run);
  const pending = run.approvals.filter((a) => a.status === 'pending');
  const planning = run.status === 'PLANNING' || run.status === 'QUEUED';

  return (
    <div className="flex flex-col gap-6">
      {pending.length > 0 ? <Approvals approvals={pending} agents={run.agents} /> : null}
      <ReviewList
        run={run}
        reviews={reviews}
        checks={checks}
        onOpen={(id) => onSelect(id, 'changes')}
      />
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_25rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {plan ? (
            <PlanCard
              ticketId={detail.ticket.id}
              plan={plan}
              earlier={plansOfRun(detail.plans, run.id).filter((p) => p.id !== plan.id)}
              comments={detail.comments}
            />
          ) : (
            <AgentCanvas
              agents={run.agents}
              runId={run.id}
              selectedId={selected?.id ?? null}
              onSelect={(id) => onSelect(id)}
              canMessage={isCurrent && canChat(run.status)}
              pending={pendingByAgent(run)}
              branches={branches}
              note={planning ? C.canvas.planning : undefined}
            />
          )}
        </div>
        {selected ? (
          <div className="min-w-0 xl:sticky xl:top-6">
            <SidePanel
              run={run}
              agent={selected}
              tab={tab}
              onTab={onTab}
              review={reviews.find((r) => r.agentRunId === selected.id)}
              checks={checks}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Ticket({ detail }: { detail: TicketDetailDto }) {
  const { ticket } = detail;
  const [pickedRunId, setPickedRunId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<PanelTab>('chat');
  const currentId = ticket.currentRunId ?? detail.runs[0]?.id ?? null;
  const runId = pickedRunId ?? currentId;
  const isCurrent = runId === currentId;
  // The run itself is fetched too: run notices refresh it, so the tree stays live.
  const runQuery = useApiQuery(runId ? controlPaths.run(runId) : null, controlSchemas.run);
  const run =
    runQuery.data ??
    (detail.currentRun !== null && detail.currentRun.id === runId ? detail.currentRun : undefined);
  const action = startAction(detail);
  const note = lastRunNote(detail);
  const stage = TICKET_STAGE_COPY[ticket.stage];

  const select = (agentId: string, nextTab?: PanelTab) => {
    setSelectedId(agentId);
    if (nextTab) setTab(nextTab);
  };
  const showRun = (id: string) => {
    setPickedRunId(id === currentId ? null : id);
    setSelectedId(null);
    window.scrollTo?.({ top: 0 });
  };

  return (
    <div>
      <PageHeader
        eyebrow={<a href={href.board(ticket.projectId)}>← {C.backToBoard}</a>}
        title={
          <span>
            <span className="mr-2 font-mono text-dim">{ticket.key}</span>
            {ticket.title}
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span
              className="inline-flex items-center rounded-full border border-line bg-panel px-2.5 py-0.5"
              data-testid="ticket-stage"
            >
              <StatusWord status={stage} value={ticket.stage} />
            </span>
            <span>{C.type[ticket.type]}</span>
            <span aria-hidden="true">·</span>
            <span>{C.priority[ticket.priority]}</span>
            {ticket.labels.map((l) => (
              <span key={l} className="rounded-full bg-sunken px-2 py-0.5 text-caption">
                {l}
              </span>
            ))}
          </span>
        }
        actions={
          <>
            {runId !== null ? <RunPicker detail={detail} runId={runId} onPick={showRun} /> : null}
            {run !== undefined && isCurrent && canStopRun(run.status) ? (
              <StopAll runId={run.id} />
            ) : null}
            {action !== null ? <StartButton ticketId={ticket.id} kind={action} /> : null}
            <ButtonLink href={href.board(ticket.projectId)} variant="quiet">
              {C.openBoard}
            </ButtonLink>
          </>
        }
      />
      <div className="mb-6 flex flex-col gap-3">
        <Summary run={run} />
        {note !== null ? (
          <p
            role="status"
            className="rounded-card border border-danger/30 bg-danger-soft px-5 py-3"
          >
            {C.lastRun[note]}
          </p>
        ) : null}
        {!isCurrent ? (
          <p
            role="status"
            className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-sunken px-5 py-3"
          >
            {C.runPicker.earlier}
            <button
              type="button"
              className="font-medium text-accent hover:underline"
              onClick={() => showRun(currentId ?? '')}
            >
              {C.runPicker.backToLatest}
            </button>
          </p>
        ) : null}
      </div>
      {run !== undefined ? (
        <RunView
          key={run.id}
          detail={detail}
          run={run}
          isCurrent={isCurrent}
          selectedId={selectedId}
          onSelect={select}
          tab={tab}
          onTab={setTab}
        />
      ) : runId !== null ? (
        <QueryView query={runQuery} loading={CONTROL_COPY.loading}>
          {() => null}
        </QueryView>
      ) : null}
      <div className="mt-8">
        <TicketInfo detail={detail} shownRunId={run?.id ?? null} onShowRun={showRun} />
      </div>
    </div>
  );
}

/**
 * `#/tickets/:id` (Phase 4, README §5.3): the ticket's agents as a tree of cards with a side panel
 * for the selected agent, the plan to review, the checks and changes to merge, and the ticket's
 * history underneath.
 */
export function TicketPage({ id }: { id: string }) {
  const detail = useApiQuery(ticketPaths.ticket(id), ticketSchemas.detail);
  if (detail.data === undefined && detail.error?.kind === 'http' && detail.error.status === 404) {
    return (
      <EmptyState
        title={C.notFound.title}
        text={C.notFound.text}
        action={
          <ButtonLink href={href.board()} variant="primary">
            {C.openBoard}
          </ButtonLink>
        }
      />
    );
  }
  return (
    <QueryView query={detail} loading={C.loading}>
      {(d) => <Ticket detail={d} />}
    </QueryView>
  );
}
