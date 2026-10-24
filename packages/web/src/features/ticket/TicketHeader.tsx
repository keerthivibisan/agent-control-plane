import type { TicketStage } from '@acp/core';
import type { RunDetailDto, TicketDetailDto, TicketDto } from '@acp/core/api';
import { useId, useState, type ReactNode } from 'react';
import { Button } from '../../components/Button';
import { InfoTip } from '../../components/InfoTip';
import { fieldClass, inputClass } from '../../components/Input';
import type { PillTone } from '../../components/Pill';
import { rerunTicket, stopRun, updateTicket } from '../../lib/api';
import {
  CONTROL_COPY,
  MERGE_PR_COPY,
  PULL_REQUEST_COPY,
  REVIEW_LOOP_COPY,
  RUN_STATUS_COPY,
  TICKET_BRANCH_COPY,
  TICKET_COPY,
  TICKET_PAGE_COPY,
  TICKET_STAGE_COPY,
} from '../../lib/copy';
import { href } from '../../lib/router';
import { hasNewCommits } from '../branching/code-host';
import { projectBranchName, projectTarget } from '../branching/ticket-branch';
import { MissingTargetFix } from '../branching/Branches';
import { useBranchDefaults } from '../branching/TicketBranchFields';
import { ActionError, ConfirmAction, StatusWord } from '../control/bits';
import { BranchIcon, OptionsIcon } from '../review-loop/icons';
import { checksSummary } from '../review-loop/logic';
import { StartDialog } from '../review-loop/StartDialog';
import { useTicketAction } from './actions';
import { EditIcon } from './icons';
import { TicketTotalsBadge } from './TicketTotalsBadge';
import type { TicketBranchReview } from './run-data';
import { useTicketNav } from './ticket-nav';
import {
  FINAL_STEP_ID,
  NEEDS_YOU_ID,
  canStopRun,
  runNumber,
  showRunStatus,
  startAction,
} from './ticket-state';

