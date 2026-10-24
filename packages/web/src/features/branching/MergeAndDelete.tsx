import type { PullRequestDto, TicketBranchDto } from '@acp/core/api';
import { useEffect, useId, useRef, useState } from 'react';
import { Button, buttonClass } from '../../components/Button';
import { Details } from '../../components/Details';
import { ErrorNotice } from '../../components/ErrorNotice';
import { AlertIcon, CheckIcon, MergeIcon } from '../../components/icons';
import { fieldClass, hintClass, labelClass } from '../../components/Input';
import { deleteTicketBranch, mergePullRequest, type ApiError } from '../../lib/api';
import { MERGE_PR_COPY, type MergeMethodKey } from '../../lib/copy';
import { alertClass, dangerButtonClass } from '../control/bits';
import { useTicketAction } from '../ticket/actions';
import {
  MERGE_METHODS,
  branchActionErrorText,
  branchGone,
  branchStillExists,
  readMergeMethod,
  saveMergeMethod,
} from './merge-branch';

const M = MERGE_PR_COPY;

/** A failed merge or delete: the app's sentence (or the fallback), the raw error under Details. */
function BranchActionError({
  error,
  fallback,
  testId,
}: {
  error: ApiError | null;
  fallback: string;
  testId: string;
}) {
  if (error === null) return null;
  const text = branchActionErrorText(error);
  return (
    <div className="flex flex-col gap-1.5" data-testid={testId} data-code={error.code ?? ''}>
      <p role="alert" className={alertClass}>
        <AlertIcon size={16} className="mt-0.5 shrink-0" />
        <span className="min-w-0">{text ?? `${fallback} ${error.message}`}</span>
      </p>
      <Details>
        <ErrorNotice error={error} />
      </Details>
    </div>
  );
}

/**
 * Merge pull request (G-G, ADR-0025 §9), GitHub's merge box: the method (a merge commit, squash
 * or rebase; the last one is remembered per project in this browser), "Delete branch" ticked by
 * default, and a confirmation saying exactly what happens. Only the confirm button sends
 * anything; GitHub merges it, then the app reads it again (the ticket is done once merged).
 */
export function MergePullRequest({
  ticket,
  branch,
  pr,
  blockedReason = null,
  disabled = false,
}: {
  ticket: { id: string; projectId: string };
  branch: Pick<TicketBranchDto, 'branch'>;
  pr: Pick<PullRequestDto, 'number' | 'baseBranch'>;
  /** Why it can't be used now (commits not pushed yet); null when it can. */
  blockedReason?: string | null;
  /** Another action is running. */
  disabled?: boolean;
}) {
  const act = useTicketAction(mergePullRequest);
  const [method, setMethod] = useState<MergeMethodKey>(() => readMergeMethod(ticket.projectId));
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [asking, setAsking] = useState(false);
  const [keptLocal, setKeptLocal] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const ids = { method: useId(), del: useId(), reason: useId(), question: useId() };

  useEffect(() => {
    if (asking) cancelRef.current?.focus();
  }, [asking]);

  const choose = (next: MergeMethodKey) => {
    setMethod(next);
    saveMergeMethod(ticket.projectId, next);
  };

  if (asking) {
    return (
      <div
        role="group"
        aria-labelledby={ids.question}
        data-testid="merge-confirm"
        className="flex w-full animate-fade-in flex-col gap-2.5 rounded-control border border-line-strong bg-sunken px-3 py-2.5"
      >
        <p id={ids.question}>
          {M.confirm(pr.number, pr.baseBranch, M.how[method], branch.branch, deleteBranch)}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonClass('primary')}
            disabled={act.pending}
            onClick={() => {
              void act.run(ticket.id, { method, deleteBranch }).then((done) => {
                setAsking(false);
                // The project folder is on the ticket branch: the app left it there.
                setKeptLocal(done !== null && deleteBranch && done.localExists === true);
              });
            }}
          >
            {act.pending ? M.merging : M.confirmButton[method]}
          </button>
          <button
            type="button"
            ref={cancelRef}
            className={buttonClass('secondary')}
            onClick={() => setAsking(false)}
            disabled={act.pending}
          >
            {M.cancel}
          </button>
        </div>
      </div>
    );
  }

  const off = blockedReason !== null || disabled || act.pending;
  return (
    <div className="flex w-full flex-col gap-2" data-testid="merge-pr">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={ids.method} className={labelClass}>
            {M.methodLabel}
          </label>
          <select
            id={ids.method}
            value={method}
            disabled={act.pending}
            onChange={(e) => choose(e.target.value as MergeMethodKey)}
            className={`h-9 py-0 pr-8 pl-2.5 ${fieldClass}`}
          >
            {MERGE_METHODS.map((m) => (
              <option key={m} value={m}>
                {M.methods[m]}
              </option>
            ))}
          </select>
        </div>
        <Button
          variant="primary"
          disabled={off}
          aria-describedby={blockedReason === null ? undefined : ids.reason}
          onClick={() => {
            act.reset();
            setKeptLocal(false);
            setAsking(true);
          }}
        >
          <MergeIcon size={15} />
          {act.pending ? M.merging : M.button[method]}
        </Button>
      </div>
      <div className="flex items-start gap-2.5">
        <input
          id={ids.del}
          type="checkbox"
          checked={deleteBranch}
          disabled={act.pending}
          onChange={(e) => setDeleteBranch(e.target.checked)}
          aria-describedby={`${ids.del}-hint`}
          className="mt-0.5 size-4 shrink-0 accent-accent"
        />
        <span className="flex flex-col">
          <label htmlFor={ids.del} className={labelClass}>
            {M.deleteBranch}
          </label>
          <span id={`${ids.del}-hint`} className={hintClass}>
            {M.deleteBranchHint}
          </span>
        </span>
      </div>
      {blockedReason !== null ? (
        <span id={ids.reason} className="text-caption text-dim" data-testid="merge-blocked">
          {blockedReason}
        </span>
      ) : null}
      {keptLocal ? (
        <p role="status" className="text-caption text-dim" data-testid="merge-kept-local">
          {M.keptLocal(branch.branch)}
        </p>
      ) : null}
      <BranchActionError error={act.error} fallback={M.failed} testId="merge-error" />
    </div>
  );
}

