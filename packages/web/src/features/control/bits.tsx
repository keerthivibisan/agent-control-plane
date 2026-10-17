import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button, buttonClass } from '../../components/Button';
import { Details } from '../../components/Details';
import { ErrorNotice } from '../../components/ErrorNotice';
import { AlertIcon, type IconProps } from '../../components/icons';
import { InfoTip } from '../../components/InfoTip';
import type { AgentRunDto, RunDetailDto } from '@acp/core/api';
import type { ApiError } from '../../lib/api';
import { AGENT_FINISHED_COPY, AGENT_STATUS_COPY, type ControlStatusCopy } from '../../lib/copy';
import { closedByEngine } from './run-state';

/** Dot per tone: color plus shape, so color is never the only signal (DESIGN.md principle 4). */
const DOT: Record<ControlStatusCopy['tone'], string> = {
  working: 'bg-status-active ring-3 ring-status-active/20',
  waiting: 'bg-status-idle',
  done: 'bg-status-ended',
  stopped: 'border-2 border-status-stale bg-transparent',
  problem: 'bg-danger',
};

/** An agent's status in words; "Finished" for a lead the engine closed after good work. */
export function agentStatusCopy(
  agent: Pick<AgentRunDto, 'status' | 'endedAt'>,
  run: Pick<RunDetailDto, 'status' | 'endedAt' | 'agents'>,
): ControlStatusCopy {
  return closedByEngine(agent, run) ? AGENT_FINISHED_COPY : AGENT_STATUS_COPY[agent.status];
}

/** A run or agent status as dot + word (+ ⓘ). */
export function StatusWord({
  status,
  value,
  withTip = true,
}: {
  status: ControlStatusCopy;
  /** The raw state, for tests and styling hooks only; never shown. */
  value: string;
  withTip?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5" data-status={value}>
      <span
        aria-hidden="true"
        className={`inline-block size-2 shrink-0 rounded-full ${DOT[status.tone]}`}
      />
      <span>{status.word}</span>
      {withTip ? <InfoTip tip={status.tip} label={`status ${status.word}`} /> : null}
    </span>
  );
}

/** The shared danger button (DESIGN.md, "Buttons"); kept under this name for its importers. */
export const dangerButtonClass = buttonClass('danger');

/** A failed action's sentence: soft red, with an icon (the words carry the meaning). */
export const alertClass =
  'flex items-start gap-2 rounded-control border border-danger/25 bg-danger-soft px-3 py-2 text-danger';

/**
 * A button that asks first: the first click shows the question with a confirm and a cancel
 * button in place, and only the confirm button acts. The cancel button gets focus, so a stray
 * Enter never confirms.
 */
export function ConfirmAction({
  label,
  question,
  confirmLabel,
  cancelLabel,
  pendingLabel,
  pending,
  onConfirm,
  danger = true,
  primary = false,
  disabled = false,
}: {
  label: string;
  question: string;
  confirmLabel: string;
  cancelLabel: string;
  pendingLabel: string;
  pending: boolean;
  onConfirm: () => Promise<unknown>;
  danger?: boolean;
  /** The resting button is the main action (Merge). */
  primary?: boolean;
  disabled?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const questionId = useId();

  useEffect(() => {
    if (asking) cancelRef.current?.focus();
  }, [asking]);

  if (!asking) {
    return (
      <Button
        variant={primary ? 'primary' : 'secondary'}
        className={danger && !primary ? 'hover:border-danger/60' : ''}
        onClick={() => setAsking(true)}
        disabled={disabled || pending}
      >
        {pending ? pendingLabel : label}
      </Button>
    );
  }
  return (
    <div
      role="group"
      data-testid="confirm"
      aria-labelledby={questionId}
      className="flex w-full animate-fade-in flex-col gap-2.5 rounded-control border border-line-strong bg-sunken px-3 py-2.5"
    >
      <p id={questionId}>{question}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={danger ? dangerButtonClass : buttonClass('primary')}
          disabled={pending}
          onClick={() => {
            void onConfirm().finally(() => setAsking(false));
          }}
        >
          {pending ? pendingLabel : confirmLabel}
        </button>
        <button
          type="button"
          ref={cancelRef}
          className={buttonClass('secondary')}
          onClick={() => setAsking(false)}
          disabled={pending}
        >
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}

/**
 * A failed action in plain words. A server refusal carries its own reason (e.g. why a merge was
 * refused), so that is shown too; the raw error stays under Technical details.
 */
export function ActionError({ error, message }: { error: ApiError | null; message: string }) {
  if (error === null) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <p role="alert" className={alertClass}>
        <AlertIcon size={16} className="mt-0.5 shrink-0" />
        <span className="min-w-0">
          {message}
          {error.kind === 'http' ? ` ${error.message}` : null}
        </span>
      </p>
      <Details>
        <ErrorNotice error={error} />
      </Details>
    </div>
  );
}

/** A labelled fact in a strip: "Status / Running". One cell of a hairline grid (`gap-px`). */
export function Fact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-36 flex-1 flex-col gap-1 bg-panel px-4 py-3">
      <dt className="text-caption text-dim">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** Sidebar icon for the control panel: a lead node with two branches. Same style as icons.tsx. */
export function ControlIcon({ size = 18, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <rect x="8.5" y="3" width="7" height="5" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
      <rect x="14" y="16" width="7" height="5" rx="1.5" />
      <path d="M12 8v4M6.5 16v-2a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
