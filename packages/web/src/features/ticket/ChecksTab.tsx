import type { AgentRunDto, CheckRunDto } from '@acp/core/api';
import { Button } from '../../components/Button';
import { Details } from '../../components/Details';
import { InfoTip } from '../../components/InfoTip';
import { Badge } from '../../components/Pill';
import { RelativeTime } from '../../components/RelativeTime';
import { runAgentChecks } from '../../lib/api';
import { CHECK_STATUS_COPY, TICKET_COPY, type ControlStatusCopy } from '../../lib/copy';
import { formatDuration } from '../../lib/format';
import { ActionError } from '../control/bits';
import { isAgentLive } from '../control/run-state';
import { useTicketAction } from './actions';
import { agentChecks, hasWorktree, mergeGate } from './ticket-state';

const C = TICKET_COPY.checks;

const QUIET = { sign: '–', className: 'bg-sunken text-dim' };

// Keyed by the shared check copy's tone (P4-F's `CHECK_STATUS_COPY`, so a result reads the same
// in project settings and on the ticket page): passed → ✓, failed and the like → ✗, else –.
const MARK: Record<ControlStatusCopy['tone'], { sign: string; className: string }> = {
  done: { sign: '✓', className: 'bg-success/15 text-success' },
  problem: { sign: '✗', className: 'bg-danger/15 text-danger' },
  stopped: QUIET,
  waiting: QUIET,
  working: QUIET,
};

/** A check outcome as mark + word (never color alone). */
export function CheckStatus({ check }: { check: Pick<CheckRunDto, 'status'> }) {
  const s = CHECK_STATUS_COPY[check.status];
  const m = MARK[s.tone];
  return (
    <span className="inline-flex items-center gap-1.5" data-check-status={check.status}>
      <span
        aria-hidden="true"
        className={`inline-flex size-[1.125rem] items-center justify-center rounded-full text-micro font-semibold ${m.className}`}
      >
        {m.sign}
      </span>
      <span className={s.tone === 'problem' ? 'font-medium text-danger' : ''}>{s.word}</span>
    </span>
  );
}

function CheckRow({ check }: { check: CheckRunDto }) {
  return (
    <li className="flex flex-col gap-2 px-3.5 py-2.5" data-testid={`check-${check.checkId}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <CheckStatus check={check} />
        <span className="font-medium">{check.name}</span>
        <Badge tone={check.required ? 'accent' : 'neutral'}>
          {check.required ? C.required : C.optional}
        </Badge>
        <span className="ml-auto text-caption text-dim tabular-nums">
          {C.duration(formatDuration(check.durationMs))} ·{' '}
          {check.exitCode === null ? C.noExitCode : C.exitCode(check.exitCode)}
        </span>
      </div>
      <Details summary={C.output} defaultOpen={check.required && check.status !== 'passed'}>
        {check.outputTail.length === 0 ? (
          <p className="text-dim">{C.noOutput}</p>
        ) : (
          <pre className="max-h-64 overflow-auto rounded-control border border-line bg-sunken p-2.5 font-mono text-caption leading-5 whitespace-pre-wrap">
            {check.outputTail}
          </pre>
        )}
        <p className="mt-2 text-caption text-dim">
          <RelativeTime iso={check.startedAt} />
        </p>
      </Details>
    </li>
  );
}

/** Harness results for one helper agent (README §5.3 "Checks"), latest run of each check first. */
export function ChecksTab({
  runId,
  agent,
  checks,
  canRunAgain,
}: {
  runId: string;
  agent: AgentRunDto;
  checks: readonly CheckRunDto[];
  /** The agent's changes still wait for review. */
  canRunAgain: boolean;
}) {
  const again = useTicketAction(runAgentChecks);
  if (agent.kind === 'lead') return <p className="text-dim">{C.leadNone}</p>;
  if (!hasWorktree(agent.kind)) return <p className="text-dim">{C.readOnlyNone}</p>;
  const { latest, earlier } = agentChecks(checks, agent.id);
  const gate = mergeGate(latest);
  return (
    <div className="flex flex-col gap-3" data-testid="checks">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="flex min-w-0 flex-1 items-center gap-1 text-dim">
          {gate.kind === 'no-checks' ? C.none : C.summary(gate.passed, gate.total)}
          <InfoTip tip={C.tip} label={C.title} />
        </p>
        {canRunAgain && !isAgentLive(agent.status) ? (
          <Button disabled={again.pending} onClick={() => void again.run(runId, agent.id)}>
            {again.pending ? C.running : C.runAgain}
          </Button>
        ) : null}
      </div>
      <ActionError error={again.error} message={C.runFailed} />
      {latest.length > 0 ? (
        <ul
          className="flex flex-col divide-y divide-line rounded-card border border-line"
          aria-label={C.title}
        >
          {latest.map((c) => (
            <CheckRow key={c.id} check={c} />
          ))}
        </ul>
      ) : null}
      {earlier.length > 0 ? (
        <Details summary={C.earlier(earlier.length)}>
          <ul className="flex flex-col gap-1.5 text-caption">
            {earlier.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3">
                <CheckStatus check={c} />
                <span>{c.name}</span>
                <span className="ml-auto text-dim">
                  <RelativeTime iso={c.startedAt} />
                </span>
              </li>
            ))}
          </ul>
        </Details>
      ) : null}
    </div>
  );
}
