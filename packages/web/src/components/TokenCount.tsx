import { formatCount } from '../lib/format';

/* Superseded by ./TokenValue (unit, "Not reported") and ./TokenBreakdown; kept until phase 2. */

export interface TokenCountProps {
  /** `null` means unavailable: the source did not report it. Never rendered as 0. */
  value: number | null;
  /** Records that lacked this category (`recordsWithUnavailable`). Above 0 means "partial". */
  unavailableRecords?: number;
  recordCount?: number;
  compact?: boolean;
}

export function TokenCount({
  value,
  unavailableRecords = 0,
  recordCount,
  compact = false,
}: TokenCountProps) {
  const of = recordCount === undefined ? '' : ` of ${formatCount(recordCount)}`;
  if (value === null) {
    return (
      <span
        className="text-unavailable italic"
        data-state="unavailable"
        title={`Unavailable: ${unavailableRecords > 0 ? `${formatCount(unavailableRecords)}${of} records` : 'the source'} did not report this category`}
      >
        unavailable
      </span>
    );
  }
  const full = formatCount(value);
  const shown = compact ? formatCount(value, 'compact') : full;
  if (unavailableRecords > 0) {
    return (
      <span
        className="tabular-nums"
        data-state="partial"
        title={`${full}: partial, ${formatCount(unavailableRecords)}${of} records did not report this category`}
      >
        {shown}{' '}
        <span className="rounded border border-dashed border-unavailable/50 px-0.5 text-[10px] text-unavailable italic">
          partial
        </span>
      </span>
    );
  }
  return (
    <span className="tabular-nums" data-state="available" title={full}>
      {shown}
    </span>
  );
}
