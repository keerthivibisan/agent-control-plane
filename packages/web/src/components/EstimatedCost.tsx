import type { UsageSnapshotDto } from '@acp/core/api';
import { formatUsd } from '../lib/format';
import { ProvenanceBadge } from './ProvenanceBadge';

/**
 * Provider-reported cost from a cumulative snapshot. Always estimated and never summed
 * (docs/usage-accounting.md §9). Missing cost says "cost unavailable", never $0.
 */
export function EstimatedCost({ cost }: { cost: UsageSnapshotDto['reportedCostUsd'] }) {
  if (cost.provenance === 'unavailable') {
    return (
      <span className="inline-flex items-center gap-1.5" data-testid="cost">
        <span className="text-unavailable italic">cost unavailable</span>
        <ProvenanceBadge provenance="unavailable" />
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5" data-testid="cost">
      <span className="font-mono text-estimated italic">~{formatUsd(cost.value)}</span>
      <ProvenanceBadge provenance="estimated" label="estimated (provider-reported)" />
    </span>
  );
}