/**
 * Delete branch (G-G, ADR-0025 §9), once the ticket branch is merged or discarded and git says
 * it still exists in the project folder or on GitHub. Asks first, naming where it goes; then says
 * "Branch deleted". The server refuses the target, the base and a checked-out branch.
 */
export function DeleteTicketBranch({
  ticketId,
  branch,
}: {
  ticketId: string;
  branch: Pick<TicketBranchDto, 'branch' | 'state' | 'localExists' | 'pullRequest'>;
}) {
  const act = useTicketAction(deleteTicketBranch);
  const [asking, setAsking] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const questionId = useId();
  const where = branchStillExists(branch);

  useEffect(() => {
    if (asking) cancelRef.current?.focus();
  }, [asking]);

  if (deleted || branchGone(branch)) {
    return (
      <p
        role="status"
        className="inline-flex items-center gap-1.5 text-caption text-dim"
        data-testid="branch-deleted"
      >
        <CheckIcon size={14} className="shrink-0 text-success" />
        {M.deleted}
      </p>
    );
  }
  if (where === null) return null;
  if (!asking) {
    return (
      <div className="flex flex-col gap-1.5" data-testid="delete-branch">
        <Button
          className="w-fit hover:border-danger/60 hover:text-danger"
          disabled={act.pending}
          onClick={() => {
            act.reset();
            setAsking(true);
          }}
        >
          {act.pending ? M.deleting : M.delete}
        </Button>
        <BranchActionError error={act.error} fallback={M.deleteFailed} testId="delete-error" />
      </div>
    );
  }
  return (
    <div
      role="group"
      aria-labelledby={questionId}
      data-testid="delete-confirm"
      className="flex w-full animate-fade-in flex-col gap-2.5 rounded-control border border-line-strong bg-sunken px-3 py-2.5"
    >
      <p id={questionId}>{M.deleteQuestion(branch.branch, where, null)}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={dangerButtonClass}
          disabled={act.pending}
          onClick={() => {
            void act.run(ticketId).then((done) => {
              setAsking(false);
              // Gone everywhere git can tell; a partial answer keeps the button for another try.
              if (done !== null && branchStillExists(done) === null) setDeleted(true);
            });
          }}
        >
          {act.pending ? M.deleting : M.confirmDelete}
        </button>
        <button
          type="button"
          ref={cancelRef}
          className={buttonClass('secondary')}
          onClick={() => setAsking(false)}
          disabled={act.pending}
        >
          {M.cancel}
        </button>
      </div>
    </div>
  );
}
