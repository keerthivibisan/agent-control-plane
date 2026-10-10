import type { UsageTotalsDto } from '@acp/core/api';
import { formatCount } from '../lib/format';
import { TOKEN_CATEGORIES } from '../lib/tokens';
import { ProvenanceBadge } from './ProvenanceBadge';
import { TokenCount } from './TokenCount';

/** Four token categories of one usage total, each with its own unavailable/partial state. */
export function UsageTotals({
  usage,
  title,
  description,
  testId,
}: {
  usage: UsageTotalsDto;
  title: string;
  description?: string;
  testId?: string;
}) {
  return (
    <section
      className="min-w-0 flex-1 rounded border border-line bg-panel p-3"
      aria-label={title}
      data-testid={testId}
    >
      <header className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-dim uppercase">{title}</h3>
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
    </section>
  );
}

/**
 * Direct and aggregate usage side by side. Aggregate already contains direct, so the two are never
 * added together or nested (docs/domain-model.md, usage aggregates).
 */
export function UsageComparison({
  direct,
  aggregate,
}: {
  direct: UsageTotalsDto;
  aggregate: UsageTotalsDto;
}) {
  return (
    <div>
      <div className="flex flex-col gap-3 lg:flex-row">
        <UsageTotals
          usage={direct}
          title="Direct usage"
          description="Usage records attributed to this session only."
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
