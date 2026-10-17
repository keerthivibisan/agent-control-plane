import type { HarnessStatusDto } from '@acp/core/api';
import { useMemo } from 'react';
import { Button } from '../../components/Button';
import { AlertIcon, CheckIcon } from '../../components/icons';
import { Badge } from '../../components/Pill';
import { RelativeTime } from '../../components/RelativeTime';
import { createHarnessTicket, isProjectSetupPath } from '../../lib/api';
import { SETUP_HARNESS_STATE_COPY, PROJECT_SETUP_COPY } from '../../lib/copy';
import { href } from '../../lib/router';
import { ActionError, StatusWord } from '../control/bits';
import { useSetupAction } from './actions';

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
        <div className="rounded-control border border-warning/25 bg-warning-soft px-3 py-2.5">
          <p className="flex items-center gap-2 font-medium text-warning">
            <AlertIcon size={16} className="shrink-0" />
            {H.problems}
          </p>
          <ul className="mt-1 list-disc pl-11 marker:text-dim">
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
      <h4 className="text-caption font-medium text-dim">{H.checks}</h4>
      {harness.checks.length === 0 ? (
        <p className="text-dim">{H.noChecks}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-control border border-line">
          {harness.checks.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
              <span className="font-medium">{c.name}</span>
              <Badge mono>{c.id}</Badge>
              <span className="ml-auto">
                <Badge
                  tone={c.required ? 'accent' : 'neutral'}
                  {...(c.required ? { title: H.requiredTip } : {})}
                >
                  {c.required ? H.required : H.optional}
                </Badge>
              </span>
              <code className="basis-full font-mono text-caption break-all text-ink">
                {c.argv.join(' ')}
              </code>
              <span className="text-caption text-dim">
                {c.cwd === undefined
                  ? H.timeLimit(c.timeoutSec)
                  : `${H.inFolder(c.cwd)} · ${H.timeLimit(c.timeoutSec)}`}
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
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-control border border-success/25 bg-success/10 px-3 py-2"
        >
          <CheckIcon size={16} className="shrink-0 text-success" />
          <span>
            <strong className="font-semibold">{H.ticketCreated(ticket.key)}</strong>{' '}
            <span className="text-dim">{H.ticketCreatedText}</span>
          </span>
          <a href={href.ticket(ticket)} className="ml-auto">
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
