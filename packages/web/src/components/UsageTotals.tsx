import type { UsageTotalsDto } from '@acp/core/api';
import type { ReactNode } from 'react';
import { formatCount } from '../lib/format';
import { TOKEN_CATEGORIES } from '../lib/tokens';
import { ProvenanceBadge } from './ProvenanceBadge';
import { TokenCount } from './TokenCount';

/* Superseded by ./TokenBreakdown inside a ./Card; kept (restyled) until phase 2. */

/** Four token categories of one usage total, each with its own unavailable/partial state. */
export function UsageTotals({
  usage,
  title,
  description,
  note,
  testId,
}: {
  usage: UsageTotalsDto;
  title: string;
  description?: string;
  /** Extra caveat shown under the totals (e.g. ambiguous attribution). */
  note?: ReactNode;
  testId?: string;
}) {
  return (
    <section
      className="min-w-0 flex-1 rounded-card border border-line bg-panel p-4 shadow-card"
      aria-label={title}
      data-testid={testId}
    >
      <header className="mb-2 flex items-center gap-2">
        <h3 className="text-title font-semibold">{title}</h3>
        <ProvenanceBadge provenance={usage.provenance} />
        <span className="ml-auto text-[11px] text-dim">
          {formatCount(usage.recordCount)} usage record{usage.recordCount === 1 ? '' : 's'}
        </span>
      </header>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
        {TOKEN_CATEGORIES.map((c) => (
          <div key={c.key} className="min-w-0">
            <dt className="text-[11px] text-dim">{c.label}</dt>
            <dd className="font-mono text-sm" data-category={c.key}>
              <TokenCount
                value={usage.tokens[c.key]}
                unavailableRecords={usage.recordsWithUnavailable[c.key]}
                recordCount={usage.recordCount}
              />
            </dd>
          </div>
        ))}
      </dl>
      {description ? <p className="mt-2 text-[11px] text-dim">{description}</p> : null}
      {note}
    </section>
  );
}

/**
 * Fork copies share timestamps, so for some records the originating session can't be told apart
 * from a sibling fork. They are counted exactly once, here, but the attribution is a deterministic
 * tie-break, not evidence (usage-accounting §5.2, tie amendment).
 */
export function AmbiguousAttributionNote({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <p
      className="mt-1 text-[11px] text-estimated italic"
      data-testid="ambiguous-attribution"
      title="The earliest timestamp ties across sessions (fork copies), so the origin is unknown. Each record is still counted once."
    >
      {formatCount(count)} record{count === 1 ? '' : 's'} shared with a fork — attribution ambiguous
      (counted once)
    </p>
  );
}

/**
 * Direct and aggregate usage side by side. Aggregate already contains direct, so the two are never
 * added together or nested (docs/domain-model.md, usage aggregates).
 */
export function UsageComparison({
  direct,
  aggregate,
  ambiguousAttributionCount = 0,
}: {
  direct: UsageTotalsDto;
  aggregate: UsageTotalsDto;
  /** `SessionDetailDto.ambiguousAttributionCount`: shown next to direct usage when above 0. */
  ambiguousAttributionCount?: number;
}) {
  return (
    <div>
      <div className="flex flex-col gap-3 lg:flex-row">
        <UsageTotals
          usage={direct}
          title="Direct usage"
          description="Usage records attributed to this session only."
          note={<AmbiguousAttributionNote count={ambiguousAttributionCount} />}
          testId="usage-direct"
        />
        <UsageTotals
          usage={aggregate}
          title="Aggregate usage"
          description="This session plus its subagent descendants (subagent edges only)."
          testId="usage-aggregate"
        />
      </div>
      <p className="mt-1 text-[11px] text-dim">
        Aggregate already includes direct usage. The two are alternative views and must not be added
        together.
      </p>
    </div>
  );
}
