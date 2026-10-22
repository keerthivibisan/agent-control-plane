import { useId } from 'react';

/**
 * A row of toggle buttons for a small set of choices (a range, a view); the chosen one is
 * `aria-pressed`. A labelled `group`, so the label names the choice. Same API as the Tokens page's
 * own copy, so features can switch over.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  hideLabel = false,
  size = 'md',
}: {
  label: string;
  /**
   * `disabled` with a `reason`: the choice can't be made here. It stays focusable (aria-disabled,
   * not disabled) so the reason, its tooltip and description, can be read.
   */
  options: readonly { value: T; label: string; disabled?: boolean; reason?: string }[];
  value: T;
  onChange: (v: T) => void;
  /** The label stays as the group's accessible name only. */
  hideLabel?: boolean;
  size?: 'md' | 'sm';
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <span id={id} className={hideLabel ? 'sr-only' : 'text-caption font-medium text-dim'}>
        {label}
      </span>
      <div
        role="group"
        aria-labelledby={id}
        className="inline-flex w-fit flex-wrap gap-0.5 rounded-control border border-line bg-sunken p-0.5"
      >
        {options.map((o) => {
          const on = o.value === value;
          const off = o.disabled === true;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              aria-disabled={off ? true : undefined}
              title={off ? o.reason : undefined}
              aria-describedby={off && o.reason !== undefined ? `${id}-${o.value}` : undefined}
              onClick={() => {
                if (!off) onChange(o.value);
              }}
              className={`rounded-[calc(var(--radius-control)-2px)] font-medium transition-colors ${
                size === 'sm' ? 'h-6 px-2 text-caption' : 'h-7 px-2.5'
              } ${
                on
                  ? 'bg-panel text-ink shadow-[0_0_0_1px_var(--color-line),0_1px_2px_rgb(0_0_0/0.06)]'
                  : off
                    ? 'cursor-not-allowed text-dim opacity-50'
                    : 'text-dim hover:text-ink'
              }`}
            >
              {o.label}
            </button>
          );
        })}
        {options.map((o) =>
          o.disabled === true && o.reason !== undefined ? (
            <span key={o.value} id={`${id}-${o.value}`} className="sr-only">
              {o.reason}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}
