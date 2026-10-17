import type { Provenance } from '@acp/core';

const STYLES: Record<Provenance, string> = {
  observed: 'border-observed/35 text-observed',
  derived: 'border-derived/35 text-derived',
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
      className={`inline-flex items-center rounded-[0.25rem] border px-1 text-micro leading-4 font-medium tracking-wide uppercase ${STYLES[provenance]}`}
      title={TITLES[provenance]}
      data-provenance={provenance}
    >
      {label ?? provenance}
    </span>
  );
}
