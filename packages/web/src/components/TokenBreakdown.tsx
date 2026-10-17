import type { TokenCounts } from '@acp/core';
import type { UsageTotalsDto } from '@acp/core/api';
import { partialNote, TOKEN_TYPES } from '../lib/copy';
import { TOKEN_TYPE_COLOR } from '../lib/tokens';
import { InfoTip } from './InfoTip';
import { TokenValue } from './TokenValue';

function isTotals(u: UsageTotalsDto | TokenCounts): u is UsageTotalsDto {
  return 'tokens' in u;
}

/**
 * The four token types side by side, each with its label, tip and color swatch. They are priced
 * differently, so there is deliberately no summed total. A type no record reported reads "Not
 * reported"; one only some records reported gets a plain-words "partial" note.
 *
 * Each value sits in `dd[data-category=<key>]` for tests.
 */
export function TokenBreakdown({
  usage,
  compact = false,
  label = 'Tokens by type',
  testId,
}: {
  /** A usage total (enables partial notes) or bare token counts (e.g. one model in a snapshot). */
  usage: UsageTotalsDto | TokenCounts;
  /** Compact numbers (12.4K) with the exact value in a tooltip. */
  compact?: boolean;
  /** Accessible name of the list. */
  label?: string;
  testId?: string;
}) {
  const tokens = isTotals(usage) ? usage.tokens : usage;
  return (
    <dl
      aria-label={label}
      data-testid={testId}
      // As many columns as fit the card (four at most): a narrow card stacks, so labels stay whole.
      className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-x-6 gap-y-4"
    >
      {TOKEN_TYPES.map((t) => {
        const value = tokens[t.key];
        const missing = isTotals(usage) ? usage.recordsWithUnavailable[t.key] : 0;
        return (
          <div key={t.key} className="min-w-0">
            <dt className="flex items-center gap-1.5 text-dim">
              <span
                aria-hidden="true"
                className={`inline-block size-2 shrink-0 rounded-sm ${TOKEN_TYPE_COLOR[t.key].bg}`}
              />
              <span className="truncate">{t.label}</span>
              <InfoTip tip={t.tip} label={t.label} />
            </dt>
            <dd className="mt-0.5 text-title font-semibold" data-category={t.key}>
              <TokenValue value={value} type={t.key} compact={compact} showUnit={false} />
            </dd>
            {value !== null && missing > 0 && isTotals(usage) ? (
              <dd className="mt-0.5 text-caption text-dim" data-partial={t.key}>
                Partial: {partialNote(missing, usage.recordCount)}
              </dd>
            ) : null}
          </div>
        );
      })}
    </dl>
  );
}
