import { useId, type ReactNode } from 'react';
import { CheckIcon } from '../../components/icons';
import { InfoTip } from '../../components/InfoTip';
import { hintClass, inputClass, labelClass } from '../../components/Input';

/**
 * Form pieces for the wizard and the settings page: a label, a plain-language hint, and an error
 * sentence wired to the control with aria-describedby. The field look is the shared one
 * (components/Input), which also turns the border red for `aria-invalid`.
 */

function describedBy(hintId: string, errorId: string, error: string | undefined) {
  return error ? `${hintId} ${errorId}` : hintId;
}

function FieldError({ id, error }: { id: string; error: string | undefined }) {
  if (!error) return null;
  return (
    <span id={id} role="alert" className="text-caption font-medium text-danger" data-field-error>
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
  readOnly = false,
  action,
}: {
  label: string;
  hint: ReactNode;
  error?: string | undefined;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string | undefined;
  mono?: boolean;
  numeric?: boolean;
  tip?: string;
  className?: string;
  inputClassName?: string;
  /** A control level with the input box, e.g. a Save button; the hint and error stay below. */
  action?: ReactNode;
  /** Shown but fixed (a preset's value); still read and focusable. */
  readOnly?: boolean;
}) {
  const id = useId();
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <span className="flex items-center gap-1">
        <label htmlFor={id} className={labelClass}>
          {label}
        </label>
        {tip ? <InfoTip tip={tip} label={label} /> : null}
      </span>
      {/* The action sits beside the input box only, so it stays level with it however much hint
          or error text follows. */}
      <div className="flex items-center gap-2">
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          readOnly={readOnly}
          inputMode={numeric ? 'numeric' : undefined}
          spellCheck={mono ? false : undefined}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(`${id}-hint`, `${id}-error`, error)}
          className={inputClass(
            `${mono ? 'font-mono' : ''} ${numeric ? 'tabular-nums' : ''} ${readOnly ? 'read-only:bg-sunken read-only:text-dim' : ''} ${inputClassName}`,
          )}
        />
        {action}
      </div>
      <span id={`${id}-hint`} className={hintClass}>
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
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className={labelClass}>
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
        className={inputClass('resize-y font-mono')}
      />
      <span id={`${id}-hint`} className={hintClass}>
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
  /** 1 stacks them, for a narrow panel (the Workflow page's stage settings). */
  columns?: 1 | 2 | 3;
}) {
  const hintId = useId();
  return (
    <fieldset className="flex min-w-0 flex-col gap-2" aria-describedby={hint ? hintId : undefined}>
      <legend className={`mb-1.5 ${labelClass}`}>{legend}</legend>
      <div
        className={`grid gap-2 ${columns === 1 ? '' : columns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}
      >
        {options.map((o) => {
          const checked = o.value === value;
          return (
            <label
              key={String(o.value)}
              className={`flex cursor-pointer items-start gap-3 rounded-control border px-3 py-2.5 transition-[background-color,border-color,box-shadow] duration-150 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent ${
                checked
                  ? 'border-accent bg-accent-soft/60 shadow-[0_0_0_1px_var(--color-accent)]'
                  : 'border-line-strong bg-panel hover:bg-hover'
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
        <span id={hintId} className={hintClass}>
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
    <fieldset className="flex min-w-0 flex-col gap-1.5" aria-describedby={hintId}>
      <legend className={`mb-1.5 ${labelClass}`}>{legend}</legend>
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex overflow-hidden rounded-control border border-line-strong shadow-card">
          {choices.map((n) => {
            const checked = n === value;
            return (
              <label
                key={n}
                className={`relative flex h-8 min-w-10 cursor-pointer items-center justify-center border-line-strong px-3 tabular-nums transition-colors not-first:border-l has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-accent ${
                  checked
                    ? 'bg-accent-fill font-semibold text-accent-fill-ink'
                    : 'bg-panel text-ink hover:bg-hover'
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
      <span id={hintId} className={hintClass}>
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
        checked ? 'border-accent/50 bg-accent-soft/40' : 'border-line-strong bg-panel'
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
        <span id={`${id}-hint`} className={hintClass}>
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
export function FixedSetting({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className={labelClass}>{label}</span>
      <span className="inline-flex h-6 w-fit items-center gap-1.5 rounded-full border border-line bg-sunken px-2.5 text-caption font-medium">
        <CheckIcon size={14} className="text-success" />
        {value}
      </span>
      <span className={hintClass}>{hint}</span>
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
        <h3 id={id} className="text-title font-semibold">
          {title}
        </h3>
        {description ? <p className="mt-0.5 text-dim">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
