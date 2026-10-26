import type { TokenHeadlineDto, UsageTotalsDto } from '@acp/core/api';
import { Pill } from '../../components/Pill';
import { TokenValue } from '../../components/TokenValue';
import { NOT_REPORTED, TOKENS_COPY, formatShare } from '../../lib/copy';
import type { TokenCategory } from '../../lib/tokens';

/** The categories each headline figure adds up (docs/history/redesign/README.md §4.5). */
export const NEW_WORK_TYPES: readonly TokenCategory[] = ['input', 'output'];
export const TOTAL_TYPES: readonly TokenCategory[] = [
  'input',
  'output',
  'cacheCreation',
  'cacheRead',
];

/**
 * Records that lacked at least one of `types` (a lower bound: the DTO counts per type, so the
 * largest per-type count is the most we know for sure). 0 means the figure is complete.
 */
export function missingRecords(usage: UsageTotalsDto, types: readonly TokenCategory[]): number {
  return Math.max(0, ...types.map((t) => usage.recordsWithUnavailable[t]));
}

/**
 * "Partial" next to a figure that some records didn't fully report. Not shown when the figure is
 * unavailable altogether (it already reads "Not reported").
 */
export function PartialMark({
  usage,
  types,
  value,
}: {
  usage: UsageTotalsDto;
  types: readonly TokenCategory[];
  value: number | null;
}) {
  const missing = missingRecords(usage, types);
  if (value === null || missing === 0) return null;
  return (
    <span data-partial="true">
      <Pill dot={false} title={TOKENS_COPY.tiles.partialNote(missing, usage.recordCount)}>
        {TOKENS_COPY.tiles.partial}
      </Pill>
    </span>
  );
}

/** A token count with its unit, "Not reported" when null (never 0), with a "Partial" mark. */
export function Figure({
  value,
  usage,
  types,
  type,
  compact = true,
}: {
  value: number | null;
  usage: UsageTotalsDto;
  types: readonly TokenCategory[];
  /** For a single token type, names the unit. */
  type?: TokenCategory;
  compact?: boolean;
}) {
  return (
    <span className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap">
      <TokenValue value={value} compact={compact} showUnit={false} {...(type && { type })} />
      <PartialMark usage={usage} types={types} value={value} />
    </span>
  );
}

/** The cache reuse share as a percentage, or "Not reported" when it can't be derived. */
export function Share({ headline }: { headline: TokenHeadlineDto }) {
  if (headline.cacheReuseShare === null) {
    return (
      <span className="text-unavailable" data-state="unavailable">
        {NOT_REPORTED}
      </span>
    );
  }
  return (
    <span className="tabular-nums" data-state="available">
      {formatShare(headline.cacheReuseShare)}
    </span>
  );
}
