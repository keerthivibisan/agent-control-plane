import type { UsageTotalsDto } from '@acp/core/api';
import { StatCard } from '../../components/StatCard';
import { tokenText, TokenValue } from '../../components/TokenValue';
import { partialNote, TOKEN_TYPES, TOKENS_PAGE } from '../../lib/copy';
import { formatCount } from '../../lib/format';

/**
 * The four token types as four headline cards, side by side and never added together. The big
 * number is compact (12.4K); the exact count with its unit sits right under it. A type no record
 * reported reads "Not reported", and a type only some records reported carries the partial note.
 *
 * Each value is in `[data-category=<key>]` for tests.
 */
export function TokenStats({
  usage,
  label = TOKENS_PAGE.stats.label,
  testId,
}: {
  usage: UsageTotalsDto;
  label?: string;
  testId?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      data-testid={testId}
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      {TOKEN_TYPES.map((t) => {
        const value = usage.tokens[t.key];
        const missing = usage.recordsWithUnavailable[t.key];
        const exact =
          value !== null && formatCount(value, 'compact') !== formatCount(value)
            ? tokenText(value, t.key)
            : null;
        const partial =
          value === null
            ? TOKENS_PAGE.stats.notReportedNote
            : missing > 0
              ? `${TOKENS_PAGE.breakdown.partial}: ${partialNote(missing, usage.recordCount)}`
              : null;
        return (
          <StatCard
            key={t.key}
            label={t.label}
            tip={t.tip}
            testId={`stat-${t.key}`}
            value={
              <span data-category={t.key}>
                <TokenValue value={value} type={t.key} compact showUnit={false} />
              </span>
            }
            sublabel={
              exact || partial ? (
                <>
                  {exact ? <span className="block tabular-nums">{exact}</span> : null}
                  {partial ? (
                    <span className="block" data-partial={t.key}>
                      {partial}
                    </span>
                  ) : null}
                </>
              ) : undefined
            }
          />
        );
      })}
    </div>
  );
}
