import type { ReactNode } from 'react';
import type { WorkflowStageId } from '@acp/core';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Tooltip } from '../../components/Tooltip';
import type { ApiError } from '../../lib/api';
import { SKILLS_COPY } from '../../lib/copy';

const C = SKILLS_COPY;

export const fieldClass =
  'w-full rounded-control border border-line-strong bg-panel px-3 py-2 text-ink placeholder:text-dim/70 disabled:bg-sunken disabled:text-dim';

/** The amber "Uncommitted" badge, with a tip saying what it means and what to do. */
export function UncommittedBadge() {
  return (
    <Tooltip content={C.card.uncommittedTip}>
      <span
        data-testid="uncommitted-badge"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-warning-soft px-2 py-0.5 text-caption font-medium text-warning"
      >
        <span aria-hidden className="size-1.5 rounded-full bg-warning" />
        {C.card.uncommitted}
      </span>
    </Tooltip>
  );
}

/** "Used by" as stage chips, or a quiet line when no stage uses the skill. */
export function StageChips({ stages }: { stages: readonly WorkflowStageId[] }) {
  if (stages.length === 0) return <span className="text-dim">{C.card.notUsed}</span>;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={C.card.usedBy}>
      {stages.map((s) => (
        <li
          key={s}
          className="rounded-full border border-accent/30 bg-accent-soft px-2 py-px text-caption font-medium text-accent"
        >
          {C.stages[s]}
        </li>
      ))}
    </ul>
  );
}

export function ProblemList({ problems }: { problems: readonly string[] }) {
  if (problems.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-caption text-warning" data-testid="skill-problems">
      {problems.map((p) => (
        <li key={p} className="flex gap-1.5">
          <span aria-hidden>⚠</span>
          <span>{p}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A failed skills action: the server's typed refusal in plain words, then its own sentence. A
 * connection or contract failure is shown as the standard notice.
 */
export function RefusalNotice({ error }: { error: ApiError | null }) {
  if (error === null) return null;
  if (error.kind !== 'http' || error.code === null) return <ErrorNotice error={error} />;
  const friendly = C.refusals[error.code] ?? C.refusals['fallback'];
  return (
    <div
      role="alert"
      data-refusal={error.code}
      className="rounded-control border border-danger/40 bg-danger-soft px-3 py-2 text-danger"
    >
      <p className="font-medium">{friendly}</p>
      {error.message !== friendly ? <p className="mt-0.5 text-caption">{error.message}</p> : null}
    </div>
  );
}

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      {children}
      {hint ? (
        <span id={`${id}-hint`} className="text-caption text-dim">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={`${id}-error`} role="alert" className="text-caption text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function describedBy(id: string, hint: boolean, error: string | undefined) {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
}
