import { useId, type ReactNode } from 'react';
import { CheckIcon } from '../../components/icons';
import { InfoTip } from '../../components/InfoTip';

/**
 * Form pieces for the wizard and the settings page: a label, a plain-language hint, and an error
 * sentence wired to the control with aria-describedby (same look as the Setup page's form).
 */

export const inputClass =
  'w-full rounded-control border bg-panel px-3 py-2 text-ink placeholder:text-dim/70';

function describedBy(hintId: string, errorId: string, error: string | undefined) {
  return error ? `${hintId} ${errorId}` : hintId;
}

function FieldError({ id, error }: { id: string; error: string | undefined }) {
  if (!error) return null;
  return (
    <span id={id} role="alert" className="text-caption text-danger" data-field-error>
      {error}
    </span>
  );
}

export function TextField({
  label,
  hint,
  error,
  value,
  onChange,
  placeholder,
  mono = false,
  numeric = false,
  tip,
  className = '',
  inputClassName = '',
}: {
  label: string;
  hint: ReactNode;
  error?: string | undefined;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  numeric?: boolean;
  tip?: string;
  className?: string;
  inputClassName?: string;
}) {
  const id = useId();
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <span className="flex items-center gap-1">
        <label htmlFor={id} className="font-medium">
          {label}
        </label>
        {tip ? <InfoTip tip={tip} label={label} /> : null}
      </span>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={numeric ? 'numeric' : undefined}
        spellCheck={mono ? false : undefined}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(`${id}-hint`, `${id}-error`, error)}
        className={`${inputClass} ${error ? 'border-danger' : 'border-line-strong'} ${
          mono ? 'font-mono' : ''
        } ${numeric ? 'tabular-nums' : ''} ${inputClassName}`}
      />
      <span id={`${id}-hint`} className="text-caption text-dim">
        {hint}
      </span>
      <FieldError id={`${id}-error`} error={error} />
    </div>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  label: string;
  hint: ReactNode;
  error?: string | undefined;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(`${id}-hint`, `${id}-error`, error)}
        className={`${inputClass} resize-y font-mono ${error ? 'border-danger' : 'border-line-strong'}`}
      />
      <span id={`${id}-hint`} className="text-caption text-dim">
        {hint}
      </span>
      <FieldError id={`${id}-error`} error={error} />
    </div>
  );
}

/**
 * A group of choices shown as selectable cards (native radios, so arrow keys move between them).
 * `columns` lays them out side by side on wide screens.
 */
export function ChoiceCards<V extends string | number>({
  legend,
  hint,
  name,
  value,
  options,
  onChange,
  columns = 2,
}: {
  legend: string;
  hint?: ReactNode;
  name: string;
  value: V;
  options: readonly { value: V; label: string; hint: string }[];
  onChange: (v: V) => void;
  columns?: 2 | 3;
}) {
  const hintId = useId();
  return (
    <fieldset className="flex min-w-0 flex-col gap-2" aria-describedby={hint ? hintId : undefined}>
      <legend className="mb-1 font-medium">{legend}</legend>
      <div className={`grid gap-2 ${columns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
        {options.map((o) => {
          const checked = o.value === value;
          return (
            <label
              key={String(o.value)}
              className={`flex cursor-pointer items-start gap-3 rounded-control border px-3 py-2.5 transition-colors ${
                checked
                  ? 'border-accent bg-accent-soft/60'
                  : 'border-line-strong bg-panel hover:bg-sunken'
              }`}
            >
              <input
                type="radio"
                name={name}
                checked={checked}
                onChange={() => onChange(o.value)}
                className="mt-1 size-4 shrink-0 accent-accent"
              />
              <span className="flex min-w-0 flex-col">
                <span className="font-medium">{o.label}</span>
                <span className="text-caption text-dim">{o.hint}</span>
              </span>
            </label>
          );
        })}
      </div>
      {hint ? (
        <span id={hintId} className="text-caption text-dim">
          {hint}
        </span>
      ) : null}
    </fieldset>
  );
}

/** A number picked from a short row of buttons (radios underneath), e.g. 1 to 6 helpers. */
export function NumberChoice({
  legend,
  hint,
  name,
  value,
  choices,
  onChange,
  valueText,
}: {
  legend: string;
  hint: ReactNode;
  name: string;
  value: number;
  choices: readonly number[];
  onChange: (n: number) => void;
  /** Read out with the selected value, e.g. "3 helpers". */
  valueText: (n: number) => string;
}) {
  const hintId = useId();
  return (
    <fieldset className="flex min-w-0 flex-col gap-1" aria-describedby={hintId}>
      <legend className="mb-1 font-medium">{legend}</legend>
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex overflow-hidden rounded-control border border-line-strong">
          {choices.map((n) => {
            const checked = n === value;
            return (
              <label
                key={n}
                className={`relative flex min-w-10 cursor-pointer items-center justify-center border-line-strong px-3 py-1.5 tabular-nums not-first:border-l has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-accent ${
                  checked ? 'bg-accent font-semibold text-accent-ink' : 'bg-panel hover:bg-sunken'
                }`}
              >
                <input
                  type="radio"
                  name={name}
                  checked={checked}
                  onChange={() => onChange(n)}
                  aria-label={valueText(n)}
                  className="sr-only"
                />
                {n}
              </label>
            );
          })}
        </div>
        <span className="text-dim">{valueText(value)}</span>
      </div>
      <span id={hintId} className="text-caption text-dim">
        {hint}
      </span>
    </fieldset>
  );
}

/** A yes/no setting as a checkbox with a sentence for a label and a hint underneath. */
export function CheckboxField({
  label,
  hint,
  checked,
  onChange,
  note,
}: {
  label: string;
  hint: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  /** An extra line, e.g. why the setting has no effect yet. */
  note?: ReactNode;
}) {
  const id = useId();
  return (
    <div
      className={`flex items-start gap-3 rounded-control border px-3 py-3 transition-colors ${
        checked ? 'border-accent/60 bg-accent-soft/40' : 'border-line bg-panel'
      }`}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={`${id}-hint`}
        className="mt-1 size-4 shrink-0 accent-accent"
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={id} className="cursor-pointer font-medium">
          {label}
        </label>
        <span id={`${id}-hint`} className="text-caption text-dim">
          {hint}
          {note ? (
            <>
              {' '}
              <span className="text-warning">{note}</span>
            </>
          ) : null}
        </span>
      </div>
    </div>
  );
}

/** A fixed setting shown read-only: "Plan first: On ✓". */
export function FixedSetting({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="font-medium">{label}</span>
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-sunken px-2.5 py-0.5 text-caption font-medium">
        <CheckIcon size={14} className="text-success" />
        {value}
      </span>
      <span className="text-caption text-dim">{hint}</span>
    </div>
  );
}

/** A titled group inside a card: a small heading, an optional sentence, then the fields. */
export function FormSection({
  title,
  description,
  children,
  testId,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} data-testid={testId} className="flex min-w-0 flex-col gap-4">
      <div>
        <h3 id={id} className="font-semibold">
          {title}
        </h3>
        {description ? <p className="mt-0.5 text-dim">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
