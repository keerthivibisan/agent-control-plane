import type { ChangeReviewDto, RunDetailDto, TicketBranchDto, TicketDto } from '@acp/core/api';
import type { ReactNode } from 'react';
import { Button } from '../../components/Button';
import { Details } from '../../components/Details';
import { EmptyState } from '../../components/EmptyState';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Badge, Pill } from '../../components/Pill';
import { LoadingBlock } from '../../components/Skeleton';
import {
  controlPaths,
  controlSchemas,
  reviewLoopPaths,
  reviewLoopSchemas,
  type ApiError,
} from '../../lib/api';
import {
  changeStateWord,
  CONTROL_COPY,
  REVIEW_LOOP_COPY,
  WORKFLOW_LIVE_COPY,
} from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { href } from '../../lib/router';
import { ChangeChecks, ChangeStateChip } from '../review-loop/ChangeCard';
import { BranchIcon, ReworkIcon } from '../review-loop/icons';
import { changeTone, reworkRoundsBy, shortCommit } from '../review-loop/logic';
import { ALL_CHANGES, ChangePicker, type ChangeOption } from '../review/ChangePicker';
import { reviewChoices } from '../review/choices';
import { REVIEW_PAGE_COPY as T } from '../review/copy';
import {
  branchFilesState,
  changeChoices,
  filesStateOf,
  isGoneError,
  isReadOnly,
  selectionFor,
  type ChangeChoice,
  type FilesState,
} from '../review/files-state';
import { FilesChanged } from '../review/FilesChanged';
import { ClosedStateIcon, MergedStateIcon, OpenStateIcon } from '../review/icons';
import { useReviewSend } from '../review/use-send';
import { FilesChangedIcon } from './icons';
import type { AgentReview, TicketBranchReview } from './run-data';
import type { PanelTab } from './SidePanel';
import { hasWorktree } from './ticket-state';

/*
 * The ticket's Files changed tab (v0.3.0 C-D): one GitHub "Files changed" for the whole ticket.
 * A head with "Changes from" (all changes, the ticket branch from base to tip, or one helper's
 * change; `?change=` in the address), the state label (Open, Merged, Closed) and what the
 * selection is, then D-A's review UI: the file tree, the diff unified or side by side, Viewed,
 * line comments as a pending review and Review changes, sent through the owner's existing
 * endpoints. Merged or closed work is the same layout read only (ADR-0026 §5): files, tree and
 * Viewed, no comment boxes and no review. The diff text is the server's, never stored.
 */

const B = REVIEW_LOOP_COPY.branch;
const R = CONTROL_COPY.review;

type Run = RunDetailDto;
type TicketRef = Pick<TicketDto, 'id' | 'projectId'>;

/**
 * How many files the tab's count says: the ticket branch's combined change once it is read, else
 * every distinct path the helpers' reviews list; null when nothing is known yet.
 */
export function filesCount(
  reviews: readonly AgentReview[],
  branchReview: Pick<TicketBranchReview, 'query'>,
): number | null {
  const combined = branchReview.query.data;
  if (combined !== undefined) return combined.files.length;
  if (reviews.length === 0) return null;
  return new Set(reviews.flatMap((r) => r.files.map((f) => f.path))).size;
}

const STATE_CLASS: Record<FilesState, string> = {
  open: 'bg-success',
  merged: 'bg-done',
  closed: 'bg-danger',
};
const STATE_ICON = { open: OpenStateIcon, merged: MergedStateIcon, closed: ClosedStateIcon };

