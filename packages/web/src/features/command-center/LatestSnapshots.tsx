import type { OverviewDto } from '@acp/core/api';
import { EstimatedCost } from '../../components/EstimatedCost';
import { Panel } from '../../components/Panel';
import { Time } from '../../components/Time';
import { shortId } from '../../lib/format';
import { href } from '../../lib/router';

/**
 * Each recent top-level session's latest provider-reported running total, one row per session.
 * Deliberately no total: snapshots have unverified scope and are never summed
 * (docs/usage-accounting.md §9). Cost is always styled as estimated, missing cost as unavailable.
 */
export function LatestSnapshots({ snapshots }: { snapshots: OverviewDto['latestSnapshots'] }) {
  return (
    <Panel title="Latest provider snapshots: cost estimated (provider-reported)">
      <p className="mb-2 text-[11px] text-dim">
        Each session&apos;s most recent provider-reported running total. Estimates of unverified
        scope, shown per session and never added together.
      </p>
      {snapshots.length === 0 ? (
        <p className="text-dim italic" data-testid="latest-snapshots-empty">
          No provider snapshot observed yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5" data-testid="latest-snapshots">
          {snapshots.map((s) => (
            <li
              key={s.sessionId}
              className="flex flex-wrap items-baseline gap-x-2"
              data-session={s.sessionId}
            >
              <a href={href.session(s.sessionId)} className="min-w-0 truncate">
                {s.title ?? <span className="font-mono">{shortId(s.sessionId)}</span>}
              </a>
              <span className="text-[11px] text-dim">
                as of <Time iso={s.occurredAt} fallback="(time unknown)" /> · scope{' '}
                <span className="font-mono">{s.scope}</span>
              </span>
              <span className="ml-auto">
                <EstimatedCost cost={s.reportedCostUsd} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
