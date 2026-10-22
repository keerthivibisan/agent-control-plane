import type { PullRequestDto, TicketDto } from '@acp/core/api';
import { useEffect, useId, useRef, useState } from 'react';
import { Button, buttonClass } from '../../components/Button';
import { Details } from '../../components/Details';
import { ErrorNotice } from '../../components/ErrorNotice';
import { AlertIcon } from '../../components/icons';
import { hintClass, inputClass, labelClass } from '../../components/Input';
import { Pill, type PillTone } from '../../components/Pill';
import { RelativeTime } from '../../components/RelativeTime';
import { openPullRequest, refreshPullRequest, type ApiError } from '../../lib/api';
import { PULL_REQUEST_COPY } from '../../lib/copy';
import { alertClass } from '../control/bits';
import { useTicketAction } from '../ticket/actions';
import {
  MAX_PR_TITLE,
  canRefresh,
  defaultPullRequestTitle,
  pullRequestErrorText,
  pullRequestTitleError,
} from './code-host';
import { ExternalLinkIcon, PullRequestIcon, RefreshIcon } from './icons';

const C = PULL_REQUEST_COPY;

const STATE_TONE: Record<PullRequestDto['state'], PillTone> = {
  open: 'accent',
  merged: 'success',
  closed: 'neutral',
};

/**
 * A failed push, pull request or refresh: the server's code in plain words with what to do, or
 * the fallback; the raw error under Details.
 */
export function PullRequestError({
  error,
  fallback,
}: {
  error: ApiError | null;
  fallback: string;
}) {
  if (error === null) return null;
  const text = pullRequestErrorText(error);
  return (
    <div className="flex flex-col gap-1.5" data-testid="pr-error" data-code={error.code ?? ''}>
      <p role="alert" className={alertClass}>
        <AlertIcon size={16} className="mt-0.5 shrink-0" />
        <span className="min-w-0">{text ?? fallback}</span>
      </p>
      <Details>
        <ErrorNotice error={error} />
      </Details>
    </div>
  );
}

