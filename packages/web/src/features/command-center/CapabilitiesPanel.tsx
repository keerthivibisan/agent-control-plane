import type { CapabilitiesDto } from '@acp/core/api';
import { Panel } from '../../components/Panel';
import { QueryView } from '../../components/QueryView';
import { paths, schemas } from '../../lib/api';
import { useApiQuery } from '../../lib/query';

const OBSERVATION_LABELS: Record<
  keyof CapabilitiesDto['providers'][number]['observation'],
  string
> = {
  transcripts: 'transcripts',
  lifecycleHooks: 'lifecycle hooks',
  subagentRelationships: 'subagent relationships',
  perTurnUsage: 'per-turn usage',
  cumulativeSnapshots: 'cumulative snapshots',
};

function Flag({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={`rounded border px-1 text-[11px] ${on ? 'border-emerald-600/40 text-emerald-700 dark:text-emerald-300' : 'border-dashed border-line text-dim line-through'}`}
      title={on ? `${label}: supported` : `${label}: not supported`}
    >
      {label}
    </span>
  );
}

/** What the server can observe, per provider, and whether hooks have ever delivered. */
export function CapabilitiesPanel() {
  const caps = useApiQuery(paths.capabilities(), schemas.capabilities);
  return (
    <Panel title="Observation capabilities">
      <QueryView query={caps}>
        {(c) => (
          <div className="flex flex-col gap-3">
            {c.providers.map((p) => (
              <div key={p.provider} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono font-semibold">{p.provider}</span>
                  {(Object.keys(OBSERVATION_LABELS) as (keyof typeof OBSERVATION_LABELS)[]).map(
                    (k) => (
                      <Flag key={k} on={p.observation[k]} label={OBSERVATION_LABELS[k]} />
                    ),
                  )}
                </div>
                <div className="text-[11px] text-dim">
                  versions seen:{' '}
                  {p.providerVersionsSeen.length > 0 ? (
                    <span className="font-mono">{p.providerVersionsSeen.join(', ')}</span>
                  ) : (
                    <span className="italic">none yet</span>
                  )}
                </div>
                {p.limitations.length > 0 ? (
                  <ul className="list-disc pl-5 text-[11px] text-dim">
                    {p.limitations.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
            {c.providers.length === 0 ? (
              <p className="text-dim italic">The server reports no providers.</p>
            ) : null}
            <HooksStatus hooks={c.hooks} />
          </div>
        )}
      </QueryView>
    </Panel>
  );
}

export function HooksStatus({ hooks }: { hooks: CapabilitiesDto['hooks'] }) {
  return (
    <div className="text-[11px] text-dim" data-testid="hooks-status">
      Hook receiver <code className="font-mono text-ink">{hooks.receiverUrl}</code>:{' '}
      {hooks.receivedAny ? (
        <span className="text-emerald-700 dark:text-emerald-300">deliveries received</span>
      ) : (
        <span>
          no authenticated delivery received yet. Hooks are opt-in: without them, end-of-session and
          needs-attention signals are not observable and sessions go <em>stale</em> instead of{' '}
          <em>ended</em>. Requests need the <code className="font-mono">X-ACP-Hook-Token</code>{' '}
          header from <code className="font-mono">&lt;ACP_DATA_DIR&gt;/hook-token</code>. This app
          never edits your Claude Code settings. While the server is stopped, Claude Code may show
          non-blocking hook errors.
        </span>
      )}
    </div>
  );
}
