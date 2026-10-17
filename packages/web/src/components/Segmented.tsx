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
  options: readonly { value: T; label: string }[];
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
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(o.value)}
              className={`rounded-[calc(var(--radius-control)-2px)] font-medium transition-colors ${
                size === 'sm' ? 'h-6 px-2 text-caption' : 'h-7 px-2.5'
              } ${
                on
                  ? 'bg-panel text-ink shadow-[0_0_0_1px_var(--color-line),0_1px_2px_rgb(0_0_0/0.06)]'
                  : 'text-dim hover:text-ink'
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