/** Only a GitHub page opens from the card; anything else is shown as text (never a link). */
function safeUrl(url: string): string | null {
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * The pull request raised for the ticket branch: its number as a link (a new tab), its state,
 * when the app last read it, Refresh (until it is merged), and what happens next.
 */
export function PullRequestInfo({
  pr,
  ticketId,
}: {
  pr: PullRequestDto;
  /** Null for a run without a ticket: no Refresh. */
  ticketId: string | null;
}) {
  const refresh = useTicketAction(refreshPullRequest);
  const url = safeUrl(pr.url);
  const label = C.number(pr.number);
  return (
    <div
      className="flex flex-col gap-2 rounded-control border border-line bg-sunken px-3 py-2.5"
      data-testid="pull-request"
      data-pr-state={pr.state}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <PullRequestIcon size={16} className="shrink-0 text-dim" />
        {url === null ? (
          <span className="font-medium">{label}</span>
        ) : (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium"
            data-testid="pr-link"
          >
            {label}
            <ExternalLinkIcon size={13} />
            <span className="sr-only">{C.newTab}</span>
          </a>
        )}
        <span data-testid="pr-state">
          <Pill tone={STATE_TONE[pr.state]}>{C.state[pr.state]}</Pill>
        </span>
        <span className="text-caption text-dim" data-testid="pr-checked">
          {C.checked} <RelativeTime iso={pr.checkedAt} />
        </span>
        {ticketId !== null && canRefresh(pr) ? (
          <Button
            size="sm"
            variant="quiet"
            className="ml-auto"
            disabled={refresh.pending}
            onClick={() => void refresh.run(ticketId)}
          >
            <RefreshIcon size={14} />
            {refresh.pending ? C.refreshing : C.refresh}
          </Button>
        ) : null}
      </div>
      <p className="text-caption text-dim" data-testid="pr-note">
        {pr.state === 'open'
          ? C.openNote(pr.baseBranch)
          : pr.state === 'merged'
            ? C.mergedNote(pr.baseBranch)
            : C.closedNote}
      </p>
      <PullRequestError error={refresh.error} fallback={C.refreshFailed} />
    </div>
  );
}

/**
 * Push & open PR (ADR-0025 §2): off, with the reason under it, when GitHub isn't ready; otherwise
 * a confirmation that says what will happen, with the title (`<KEY>: <title>`) and a draft choice.
 * Only the confirm button sends anything.
 */
export function PushAndOpenPr({
  ticket,
  branch,
  target,
  blockedReason,
  disabled = false,
}: {
  ticket: Pick<TicketDto, 'id' | 'key' | 'title'>;
  branch: string;
  target: string;
  /** Why it can't be used now; null when it can. */
  blockedReason: string | null;
  /** Another action is running. */
  disabled?: boolean;
}) {
  const act = useTicketAction(openPullRequest);
  const [asking, setAsking] = useState(false);
  const [title, setTitle] = useState(() => defaultPullRequestTitle(ticket));
  const [draft, setDraft] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const ids = { question: useId(), title: useId(), reason: useId(), draft: useId() };
  const titleError = pullRequestTitleError(title);

  useEffect(() => {
    if (asking) titleRef.current?.focus();
  }, [asking]);

  if (!asking) {
    return (
      <div className="flex flex-col gap-1.5">
        <Button
          className="w-fit"
          onClick={() => {
            act.reset();
            setTitle(defaultPullRequestTitle(ticket));
            setDraft(false);
            setAsking(true);
          }}
          disabled={blockedReason !== null || disabled || act.pending}
          aria-describedby={blockedReason === null ? undefined : ids.reason}
        >
          <PullRequestIcon size={15} />
          {C.push}
        </Button>
        {blockedReason !== null ? (
          <span id={ids.reason} className="text-caption text-dim" data-testid="push-blocked">
            {blockedReason}
          </span>
        ) : null}
        <PullRequestError error={act.error} fallback={C.failed} />
      </div>
    );
  }
  return (
    <form
      role="group"
      aria-labelledby={ids.question}
      data-testid="push-confirm"
      noValidate
      className="flex w-full animate-fade-in flex-col gap-3 rounded-control border border-line-strong bg-sunken px-3 py-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (titleError !== undefined || act.pending) return;
        void act.run(ticket.id, { title: title.trim(), draft }).then((done) => {
          if (done !== null) setAsking(false);
        });
      }}
    >
      <p id={ids.question}>{C.confirm(branch, target)}</p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.title} className={labelClass}>
          {C.titleLabel}
        </label>
        <input
          id={ids.title}
          ref={titleRef}
          value={title}
          maxLength={MAX_PR_TITLE + 50}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={titleError ? true : undefined}
          aria-describedby={titleError ? `${ids.title}-error` : undefined}
          className={inputClass()}
        />
        {titleError ? (
          <span id={`${ids.title}-error`} role="alert" className="text-caption text-danger">
            {titleError}
          </span>
        ) : null}
      </div>
      <div className="flex items-start gap-2.5">
        <input
          id={ids.draft}
          type="checkbox"
          checked={draft}
          onChange={(e) => setDraft(e.target.checked)}
          aria-describedby={`${ids.draft}-hint`}
          className="mt-0.5 size-4 shrink-0 accent-accent"
        />
        <span className="flex flex-col">
          <label htmlFor={ids.draft} className={labelClass}>
            {C.draft}
          </label>
          <span id={`${ids.draft}-hint`} className={hintClass}>
            {C.draftHint}
          </span>
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          className={buttonClass('primary')}
          disabled={act.pending || titleError !== undefined}
        >
          {act.pending ? C.pushing : C.confirmButton}
        </button>
        <button
          type="button"
          className={buttonClass('secondary')}
          onClick={() => {
            act.reset();
            setAsking(false);
          }}
          disabled={act.pending}
        >
          {C.cancel}
        </button>
      </div>
      <PullRequestError error={act.error} fallback={C.failed} />
    </form>
  );
}
