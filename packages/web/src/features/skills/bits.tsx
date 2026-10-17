import type { ReactNode } from 'react';
import type { WorkflowStageId } from '@acp/core';
import { ErrorNotice } from '../../components/ErrorNotice';
import { AlertIcon, CheckIcon } from '../../components/icons';
import { Tooltip } from '../../components/Tooltip';
import type { ApiError } from '../../lib/api';
import { SKILLS_COPY } from '../../lib/copy';
import { CommitIcon } from '../workflow/icons';

const C = SKILLS_COPY;

/** The amber "Uncommitted" badge, with a tip saying what it means and what to do. */
export function UncommittedBadge() {
  return (
    // Above a card's full-size open link, so the tip opens on hover and focus there too.
    <Tooltip content={C.card.uncommittedTip} className="relative z-10 inline-flex shrink-0">
      <span
        data-testid="uncommitted-badge"
        className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border border-warning/25 bg-warning-soft px-2 text-caption font-medium whitespace-nowrap text-warning"
      >
        <span aria-hidden className="size-1.5 rounded-full bg-warning" />
        {C.card.uncommitted}
      </span>
    </Tooltip>
  );
}

/** A stage tag: squarer than a status pill, because it names a thing (DESIGN.md, "Pills"). */
const CHIP =
  'inline-flex h-5 items-center rounded-[0.3125rem] border border-accent/20 bg-accent-soft px-1.5 text-caption font-medium whitespace-nowrap text-accent';

/**
 * "Used by" as stage chips, or a quiet line when no stage uses the file. With `link` (R-I), each
 * chip is a link to the Workflow page, where the mapping is changed.
 */
export function StageChips({
  stages,
  link,
  linkLabel,
}: {
  stages: readonly WorkflowStageId[];
  link?: string | undefined;
  linkLabel?: ((stage: string) => string) | undefined;
}) {
  if (stages.length === 0) return <span className="text-caption text-dim">{C.card.notUsed}</span>;
  return (
    <ul className="flex flex-wrap gap-1" aria-label={C.card.usedBy}>
      {stages.map((s) =>
        link === undefined ? (
          <li key={s} className={CHIP}>
            {C.stages[s]}
          </li>
        ) : (
          <li key={s}>
            <a
              href={link}
              aria-label={linkLabel?.(C.stages[s])}
              className={`${CHIP} relative z-10 no-underline transition-colors hover:border-accent/50`}
            >
              {C.stages[s]}
            </a>
          </li>
        ),
      )}
    </ul>
  );
}

/**
 * One skill or agent file on its list: an icon tile, the name (its button covers the whole card,
 * DESIGN.md "Card"), when to use it, the git state, the rows the caller adds, and the last commit.
 * Links and tips inside sit above the cover (`relative z-10`).
 */
export function FileCard({
  testId,
  icon,
  name,
  openLabel,
  onOpen,
  description,
  badge,
  children,
  footer,
  index,
}: {
  testId: string;
  icon: ReactNode;
  name: string;
  openLabel: string;
  onOpen: () => void;
  description: string;
  badge?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  /** Its place in the list: the cards arrive one after another (the first eight, 25ms apart). */
  index: number;
}) {
  return (
    <li
      data-testid={testId}
      // A CSS animation (index.css): reduced motion stops it, and it needs no animation library.
      style={{ animationDelay: `${Math.min(index, 8) * 25}ms` }}
      className="relative flex min-w-0 animate-dialog-in flex-col gap-3.5 rounded-card border border-line bg-panel p-4 shadow-card transition-[border-color,box-shadow] duration-150 [animation-fill-mode:backwards] hover:border-line-strong hover:shadow-raised"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-control border border-line bg-sunken text-accent"
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-mono text-[0.8125rem] leading-5 font-semibold">
            <button
              type="button"
              onClick={onOpen}
              aria-label={openLabel}
              className="rounded-[0.25rem] text-left transition-colors after:absolute after:inset-0 after:rounded-card hover:text-accent"
            >
              {name}
            </button>
          </h2>
          <p
            className={`mt-0.5 line-clamp-2 text-caption leading-[1.125rem] ${
              description === '' ? 'text-dim italic' : 'text-dim'
            }`}
          >
            {description === '' ? C.card.noDescription : description}
          </p>
        </div>
        {badge}
      </div>
      {children}
      <p className="mt-auto flex items-center gap-1.5 border-t border-line pt-3 text-caption text-dim">
        <CommitIcon size={13} className="shrink-0" />
        <span>{footer}</span>
      </p>
    </li>
  );
}

/** A list of `FileCard`s: a responsive grid. */
export function FileGrid({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3" aria-label={label}>
      {children}
    </ul>
  );
}

/** A label and its value on a card ("Tools", "Model", "Used by"). */
export function CardRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="pt-0.5 text-caption text-dim">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

/** "Unsaved changes" next to an editor's title, with a small amber dot. */
export function UnsavedNote({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-caption text-dim">
      <span aria-hidden className="size-1.5 rounded-full bg-warning" />
      {children}
    </span>
  );
}

/** The editor's "Saved to your working tree" line. */
export function SavedNote({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="flex items-start gap-1.5 text-success">
      <CheckIcon size={15} className="mt-0.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** Cancel and Save under an editor's fields, on a hairline. */
export const FORM_ACTIONS = '-mx-5 flex flex-wrap justify-end gap-2 border-t border-line px-5 pt-4';

export function ProblemList({ problems }: { problems: readonly string[] }) {
  if (problems.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-caption text-warning" data-testid="skill-problems">
      {problems.map((p) => (
        <li key={p} className="flex items-start gap-1.5">
          <AlertIcon size={13} className="mt-0.5 shrink-0" />
          <span className="min-w-0">{p}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A failed skills action: the server's typed refusal in plain words, then its own sentence. A
 * connection or contract failure is shown as the standard notice.
 */
export function RefusalNotice({
  error,
  refusals,
}: {
  error: ApiError | null;
  /** Words for this kind of file, over the skills defaults. */
  refusals?: Readonly<Record<string, string>> | undefined;
}) {
  if (error === null) return null;
  if (error.kind !== 'http' || error.code === null) return <ErrorNotice error={error} />;
  const friendly = refusals?.[error.code] ?? C.refusals[error.code] ?? C.refusals['fallback'];
  return (
    <div
      role="alert"
      data-refusal={error.code}
      className="flex items-start gap-2 rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-danger"
    >
      <AlertIcon size={15} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="font-medium">{friendly}</p>
        {error.message !== friendly ? <p className="mt-0.5 text-caption">{error.message}</p> : null}
      </div>
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
    <div className="flex min-w-0 flex-col gap-1.5">
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