/** GitHub's state label: a filled pill with an icon and the word (never color alone). */
function StateLabel({ state }: { state: FilesState }) {
  const Icon = STATE_ICON[state];
  return (
    <span
      className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-caption font-semibold text-canvas ${STATE_CLASS[state]}`}
      title={T.stateTip[state]}
      data-testid="files-state"
      data-state={state}
    >
      <Icon size={14} strokeWidth={2} />
      {T.state[state]}
    </span>
  );
}

function Code({ children }: { children: string }) {
  return (
    <code className="rounded-control bg-accent-soft px-1.5 py-0.5 font-mono text-caption break-all text-accent">
      {children}
    </code>
  );
}

function Commit({ label, commit }: { label: string; commit: string }) {
  return (
    <span className="inline-flex items-center gap-1.5" data-testid="files-commit">
      <span className="text-dim">{label}</span>
      <span className="font-mono text-ink" title={commit}>
        {shortCommit(commit)}
      </span>
    </span>
  );
}

/** The ticket branch in words: `branch into main`, `merged into main`, or `was discarded`. */
function BranchLine({ branch }: { branch: TicketBranchDto }) {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5" data-testid="files-branch">
      <BranchIcon size={14} className="shrink-0 text-dim" />
      <Code>{branch.branch}</Code>
      {branch.state === 'discarded' ? (
        <span className="text-dim">{T.discarded}</span>
      ) : (
        <>
          <span className="text-dim">{branch.state === 'merged' ? T.mergedWord : T.intoWord}</span>
          <Code>{branch.baseBranch}</Code>
        </>
      )}
    </span>
  );
}

function Failed({ error }: { error: ApiError }) {
  return (
    <div className="flex flex-col gap-1.5" data-testid="files-failed">
      <p className="text-danger">{T.loadFailed}</p>
      <Details>
        <ErrorNotice error={error} />
      </Details>
    </div>
  );
}

function Gone() {
  return (
    <EmptyState
      icon={<FilesChangedIcon size={20} />}
      title={T.gone.title}
      text={T.gone.text}
      testId="files-unavailable"
    />
  );
}

/** A change's state for the picker and the head: the loop's chip, or the legacy review's word. */
function choiceState(
  choice: ChangeChoice,
  branch: string | null,
  { tip = true }: { tip?: boolean } = {},
): ReactNode {
  const { change } = choice;
  if (change !== null && tip) return <ChangeStateChip change={change} branch={branch} />;
  if (change !== null) {
    // In the picker's menu items: the word only, no tip button inside a menu item.
    return (
      <span data-testid="change-state" data-state={change.state}>
        <Pill tone={changeTone(change.state)}>
          {changeStateWord(change.state, {
            round: change.reworkRounds,
            max: change.maxReworkRounds,
            branch,
          })}
        </Pill>
      </span>
    );
  }
  if (choice.review !== null) {
    return (
      <span className="text-caption text-dim" data-state={choice.review.state}>
        {R.state[choice.review.state]}
      </span>
    );
  }
  return null;
}

function choiceFiles(choice: ChangeChoice): number | null {
  if (choice.review !== null) return choice.review.files.length;
  return choice.change?.changedFiles ?? null;
}

/** All changes: the ticket branch from its base to its tip (`GET /runs/:id/ticket-branch`). */
function BranchFiles({
  ticket,
  run,
  branch,
  state,
}: {
  ticket: TicketRef;
  run: Run;
  branch: TicketBranchDto;
  state: FilesState;
}) {
  const readOnly = isReadOnly(state);
  const q = useApiQuery(reviewLoopPaths.ticketBranch(run.id), reviewLoopSchemas.ticketBranch);
  const sender = useReviewSend(run.id, ticket.id, null);
  const files = branchFilesState(q, readOnly);
  if (files.state === 'loading') return <LoadingBlock label={T.loading} />;
  if (files.state === 'unavailable') return <Gone />;
  if (files.state === 'error') return <Failed error={files.error} />;
  const { review } = files;
  // The tip as the server read it with the diff, else as the run knows it.
  const tip = review.ticketBranch.headCommit;
  return (
    <FilesChanged
      key={`branch:${tip}`}
      scope={{ runId: run.id, agentRunId: null }}
      commit={tip}
      diff={review.diff}
      truncated={review.diffTruncated}
      listed={review.files.map((f) => f.path)}
      choices={reviewChoices({ kind: 'branch', run, branch })}
      send={sender.send}
      sending={sender.sending}
      sendError={sender.error}
      ticketHref={href.ticketConversation({ projectId: ticket.projectId, ticketId: ticket.id })}
      readOnly={readOnly}
    />
  );
}

/** One helper's change, its latest round (`GET /runs/:id/review`). */
function ChangeFiles({
  ticket,
  run,
  choice,
  readOnly,
  onShowAll,
}: {
  ticket: TicketRef;
  run: Run;
  choice: ChangeChoice;
  readOnly: boolean;
  /** Null when the run has no ticket branch to show instead. */
  onShowAll: (() => void) | null;
}) {
  const q = useApiQuery(controlPaths.review(run.id), controlSchemas.review);
  const entry = q.data?.agents.find((a) => a.agentRunId === choice.agentRunId);
  const sender = useReviewSend(run.id, ticket.id, choice.agentRunId);
  const commit = choice.change?.headCommit ?? null;
  if (entry !== undefined) {
    return (
      <FilesChanged
        key={`${choice.agentRunId}:${commit ?? ''}`}
        scope={{ runId: run.id, agentRunId: choice.agentRunId }}
        commit={commit}
        diff={entry.diff}
        truncated={entry.diffTruncated}
        listed={entry.files.map((f) => f.path)}
        choices={reviewChoices({ kind: 'change', run, change: choice.change })}
        send={sender.send}
        sending={sender.sending}
        sendError={sender.error}
        ticketHref={href.ticketConversation({ projectId: ticket.projectId, ticketId: ticket.id })}
        readOnly={readOnly}
      />
    );
  }
  if (q.data !== undefined) {
    // The server lists a change only from when it is saved until it is decided.
    const saving = choice.change !== null && choice.change.headCommit === null;
    return (
      <div
        role="note"
        className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-line bg-sunken px-4 py-3 text-dim"
        data-testid="review-unavailable"
      >
        <span>{saving ? T.notSaved : T.changeGone}</span>
        {!saving && onShowAll !== null ? (
          <Button size="sm" onClick={onShowAll}>
            {T.showAll}
          </Button>
        ) : null}
      </div>
    );
  }
  if (q.error !== null) return isGoneError(q.error) ? <Gone /> : <Failed error={q.error} />;
  return <LoadingBlock label={T.loading} />;
}

/** How the change came back: rework from the lead, direct rework from the reviewer, conflicts. */
function ChangeBadges({ change }: { change: ChangeReviewDto }) {
  const direct = reworkRoundsBy(change, 'reviewer');
  const byLead = change.reworkRounds - direct;
  return (
    <>
      {byLead > 0 ? (
        <Badge>
          <span className="inline-flex items-center gap-1">
            <ReworkIcon size={12} />
            {REVIEW_LOOP_COPY.graph.rework(byLead)}
          </span>
        </Badge>
      ) : null}
      {direct > 0 ? (
        <Badge>
          <span className="inline-flex items-center gap-1" data-testid="change-direct-badge">
            <ReworkIcon size={12} />
            {WORKFLOW_LIVE_COPY.changes.directBadge(direct)}
          </span>
        </Badge>
      ) : null}
      {change.conflictFiles.length > 0 ? (
        <Badge tone="warning">{REVIEW_LOOP_COPY.changes.conflictsShort}</Badge>
      ) : null}
    </>
  );
}

/** The facts of one change in the head: its state, round, checks, rework and commit. */
function ChangeFacts({ choice, branch }: { choice: ChangeChoice; branch: string | null }) {
  const { change } = choice;
  return (
    <span
      className="inline-flex flex-wrap items-center gap-x-3 gap-y-1.5"
      data-testid="files-change"
      data-agent={choice.agentRunId}
    >
      {choiceState(choice, branch)}
      {change !== null ? (
        <>
          <span className="font-medium text-ink">{T.round(change.reworkRounds)}</span>
          <ChangeChecks change={change} />
          <ChangeBadges change={change} />
          {change.headCommit !== null ? (
            <span className="font-mono text-dim" title={change.headCommit}>
              {shortCommit(change.headCommit)}
            </span>
          ) : null}
        </>
      ) : null}
    </span>
  );
}

/**
 * The Files changed tab. `change` is the address's `?change=` (null: all changes, or for a run
 * without a ticket branch the first change); `onChange` writes it back.
 */
export function FilesTab({
  ticket,
  run,
  reviews,
  change,
  onChange,
  onOpenAgent,
}: {
  ticket: TicketRef;
  run: Run | undefined;
  reviews: readonly AgentReview[];
  change: string | null;
  onChange: (agentRunId: string | null) => void;
  onOpenAgent: (agentId: string, tab?: PanelTab) => void;
}) {
  // Read for the head's tip checks while all changes are shown; the body reads the same address.
  const branch = run?.ticketBranch ?? null;
  const showsAll = change === null && branch !== null;
  const tipQuery = useApiQuery(
    showsAll && run !== undefined ? reviewLoopPaths.ticketBranch(run.id) : null,
    reviewLoopSchemas.ticketBranch,
  );
  if (run === undefined) {
    return (
      <EmptyState
        icon={<FilesChangedIcon size={20} />}
        title={T.noRun.title}
        text={T.noRun.text}
        testId="files-tab"
      />
    );
  }
  const choices = changeChoices(run, reviews, hasWorktree);
  const selection = selectionFor(change, branch !== null, choices);
  const state = filesStateOf(branch);
  const readOnly = isReadOnly(state);
  const branchName = branch?.branch ?? null;
  const chosen =
    selection.kind === 'change'
      ? (choices.find((c) => c.agentRunId === selection.agentRunId) ?? null)
      : null;
  const options: ChangeOption[] = choices.map((c) => {
    const n = choiceFiles(c);
    return {
      id: c.agentRunId,
      role: c.role,
      state: (
        <>
          {choiceState(c, branchName, { tip: false })}
          {c.change !== null ? <ChangeChecks change={c.change} /> : null}
        </>
      ),
      files: n === null ? null : B.files(n),
    };
  });
  const showAll = branch !== null ? () => onChange(null) : null;

  let body: ReactNode;
  if (selection.kind === 'all' && branch !== null && state !== null) {
    body = <BranchFiles ticket={ticket} run={run} branch={branch} state={state} />;
  } else if (selection.kind === 'change' && chosen !== null) {
    body = (
      <ChangeFiles
        key={chosen.agentRunId}
        ticket={ticket}
        run={run}
        choice={chosen}
        readOnly={readOnly}
        onShowAll={showAll}
      />
    );
  } else if (selection.kind === 'change') {
    body = (
      <EmptyState
        icon={<FilesChangedIcon size={20} />}
        title={T.noChange.title}
        text={T.noChange.text}
        testId="files-no-change"
        action={
          showAll !== null ? (
            <Button variant="primary" onClick={showAll}>
              {T.showAll}
            </Button>
          ) : undefined
        }
      />
    );
  } else {
    const loop = run.changes !== undefined || run.ticketBranch !== undefined;
    const empty = loop ? T.noBranch : T.noChanges;
    body = (
      <EmptyState
        icon={<FilesChangedIcon size={20} />}
        title={empty.title}
        text={empty.text}
        testId="files-empty"
      />
    );
  }

  const tip = tipQuery.data;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="files-tab" data-state={state ?? ''}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2" data-testid="files-head">
        {choices.length > 0 || branch !== null ? (
          <ChangePicker
            options={options}
            value={selection.kind === 'change' ? selection.agentRunId : ALL_CHANGES}
            allowAll={branch !== null}
            onChange={(id) => onChange(id === ALL_CHANGES ? null : id)}
          />
        ) : null}
        {state !== null ? <StateLabel state={state} /> : null}
        <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-caption">
          {branch !== null ? <BranchLine branch={branch} /> : null}
          {branch !== null && branch.state === 'merged' && branch.mergedCommit !== null ? (
            <Commit label={T.mergeCommit} commit={branch.mergedCommit} />
          ) : branch !== null && selection.kind === 'all' ? (
            <Commit
              label={T.tipCommit}
              commit={tip?.ticketBranch.headCommit ?? branch.headCommit}
            />
          ) : null}
          {selection.kind === 'all' && tip !== undefined && state === 'open' ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="text-dim">{T.checksOnTip}</span>
              <ChangeChecks change={{ checks: tip.checks }} />
            </span>
          ) : null}
          {selection.kind === 'all' && run.changes !== undefined ? (
            <span className="text-dim tabular-nums">
              {T.changesMerged(run.changes.filter((c) => c.state === 'merged').length)}
            </span>
          ) : null}
          {chosen !== null ? <ChangeFacts choice={chosen} branch={branchName} /> : null}
        </p>
        {chosen !== null ? (
          <Button
            size="sm"
            variant="quiet"
            className="ml-auto"
            aria-label={T.openInAgentsLabel(chosen.role)}
            onClick={() => onOpenAgent(chosen.agentRunId, 'changes')}
            data-testid="files-open-agent"
          >
            {T.openInAgents}
          </Button>
        ) : null}
      </div>
      {body}
    </div>
  );
}
