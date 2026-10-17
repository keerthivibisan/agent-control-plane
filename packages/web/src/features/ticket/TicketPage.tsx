import type {
  AgentRunDto,
  CheckRunDto,
  ReviewDto,
  RunDetailDto,
  TicketDetailDto,
  TicketDto,
} from '@acp/core/api';
import { motion } from 'motion/react';
import { useId, useState, type ComponentType } from 'react';
import { Button, ButtonLink } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import {
  AlertIcon,
  BugIcon,
  ChoreIcon,
  FeatureIcon,
  HarnessIcon,
  type IconProps,
} from '../../components/icons';
import { fieldClass } from '../../components/Input';
import { enter, fadeUp, slideInRight } from '../../components/motion';
import { PageHeader } from '../../components/PageHeader';
import { Badge, type PillTone } from '../../components/Pill';
import { QueryView } from '../../components/QueryView';
import { Skeleton } from '../../components/Skeleton';
import {
  controlPaths,
  controlSchemas,
  rerunTicket,
  stopRun,
  ticketPaths,
  ticketSchemas,
} from '../../lib/api';
import {
  CONTROL_COPY,
  REVIEW_LOOP_COPY,
  RUN_STATUS_COPY,
  TICKET_COPY,
  TICKET_STAGE_COPY,
} from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { href } from '../../lib/router';
import { Approvals } from '../control/Approvals';
import { ActionError, ConfirmAction, StatusWord } from '../control/bits';
import { canChat, closedByEngine, hasReview } from '../control/run-state';
import { ChangesOverview, NeedsYouChanges } from '../review-loop/ChangeCard';
import { OptionsIcon } from '../review-loop/icons';
import { isReviewLoopRun } from '../review-loop/logic';
import { TicketBranchCard } from '../review-loop/TicketBranchCard';
import { StartDialog } from '../review-loop/StartDialog';
import { useTicketAction } from './actions';
import { AgentCanvas } from './AgentCanvas';
import { PlanCard } from './PlanReview';
import { SidePanel, type PanelTab } from './SidePanel';
import { TicketInfo } from './TicketInfo';
import { LiveWorkflow } from './LiveWorkflow';
import {
  agentBranch,
  agentChecks,
  canStopRun,
  chatAgent,
  lastRunNote,
  mergeGate,
  pendingByAgent,
  planUnderReview,
  plansOfRun,
  runBudgetUsed,
  runNumber,
  showRunStatus,
  startAction,
} from './ticket-state';

const C = TICKET_COPY;
const RL = REVIEW_LOOP_COPY;

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

