import { checkRunWasInterrupted, type CheckRunPlace } from '@acp/core';
import type { AgentRunDto, CheckRunDto } from '@acp/core/api';
import { Button } from '../../components/Button';
import { Details } from '../../components/Details';
import { InfoTip } from '../../components/InfoTip';
import { Badge } from '../../components/Pill';
import { RelativeTime } from '../../components/RelativeTime';
import { runAgentChecks } from '../../lib/api';
import {
  CHECK_STATUS_COPY,
  HARNESS_BLOCKS_COPY,
  TICKET_COPY,
  type ControlStatusCopy,
} from '../../lib/copy';
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
  passed: { sign: '✓', className: 'bg-success/15 text-success' },
  problem: { sign: '✗', className: 'bg-danger/15 text-danger' },
  stopped: QUIET,
  waiting: QUIET,
  working: QUIET,
};

/** A check outcome as mark + word (never color alone). */
export function CheckStatus({ check }: { check: Pick<CheckRunDto, 'status' | 'outputTail'> }) {
  // WG-F3: a row from before it that the app's shutdown stopped reads as stopped, not "Couldn't run".
  const status = checkRunWasInterrupted(check) ? 'interrupted' : check.status;
  const s = CHECK_STATUS_COPY[status];
  const m = MARK[s.tone];
  return (
    <span className="inline-flex items-center gap-1.5" data-check-status={status}>
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

/** One check run: its result, name, required or not, time and output (also the ticket branch). */
export function CheckRow({ check }: { check: CheckRunDto }) {
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

/**
 * Where a check ran (ADR-0027 §5). A row from before it has no place: it ran before the lead's
 * merge (the one block there was), so it reads as `merge`, as it always did.
 */
export function checkPlace(check: Pick<CheckRunDto, 'place'>): CheckRunPlace {
  return check.place ?? 'merge';
}

/** The places an agent's own checks can have, in the order the tab shows them. */
const AGENT_PLACES: readonly CheckRunPlace[] = ['change', 'merge'];

/**
 * Harness results for one helper agent (README §5.3 "Checks"), latest run of each check first.
 * With `place`, only the checks of that place (the ticket's Checks tab groups them by block);
 * without it, every place the agent has, each under its own heading when there is more than one.
 */
export function ChecksTab({
  runId,
  agent,
  checks,
  canRunAgain,
  place,
}: {
  runId: string;
  agent: AgentRunDto;
  checks: readonly CheckRunDto[];
  /** The agent's changes still wait for review. */
  canRunAgain: boolean;
  place?: CheckRunPlace;
}) {
  if (agent.kind === 'lead') return <p className="text-dim">{C.leadNone}</p>;
  if (!hasWorktree(agent.kind)) return <p className="text-dim">{C.readOnlyNone}</p>;
  if (place !== undefined) {
    return (
      <AgentChecks
        runId={runId}
        agent={agent}
        checks={checks.filter((c) => checkPlace(c) === place)}
        canRunAgain={canRunAgain}
      />
    );
  }
  const mine = checks.filter((c) => c.agentRunId === agent.id);
  const places = AGENT_PLACES.filter((p) => mine.some((c) => checkPlace(c) === p));
  if (places.length < 2) {
    return (
      <AgentChecks
        runId={runId}
        agent={agent}
        checks={checks}
        canRunAgain={canRunAgain && places[0] !== 'change'}
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {places.map((p) => (
        <section key={p} aria-label={HARNESS_BLOCKS_COPY.ticket.groups[p]} data-place={p}>
          <h3 className="mb-2 text-caption font-semibold text-dim">
            {HARNESS_BLOCKS_COPY.ticket.groups[p]}
          </h3>
          <AgentChecks
            runId={runId}
            agent={agent}
            checks={mine.filter((c) => checkPlace(c) === p)}
            // "Run checks again" re-runs the checks before the lead's merge.
            canRunAgain={canRunAgain && p === 'merge'}
          />
        </section>
      ))}
    </div>
  );
}

function AgentChecks({
  runId,
  agent,
  checks,
  canRunAgain,
}: {
  runId: string;
  agent: AgentRunDto;
  checks: readonly CheckRunDto[];
  canRunAgain: boolean;
}) {
  const again = useTicketAction(runAgentChecks);
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
