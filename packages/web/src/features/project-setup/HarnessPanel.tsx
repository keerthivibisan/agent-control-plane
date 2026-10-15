import type { CheckRunDto, HarnessStatusDto } from '@acp/core/api';
import { useMemo } from 'react';
import { Button } from '../../components/Button';
import { Details } from '../../components/Details';
import { CheckIcon } from '../../components/icons';
import { RelativeTime } from '../../components/RelativeTime';
import { createHarnessTicket, isProjectSetupPath, runHarnessChecks } from '../../lib/api';
import { CHECK_STATUS_COPY, SETUP_HARNESS_STATE_COPY, PROJECT_SETUP_COPY } from '../../lib/copy';
import { formatDuration } from '../../lib/format';
import { ActionError, StatusWord } from '../control/bits';
import { useSetupAction } from './actions';
import { ticketHash } from './setup-form';

const H = PROJECT_SETUP_COPY.harness;

/** Harness status in words with its explanation, and the problems as a list of sentences. */
export function HarnessStatusView({ harness }: { harness: HarnessStatusDto }) {
  const copy = SETUP_HARNESS_STATE_COPY[harness.state];
  return (
    <div className="flex flex-col gap-3" data-testid="harness-status">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-dim">{H.status}</span>
        <span className="font-semibold">
          <StatusWord status={copy} value={harness.state} withTip={false} />
        </span>
        <span className="text-caption text-dim">
          {H.checkedAt} <RelativeTime iso={harness.checkedAt} />
        </span>
      </div>
      <p className="max-w-3xl">{copy.tip}</p>
      {harness.problems.length > 0 ? (
        <div className="rounded-control border border-warning/30 bg-warning-soft px-3 py-2">
          <p className="font-medium text-warning">{H.problems}</p>
          <ul className="mt-1 list-disc pl-5">
            {harness.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** The checks the harness lists: name, required or optional. */
export function HarnessCheckList({ harness }: { harness: HarnessStatusDto }) {
  if (harness.state === 'none') return null;
  return (
    <div className="flex flex-col gap-2">
      <h4 className="font-medium">{H.checks}</h4>
      {harness.checks.length === 0 ? (
        <p className="text-dim">{H.noChecks}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-control border border-line">
          {harness.checks.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <span className="font-medium">{c.name}</span>
              <code className="rounded bg-sunken px-1.5 py-0.5 font-mono text-caption text-dim">
                {c.id}
              </code>
              <span
                className={`ml-auto rounded-full px-2 py-0.5 text-caption font-medium ${
                  c.required ? 'bg-accent-soft text-accent' : 'bg-sunken text-dim'
                }`}
                title={c.required ? H.requiredTip : undefined}
              >
                {c.required ? H.required : H.optional}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-caption text-dim">{H.commandNote}</p>
    </div>
  );
}

/** "Create a 'Build the harness' ticket" and, once created, a link to it. */
export function HarnessTicketAction({
  projectId,
  prominent,
}: {
  projectId: string;
  /** The main action (no harness yet) rather than a secondary one. */
  prominent: boolean;
}) {
  const invalidate = useMemo(() => isProjectSetupPath(projectId), [projectId]);
  const action = useSetupAction(createHarnessTicket, invalidate);
  const ticket = action.result;
  return (
    <div className="flex flex-col gap-2" data-testid="harness-ticket">
      <p className="max-w-3xl text-dim">{H.ticketExplain}</p>
      {ticket ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-control border border-success/30 bg-success/10 px-3 py-2"
        >
          <CheckIcon size={16} className="shrink-0 text-success" />
          <span>
            <strong className="font-semibold">{H.ticketCreated(ticket.key)}</strong>{' '}
            <span className="text-dim">{H.ticketCreatedText}</span>
          </span>
          <a href={ticketHash(ticket.id)} className="ml-auto">
            {H.openTicket}
          </a>
        </div>
      ) : (
        <div>
          <Button
            variant={prominent ? 'primary' : 'secondary'}
            disabled={action.pending}
            onClick={() => void action.run(projectId)}
          >
            {action.pending ? H.creatingTicket : H.createTicket}
          </Button>
        </div>
      )}
      <ActionError error={action.error} message={H.ticketFailed} />
    </div>
  );
}

function CheckResult({ run }: { run: CheckRunDto }) {
  const copy = CHECK_STATUS_COPY[run.status];
  return (
    <li className="flex flex-col gap-1.5 px-3 py-2.5" data-check={run.checkId}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">{run.name}</span>
        <StatusWord status={copy} value={run.status} />
        <span className="text-caption text-dim">
          {run.required ? H.required : H.optional} · {H.duration(formatDuration(run.durationMs))}
        </span>
      </div>
      <Details summary={H.output}>
        <p className="mb-2 text-caption text-dim">{H.exitCode(run.exitCode)}</p>
        {run.outputTail.length > 0 ? (
          <pre className="max-h-72 overflow-auto rounded-control bg-sunken p-3 font-mono text-caption whitespace-pre-wrap">
            {run.outputTail}
          </pre>
        ) : (
          <p className="text-dim">{H.noOutput}</p>
        )}
      </Details>
    </li>
  );
}

/** "Run checks now" on the main branch (read-only) and the results of that run. */
export function RunChecksNow({
  projectId,
  harness,
}: {
  projectId: string;
  harness: HarnessStatusDto;
}) {
  const invalidate = useMemo(() => isProjectSetupPath(projectId), [projectId]);
  const action = useSetupAction(runHarnessChecks, invalidate);
  const runnable = harness.state === 'ready' || harness.state === 'partial';
  return (
    <div className="flex flex-col gap-2" data-testid="run-checks">
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!runnable || action.pending} onClick={() => void action.run(projectId)}>
          {action.pending ? H.runningChecks : H.runChecks}
        </Button>
        <span className="text-caption text-dim">
          {runnable ? H.runChecksHint : H.runChecksUnavailable}
        </span>
      </div>
      <ActionError error={action.error} message={H.runFailed} />
      {action.result ? (
        <div className="flex flex-col gap-1.5">
          <h4 className="font-medium">{H.results}</h4>
          {action.result.length === 0 ? (
            <p className="text-dim">{H.noResults}</p>
          ) : (
            <ul
              aria-label={H.results}
              className="flex flex-col divide-y divide-line rounded-control border border-line"
            >
              {action.result.map((r) => (
                <CheckResult key={r.id} run={r} />
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