function StartButton({
  ticket,
  kind,
}: {
  ticket: Pick<TicketDto, 'id' | 'key' | 'projectId'>;
  kind: 'start' | 'rerun';
}) {
  const start = useTicketAction(rerunTicket);
  // ADR-0021: "Options" opens the Start dialog for this run's own settings; Start stays one click.
  const withOptions = useTicketAction(rerunTicket);
  const [dialog, setDialog] = useState(false);
  const optionsName =
    kind === 'rerun' ? RL.start.rerunOptionsFor(ticket.key) : RL.start.optionsFor(ticket.key);
  return (
    <div className="flex max-w-md flex-col items-end gap-2">
      <div className="flex items-center gap-1.5">
        <Button
          variant="primary"
          title={kind === 'rerun' ? C.actions.rerunTip : undefined}
          disabled={start.pending}
          onClick={() => void start.run(ticket.id)}
        >
          {start.pending
            ? C.actions.starting
            : kind === 'rerun'
              ? C.actions.rerun
              : C.actions.start}
        </Button>
        <Button
          aria-label={optionsName}
          title={optionsName}
          disabled={start.pending}
          onClick={() => {
            withOptions.reset();
            setDialog(true);
          }}
        >
          <OptionsIcon size={15} />
          {RL.start.optionsShort}
        </Button>
      </div>
      <ActionError error={start.error} message={C.actions.startFailed} />
      {dialog ? (
        <StartDialog
          projectId={ticket.projectId}
          ticketKey={ticket.key}
          kind={kind}
          pending={withOptions.pending}
          error={withOptions.error}
          onStart={(request) =>
            void withOptions.run(ticket.id, request).then((done) => {
              if (done !== null) setDialog(false);
            })
          }
          onClose={() => setDialog(false)}
        />
      ) : null}
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
        className={`h-8 py-0 pr-7 pl-2.5 text-caption font-medium tabular-nums ${fieldClass}`}
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

/**
 * "4 agents · 1 request waits for you · 182,000 budget tokens used". The run's status word is
 * left out for the current run: the stage pill in the header already says it, in the board's word.
 */
function Summary({ run, isCurrent }: { run: RunDetailDto | undefined; isCurrent: boolean }) {
  if (run === undefined) return <p className="text-caption text-dim">{C.summary.noRun}</p>;
  const waiting = run.approvals.filter((a) => a.status === 'pending').length;
  return (
    <p
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-dim tabular-nums"
      data-testid="ticket-summary"
    >
      {showRunStatus(isCurrent, run.status) ? (
        <>
          <StatusWord status={RUN_STATUS_COPY[run.status]} value={run.status} />
          <span aria-hidden="true" className="text-dim">
            ·
          </span>
        </>
      ) : null}
      <span className="text-ink">{C.summary.agents(run.agents.length)}</span>
      {run.approvalMode !== undefined ? (
        <>
          <span aria-hidden="true" className="text-dim">
            ·
          </span>
          <span className="text-ink" data-testid="run-approval-mode">
            {RL.runMode(RL.modes.word[run.approvalMode])}
          </span>
        </>
      ) : null}
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
      <span className="text-ink">{C.summary.budget(runBudgetUsed(run.agents))}</span>
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

/** The agent the panel opens on: the one you chat with now (planner or lead), else the first. */
function defaultAgent(run: RunDetailDto): AgentRunDto | undefined {
  const chat = chatAgent(run);
  return run.agents.find((a) => a.id === chat?.id) ?? run.agents[0];
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
  const loop = isReviewLoopRun(run);
  const reviewQuery = useApiQuery(
    // A review-loop run's change cards show the files and diff once a change is sealed.
    hasReview(run) || (run.changes ?? []).some((c) => c.headCommit !== null)
      ? controlPaths.review(run.id)
      : null,
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
  const reviewerComments = detail.comments.filter(
    (c) => c.author === 'reviewer' && c.runId === run.id,
  ).length;

  return (
    <div className="flex flex-col gap-5">
      <LiveWorkflow
        run={run}
        projectId={detail.ticket.projectId}
        reviewerComments={reviewerComments}
        onSelectAgent={(id, stage) => onSelect(id, stage === 'review' ? 'changes' : undefined)}
      />
      {pending.length > 0 ? (
        <motion.div {...enter(fadeUp)}>
          <Approvals approvals={pending} agents={run.agents} />
        </motion.div>
      ) : null}
      {loop ? (
        // ADR-0021: the lead decides each change; the owner only where it is their turn, and
        // merges the ticket branch once.
        <>
          <NeedsYouChanges run={run} onOpen={(id) => onSelect(id, 'changes')} />
          {run.ticketBranch ? <TicketBranchCard run={run} branch={run.ticketBranch} /> : null}
        </>
      ) : (
        <ReviewList
          run={run}
          reviews={reviews}
          checks={checks}
          onOpen={(id) => onSelect(id, 'changes')}
        />
      )}
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_25rem]">
        <div className="flex min-w-0 flex-col gap-5">
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
              chatAgentId={chatAgent(run)?.id ?? null}
              finished={new Set(run.agents.filter((a) => closedByEngine(a, run)).map((a) => a.id))}
              note={planning ? C.canvas.planning : undefined}
            />
          )}
          {loop && !plan ? (
            <ChangesOverview
              run={run}
              branch={run.ticketBranch?.branch ?? null}
              onOpen={(id) => onSelect(id, 'changes')}
            />
          ) : null}
        </div>
        {selected ? (
          // Sticky under the top bar; slides in once when the run opens.
          <motion.div
            className="min-w-0 xl:sticky xl:top-[calc(var(--spacing-topbar)+1.25rem)]"
            {...enter(slideInRight)}
          >
            <SidePanel
              run={run}
              agent={selected}
              tab={tab}
              onTab={onTab}
              review={reviews.find((r) => r.agentRunId === selected.id)}
              checks={checks}
              comments={detail.comments}
            />
          </motion.div>
        ) : null}
      </div>
    </div>
  );
}

const TYPE_ICON: Record<TicketDto['type'], ComponentType<IconProps>> = {
  feature: FeatureIcon,
  bug: BugIcon,
  chore: ChoreIcon,
  harness: HarnessIcon,
};

/** Urgency reads in the tag's tone as well as its word. */
const PRIORITY_TONE: Record<TicketDto['priority'], PillTone> = {
  low: 'neutral',
  medium: 'neutral',
  high: 'warning',
  urgent: 'danger',
};

/** "Feature" with its icon (the icon adds no text). */
function TypeBadge({ type }: { type: TicketDto['type'] }) {
  const Icon = TYPE_ICON[type];
  return (
    <Badge>
      <span className="inline-flex items-center gap-1">
        <Icon size={12} />
        {C.type[type]}
      </span>
    </Badge>
  );
}

/**
 * The page's shape while the ticket loads: header, workflow, agents and panel. The loading words
 * stay in the page for screen readers, as in `LoadingBlock`.
 */
function TicketSkeleton() {
  return (
    <div data-loading="" className="flex flex-col gap-5">
      <span className="sr-only">{C.loading}</span>
      <div aria-hidden="true" className="flex flex-col gap-2.5">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-7 w-80 max-w-full" />
        <div className="flex gap-1.5">
          <Skeleton className="h-6 w-28 rounded-full" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-20" />
        </div>
      </div>
      <div aria-hidden="true" className="rounded-card border border-line bg-panel p-5">
        <Skeleton className="mb-4 h-4 w-24" />
        <Skeleton className="h-56 w-full rounded-card" />
      </div>
      <div aria-hidden="true" className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_25rem]">
        <div className="rounded-card border border-line bg-panel p-5">
          <Skeleton className="mb-5 h-4 w-20" />
          <div className="flex justify-center gap-3">
            <Skeleton className="h-36 w-48 rounded-card" />
          </div>
        </div>
        <div className="rounded-card border border-line bg-panel p-5">
          <Skeleton className="mb-2 h-3 w-20" />
          <Skeleton className="mb-5 h-4 w-28" />
          <Skeleton className="h-28 w-full rounded-card" />
        </div>
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
        eyebrow={
          <a href={href.board(ticket.projectId)} className="text-dim no-underline hover:text-ink">
            ← {C.backToBoard}
          </a>
        }
        title={
          <span>
            <span className="mr-2.5 font-mono font-medium text-dim">{ticket.key}</span>
            {ticket.title}
          </span>
        }
        description={
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            <span
              className="inline-flex h-6 items-center rounded-full border border-line bg-panel px-2.5 text-caption font-medium text-ink"
              data-testid="ticket-stage"
            >
              <StatusWord status={stage} value={ticket.stage} />
            </span>
            <TypeBadge type={ticket.type} />
            <Badge tone={PRIORITY_TONE[ticket.priority]}>{C.priority[ticket.priority]}</Badge>
            {ticket.labels.map((l) => (
              <Badge key={l}>{l}</Badge>
            ))}
          </span>
        }
        actions={
          <>
            {runId !== null ? <RunPicker detail={detail} runId={runId} onPick={showRun} /> : null}
            {run !== undefined && isCurrent && canStopRun(run.status) ? (
              <StopAll runId={run.id} />
            ) : null}
            {action !== null ? <StartButton ticket={ticket} kind={action} /> : null}
            <ButtonLink href={href.board(ticket.projectId)} variant="quiet">
              {C.openBoard}
            </ButtonLink>
          </>
        }
      />
      <div className="-mt-2 mb-5 flex flex-col gap-3">
        <Summary run={run} isCurrent={isCurrent} />
        {note !== null ? (
          <p
            role="status"
            className="flex items-center gap-2.5 rounded-card border border-danger/25 bg-danger-soft px-4 py-2.5 text-ink"
          >
            <AlertIcon size={16} className="text-danger" />
            {C.lastRun[note]}
          </p>
        ) : null}
        {!isCurrent ? (
          <p
            role="status"
            className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-sunken px-4 py-2.5"
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
      <div className="mt-6">
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
  if (detail.data === undefined && detail.error === null) return <TicketSkeleton />;
  return (
    <QueryView query={detail} loading={C.loading}>
      {(d) => <Ticket detail={d} />}
    </QueryView>
  );
}
