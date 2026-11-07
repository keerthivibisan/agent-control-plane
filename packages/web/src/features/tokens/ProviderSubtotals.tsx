import {
  addUsageTotals,
  emptyUsageTotals,
  ManagedProviderIdSchema,
  tokenHeadline,
  type ProviderId,
  type UsageTotals,
} from '@acp/core';
import type { ProjectTokensDto } from '@acp/core/api';
import { InfoTip } from '../../components/InfoTip';
import { ProviderBadge } from '../../components/ProviderBadge';
import { NOT_REPORTED, TOKENS_COPY } from '../../lib/copy';
import { Figure, NEW_WORK_TYPES, TOTAL_TYPES } from './figures';

const P = TOKENS_COPY.breakdown.providers;

/** A row's provider; absent on rows from servers before the CX series. */
export type RowProvider = ProviderId | undefined;

const NEUTRAL =
  'inline-flex h-4 shrink-0 items-center rounded-full border border-line-strong px-1.5 text-micro leading-none font-medium whitespace-nowrap text-dim';

/**
 * The provider chip on a Tokens row. A managed provider reuses `ProviderBadge`; demo data and a
 * pre-CX row without a provider get a neutral chip, never a guessed "Claude".
 */
export function TokenProviderChip({ provider }: { provider: RowProvider }) {
  const managed = ManagedProviderIdSchema.safeParse(provider);
  if (managed.success) return <ProviderBadge provider={managed.data} />;
  const demo = provider === 'demo';
  return (
    <span
      className={NEUTRAL}
      title={demo ? P.demoTip : P.unknownTip}
      data-testid="provider-badge"
      data-provider={demo ? 'demo' : 'unknown'}
    >
      {demo ? P.demo : P.unknown}
    </span>
  );
}

interface Subtotal {
  provider: RowProvider;
  totals: UsageTotals;
  reportsCost: boolean;
}

/**
 * Tokens per provider, folded from the by-model rows: they partition every record by the
 * provider that reported it, so the subtotals add up to the page totals. Token counts are
 * null-preserving (`addUsageTotals`), never 0-filled.
 */
export function providerSubtotals(data: ProjectTokensDto): Subtotal[] {
  const out = new Map<RowProvider, Subtotal>();
  for (const m of data.byModel) {
    const prev = out.get(m.provider);
    const totals = addUsageTotals(prev?.totals ?? emptyUsageTotals(), m.usage);
    out.set(m.provider, { provider: m.provider, totals, reportsCost: false });
  }
  // A provider "reports cost" when one of its sessions carried a cost. The costs themselves stay
  // per session (ADR-0014) and are never added, here or across providers (ADR-0032 §6).
  for (const s of data.bySession) {
    const sub = out.get(s.provider);
    if (sub !== undefined && s.latestEstimatedCost?.provenance === 'estimated') {
      sub.reportsCost = true;
    }
  }
  return [...out.values()];
}

/**
 * A small line per provider: its chip, new work and total processed, and whether it reports a
 * cost. Shown only when the usage comes from more than one provider; with one, the tiles above
 * already say the same.
 */
export function ProviderSubtotals({ data }: { data: ProjectTokensDto }) {
  const subs = providerSubtotals(data);
  if (subs.length < 2) return null;
  return (
    <ul
      aria-label={P.label}
      className="mt-3 flex flex-wrap gap-x-6 gap-y-2"
      data-testid="provider-subtotals"
    >
      {subs.map((s) => {
        const usage = { ...s.totals, provenance: 'derived' as const };
        const headline = tokenHeadline(s.totals.tokens);
        return (
          <li
            key={s.provider ?? 'unknown'}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption"
            data-subtotal={s.provider ?? 'unknown'}
          >
            <TokenProviderChip provider={s.provider} />
            <span className="inline-flex items-center gap-1" data-figure="newWork">
              <Figure value={headline.newWork} usage={usage} types={NEW_WORK_TYPES} />
              <span className="text-dim">{P.newWork}</span>
            </span>
            <span className="inline-flex items-center gap-1" data-figure="total">
              <Figure value={headline.totalProcessed} usage={usage} types={TOTAL_TYPES} />
              <span className="text-dim">{P.total}</span>
            </span>
            <span className="inline-flex items-center gap-1 text-dim">
              {P.cost}:
              {s.reportsCost ? (
                <span data-testid="provider-cost" data-provenance="estimated">
                  {P.perSession}
                </span>
              ) : (
                <span
                  className="text-unavailable"
                  data-testid="provider-cost"
                  data-provenance="unavailable"
                >
                  {NOT_REPORTED}
                </span>
              )}
              <InfoTip tip={s.reportsCost ? P.perSessionTip : P.notReportedTip} label={P.cost} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
