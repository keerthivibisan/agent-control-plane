import type { AgentMessageMetaDto, AgentRunDto } from '@acp/core/api';
import { Details } from '../../components/Details';
import { Badge, type PillTone } from '../../components/Pill';
import { RelativeTime } from '../../components/RelativeTime';
import { OUTBOX_COPY } from '../../lib/copy';

const O = OUTBOX_COPY;

const STATE_TONE: Record<AgentMessageMetaDto['state'], PillTone> = {
  delivered: 'neutral',
  queued: 'accent',
  held: 'warning',
  dropped: 'danger',
};

/** Who sent or got a message: the agent's role, the app for an engine notice. */
function who(id: string, agents: readonly AgentRunDto[]): string {
  if (id === 'engine') return O.engine;
  return agents.find((a) => a.id === id)?.role ?? O.unknownAgent;
}

/**
 * ADR-0033 §7: the run's lead/agent messages, newest first, collapsed. Metadata only (when, who
 * to whom, kind, state, length): the text is never kept (ADR-0009), so none is shown. Nothing at
 * all when the server sends no outbox (before CX-5, or a run that isn't live).
 */
export function OutboxList({
  outbox,
  agents,
}: {
  outbox: readonly AgentMessageMetaDto[] | undefined;
  agents: readonly AgentRunDto[];
}) {
  if (outbox === undefined || outbox.length === 0) return null;
  const rows = [...outbox].reverse();
  return (
    <Details summary={O.title(outbox.length)} testId="outbox">
      <p className="mb-2 text-caption text-dim">{O.tip}</p>
      <ul className="flex flex-col divide-y divide-line" aria-label={O.label}>
        {rows.map((m) => (
          <li
            key={m.id}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-caption"
            data-testid="outbox-row"
            data-state={m.state}
            data-kind={m.kind}
          >
            <span className="text-dim">
              <RelativeTime iso={m.createdAt} />
            </span>
            <span className="min-w-0 truncate">
              {who(m.from, agents)} <span aria-hidden="true">{O.arrow}</span>
              <span className="sr-only">{O.to}</span> {who(m.to, agents)}
            </span>
            <span className="text-dim">{O.kind[m.kind]}</span>
            <Badge tone={STATE_TONE[m.state]} title={O.stateTip[m.state]}>
              {O.state[m.state]}
            </Badge>
            <span className="ml-auto text-dim tabular-nums">{O.length(m.length)}</span>
          </li>
        ))}
      </ul>
    </Details>
  );
}
