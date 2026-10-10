import type { Provenance } from '@acp/core';

const STYLES: Record<Provenance, string> = {
  observed: 'border-emerald-600/40 text-emerald-700 dark:text-emerald-300',
  derived: 'border-sky-600/40 text-sky-700 dark:text-sky-300',
  // Estimated values must never look authoritative: italic, dashed, warm.
  estimated: 'border-dashed border-estimated/60 bg-estimated-bg italic text-estimated',
  unavailable: 'border-dashed border-unavailable/50 text-unavailable',
};

const TITLES: Record<Provenance, string> = {
  observed: 'Observed: read directly from a provider record',
  derived: 'Derived: computed deterministically from observed values',
  estimated: 'Estimated: inferred or provider-reported; not authoritative',
  unavailable: 'Unavailable: the source does not expose this value',
};

/** Where a value came from (ADR-0007). */
export function ProvenanceBadge({ provenance, label }: { provenance: Provenance; label?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1 text-[10px] leading-4 font-medium tracking-wide uppercase ${STYLES[provenance]}`}
      title={TITLES[provenance]}
      data-provenance={provenance}
    >
      {label ?? provenance}
    </span>
  );
}
