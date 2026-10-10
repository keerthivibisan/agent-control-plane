import type { ReportedCostUsdDto } from '@acp/core/api';
import { GLOSSARY, NOT_REPORTED } from '../lib/copy';
import { formatUsd } from '../lib/format';
import { InfoTip } from './InfoTip';

/**
 * Cost as Claude Code reported it: always labelled "Estimated cost" with its tip, never computed
 * here and never summed across sessions (docs/usage-accounting.md §9). No reported cost reads "Not
 * reported", never $0.
 */
export function EstimatedCost({
  cost,
  showLabel = true,
}: {
  cost: ReportedCostUsdDto;
  /** False where a column header already says "Estimated cost" (the tip stays). */
  showLabel?: boolean;
}) {
  const { term, tip } = GLOSSARY.estimatedCost;
  return (
    <span
      className="inline-flex flex-wrap items-center gap-x-1.5"
      data-testid="cost"
      data-provenance={cost.provenance}
    >
      {showLabel ? <span className="text-dim">{term}</span> : null}
      {cost.provenance === 'unavailable' ? (
        <span className="text-unavailable">{NOT_REPORTED}</span>
      ) : (
        <span className="font-medium tabular-nums">~{formatUsd(cost.value)}</span>
      )}
      <InfoTip tip={tip} label={term} />
    </span>
  );
}
