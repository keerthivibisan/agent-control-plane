import { useId } from 'react';

/** A row of toggle buttons for a small set of choices; the chosen one is `aria-pressed`. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  hideLabel = false,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  /** The label stays as the group's accessible name only. */
  hideLabel?: boolean;
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
              className={`rounded-[0.375rem] px-3 py-1 transition-colors ${
                on ? 'bg-panel font-medium text-ink shadow-card' : 'text-dim hover:text-ink'
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