const C = TICKET_COPY;
const H = TICKET_PAGE_COPY.header;
const RL = REVIEW_LOOP_COPY;
const B = REVIEW_LOOP_COPY.branch;
const MAX_TITLE = 200;

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
  ticket: Pick<TicketDto, 'id' | 'key' | 'projectId' | 'runOptions' | 'branch'>;
  kind: 'start' | 'rerun';
}) {
  const start = useTicketAction(rerunTicket);
  // G-F: a refusal for a missing target branch offers to create it, then starts once more.
  const branchDefaults = useBranchDefaults(ticket.projectId);
  // ADR-0021: "Options" opens the Start dialog for this run's own settings; Start stays one click.
  const withOptions = useTicketAction(rerunTicket);
  const [dialog, setDialog] = useState(false);
  const optionsName =
    kind === 'rerun' ? RL.start.rerunOptionsFor(ticket.key) : RL.start.optionsFor(ticket.key);
  return (
    <div className="flex max-w-md flex-col items-end gap-2">
      <div className="flex items-center gap-1.5">
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
      </div>
      <ActionError error={start.error} message={C.actions.startFailed} />
      <MissingTargetFix
        projectId={ticket.projectId}
        ticketBranch={ticket.branch}
        strategy={branchDefaults?.strategy}
        error={start.error}
        onRetry={() => void start.run(ticket.id)}
      />
      {dialog ? (
        <StartDialog
          projectId={ticket.projectId}
          ticketKey={ticket.key}
          ticketOptions={ticket.runOptions}
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
 * The final step's main action (v0.3.0 D-B), for the header: what the owner would press in the
 * final-step box, or null when nothing waits there. A merge, a merge past a failed required
 * check, pushing new commits to the open pull request, or merging it on GitHub (G-G).
 */
export function finalStepAction(br: TicketBranchReview): string | null {
  if (br.mode !== 'merge' || br.branch === null) return null;
  if (br.branch.pullRequest?.state === 'open') {
    // G-G: merged on GitHub from the final step, once the new commits are pushed.
    return hasNewCommits(br.branch) ? PULL_REQUEST_COPY.pushNew : MERGE_PR_COPY.button.merge;
  }
  const checks = checksSummary(br.query.data?.checks ?? []);
  return checks.kind === 'failed' ? B.mergeAnyway : B.merge(br.branch.baseBranch);
}

/** GitHub's state label, from the board's stage: the colour says it, the word always too. */
const STAGE_TONE: Record<TicketStage, PillTone> = {
  BACKLOG: 'neutral',
  READY: 'neutral',
  PLANNING: 'accent',
  PLAN_REVIEW: 'warning',
  WORKING: 'accent',
  NEEDS_YOU: 'warning',
  IN_REVIEW: 'warning',
  DONE: 'done',
  CANCELLED: 'neutral',
};

const TONE_CLASS: Record<PillTone, string> = {
  neutral: 'border-line-strong bg-subtle text-ink',
  accent: 'border-accent/50 bg-accent-soft text-accent',
  success: 'border-success/50 bg-success-soft text-success',
  warning: 'border-warning/50 bg-warning-soft text-warning',
  danger: 'border-danger/50 bg-danger-soft text-danger',
  done: 'border-done/50 bg-done-soft text-done',
};

const DOT_CLASS: Record<PillTone, string> = {
  neutral: 'bg-status-stale',
  accent: 'bg-accent',
  success: 'bg-status-active',
  warning: 'bg-status-idle',
  danger: 'bg-danger',
  done: 'bg-done',
};

function StatePill({ stage }: { stage: TicketStage }) {
  const copy = TICKET_STAGE_COPY[stage];
  const tone = STAGE_TONE[stage];
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={`inline-flex h-8 items-center gap-2 rounded-full border px-3 font-medium whitespace-nowrap ${TONE_CLASS[tone]}`}
        data-testid="ticket-stage"
        data-stage={stage}
        data-tone={tone}
      >
        <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${DOT_CLASS[tone]}`} />
        {copy.word}
      </span>
      <InfoTip tip={copy.tip} label={`status ${copy.word}`} />
    </span>
  );
}

function Sep() {
  return (
    <span aria-hidden="true" className="text-dim">
      ·
    </span>
  );
}

function Code({ children, testId }: { children: string; testId?: string }) {
  return (
    <code
      className="max-w-full rounded-control bg-accent-soft px-1.5 py-0.5 font-mono text-caption break-all text-accent"
      data-testid={testId}
    >
      {children}
    </code>
  );
}

/**
 * The line under the title, like GitHub's "wants to merge": the ticket branch and its target
 * (the planned name until the run creates it), how many changes landed on it, the agents, and
 * what waits for the owner.
 */
function MetaLine({
  detail,
  run,
  isCurrent,
}: {
  detail: TicketDetailDto;
  run: RunDetailDto | undefined;
  isCurrent: boolean;
}) {
  const { ticket } = detail;
  const nav = useTicketNav();
  const defaults = useBranchDefaults(ticket.projectId);
  const created = run?.ticketBranch ?? null;
  const name =
    created?.branch ??
    ticket.branch?.name ??
    (defaults === null ? null : projectBranchName(defaults.strategy, ticket));
  const target =
    created?.baseBranch ??
    ticket.branch?.target ??
    (defaults === null
      ? null
      : (projectTarget(defaults.strategy) ?? TICKET_BRANCH_COPY.currentBranch));
  const merged = (run?.changes ?? []).filter((c) => c.state === 'merged').length;
  const waiting = run?.approvals.filter((a) => a.status === 'pending').length ?? 0;
  const facts: { key: string; node: ReactNode }[] = [];
  if (run === undefined) {
    facts.push({ key: 'none', node: <span>{C.summary.noRun}</span> });
  } else {
    if (showRunStatus(isCurrent, run.status)) {
      facts.push({
        key: 'status',
        node: <StatusWord status={RUN_STATUS_COPY[run.status]} value={run.status} />,
      });
    }
    if (run.changes !== undefined) {
      facts.push({
        key: 'merged',
        node: <span className="text-ink">{B.changesMerged(merged)}</span>,
      });
    }
    facts.push({
      key: 'agents',
      node: <span className="text-ink">{C.summary.agents(run.agents.length)}</span>,
    });
    if (waiting > 0) {
      facts.push({
        key: 'waiting',
        node: (
          <button
            type="button"
            className="font-medium text-warning hover:underline"
            title={H.needsYouTip}
            onClick={() => nav?.goTo('comments', NEEDS_YOU_ID)}
          >
            {C.summary.needsYou(waiting)}
          </button>
        ),
      });
    }
  }
  return (
    <p
      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-dim tabular-nums"
      data-testid="ticket-summary"
    >
      {name !== null ? (
        <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5" data-testid="pr-line">
          <BranchIcon size={14} className="shrink-0" />
          <span className="sr-only">{H.branchLabel}: </span>
          <Code testId="pr-line-branch">{name}</Code>
          {target !== null ? (
            <>
              <span aria-hidden="true">→</span>
              <span className="sr-only">{H.into}</span>
              <Code testId="pr-line-target">{target}</Code>
            </>
          ) : null}
          {created === null ? <InfoTip tip={H.plannedTip} label={H.branchLabel} /> : null}
        </span>
      ) : null}
      {facts.map((f, i) => (
        // Each fact keeps its "·" with it when the line wraps (a phone).
        <span key={f.key} className="inline-flex items-center gap-2 whitespace-nowrap">
          {i > 0 || name !== null ? <Sep /> : null}
          {f.node}
        </span>
      ))}
    </p>
  );
}

/** The title, with Edit (GitHub's): a field in its place, saved with PATCH. */
function Title({ ticket }: { ticket: Pick<TicketDto, 'id' | 'key' | 'title'> }) {
  const save = useTicketAction(updateTicket);
  const [draft, setDraft] = useState<string | null>(null);
  const id = useId();
  if (draft === null) {
    return (
      <div className="flex min-w-0 items-start gap-2">
        <h1 className="min-w-0 flex-1 text-page font-semibold break-words">
          <span className="mr-2.5 font-mono font-medium text-dim">{ticket.key}</span>
          {ticket.title}
        </h1>
        <Button
          size="sm"
          className="mt-0.5 shrink-0"
          aria-label={H.editLabel}
          onClick={() => {
            save.reset();
            setDraft(ticket.title);
          }}
        >
          <EditIcon size={14} />
          {H.edit}
        </Button>
      </div>
    );
  }
  const trimmed = draft.trim();
  const valid = trimmed.length > 0 && trimmed.length <= MAX_TITLE;
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        void save.run(ticket.id, { title: trimmed }).then((done) => {
          if (done !== null) setDraft(null);
        });
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-section font-medium text-dim">{ticket.key}</span>
        <label htmlFor={id} className="sr-only">
          {H.titleLabel}
        </label>
        <input
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-invalid={valid ? undefined : true}
          // The field replaces the title the owner just chose to edit.
          autoFocus
          className={inputClass('min-w-0 flex-1 basis-60 text-title')}
        />
        <Button type="submit" variant="primary" disabled={save.pending || !valid}>
          {save.pending ? H.saving : H.save}
        </Button>
        <Button onClick={() => setDraft(null)} disabled={save.pending}>
          {H.cancel}
        </Button>
      </div>
      <ActionError error={save.error} message={H.failed} />
    </form>
  );
}

/**
 * The ticket page's header (v0.3.0 D-B), GitHub's pull request header: back to the board, the
 * key and title with Edit, the actions on the right (the run picker, Stop all, Start, and the
 * final step's main action), then the state label and the "wants to merge" line.
 */
export function TicketHeader({
  detail,
  run,
  runId,
  isCurrent,
  onPickRun,
  branchReview,
}: {
  detail: TicketDetailDto;
  run: RunDetailDto | undefined;
  runId: string | null;
  isCurrent: boolean;
  onPickRun: (runId: string) => void;
  branchReview: TicketBranchReview;
}) {
  const { ticket } = detail;
  const nav = useTicketNav();
  const action = startAction(detail);
  const finalAction = isCurrent ? finalStepAction(branchReview) : null;
  return (
    <header className="mb-4 flex flex-col gap-3" data-testid="ticket-header">
      <a
        href={href.board(ticket.projectId)}
        className="w-fit text-caption text-dim no-underline hover:text-ink"
      >
        ← {C.backToBoard}
      </a>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:gap-x-6">
        <div className="min-w-0 md:flex-1">
          <Title key={ticket.updatedAt} ticket={ticket} />
        </div>
        <div className="flex flex-wrap items-start gap-2 md:justify-end">
          {runId !== null ? <RunPicker detail={detail} runId={runId} onPick={onPickRun} /> : null}
          {run !== undefined && isCurrent && canStopRun(run.status) ? (
            <StopAll runId={run.id} />
          ) : null}
          {action !== null ? <StartButton ticket={ticket} kind={action} /> : null}
          {finalAction !== null ? (
            <Button
              variant="primary"
              aria-label={H.goTo(finalAction)}
              data-testid="final-step-shortcut"
              onClick={() => nav?.goTo('comments', FINAL_STEP_ID)}
            >
              {finalAction}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <StatePill stage={ticket.stage} />
        <MetaLine detail={detail} run={run} isCurrent={isCurrent} />
        {/* v0.3.0 T-A: time taken and tokens, at the line's right end (wraps on a phone). */}
        <TicketTotalsBadge ticket={ticket} />
      </div>
    </header>
  );
}
