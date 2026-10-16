import type { HarnessStatusDto, TicketDto } from '@acp/core/api';
import { Button, ButtonLink } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { HarnessIcon } from '../../components/icons';
import { InfoTip } from '../../components/InfoTip';
import { Pill } from '../../components/Pill';
import { RelativeTime } from '../../components/RelativeTime';
import type { ApiError } from '../../lib/api';
import { HARNESS_PAGE_COPY, TICKET_STAGE_COPY } from '../../lib/copy';
import { href } from '../../lib/router';
import { ActionError, StatusWord } from '../control/bits';
import { HARNESS_TONE } from './logic';

const C = HARNESS_PAGE_COPY.status;
const B = HARNESS_PAGE_COPY.build;

/** Soft, tone-colored frame for the status icon. Color is never the only signal: the word is next to it. */
const ICON_FRAME: Record<HarnessStatusDto['state'], string> = {
  ready: 'border-success/25 bg-success/10 text-success',
  partial: 'border-warning/30 bg-warning-soft text-warning',
  invalid: 'border-danger/30 bg-danger-soft text-danger',
  none: 'border-line bg-sunken text-dim',
};

export type HarnessTicketView = Pick<TicketDto, 'id' | 'projectId' | 'key' | 'title' | 'stage'>;

export interface BuildAction {
  pending: boolean;
  error: ApiError | null;
  run: () => void;
}

/** "Read from the repository 3 min ago ⓘ  [Check again]". */
function ReadAt({
  harness,
  refreshing,
  onRefresh,
}: {
  harness: HarnessStatusDto;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-dim">
      <span>
        {C.readAt} <RelativeTime iso={harness.checkedAt} />
      </span>
      <InfoTip tip={C.cacheTip} label={C.readAt} />
      <Button size="sm" variant="quiet" disabled={refreshing} onClick={onRefresh}>
        {refreshing ? C.refreshing : C.refresh}
      </Button>
    </div>
  );
}

/** The project's "Build the harness" ticket with its board stage, and why it runs no checks. */
function HarnessTicket({ ticket, created }: { ticket: HarnessTicketView; created: boolean }) {
  const stage = TICKET_STAGE_COPY[ticket.stage];
  const working = ticket.stage !== 'DONE';
  return (
    <div
      data-testid="harness-ticket"
      data-stage={ticket.stage}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-control border border-line bg-sunken/60 px-4 py-3"
    >
      <span className="text-caption text-dim">{B.ticket}</span>
      <a href={href.ticket(ticket)} className="min-w-0 font-medium">
        <span className="mr-2 font-mono text-caption text-dim">{ticket.key}</span>
        {ticket.title}
      </a>
      <StatusWord status={stage} value={ticket.stage} />
      <span className="inline-flex items-center gap-1 text-caption text-dim">
        <InfoTip tip={B.noChecksTip} label={`${B.ticket} checks`} />
        {working ? <InfoTip tip={B.newFolderTip} label={`${B.ticket} questions`} /> : null}
      </span>
      <ButtonLink href={href.ticket(ticket)} size="sm" className="ml-auto">
        {B.open}
      </ButtonLink>
      {created ? (
        <p role="status" className="basis-full text-caption text-success">
          {B.created(ticket.key)}
        </p>
      ) : null}
    </div>
  );
}

function BuildButton({ build }: { build: BuildAction }) {
  return (
    <Button variant="primary" disabled={build.pending} onClick={build.run}>
      {build.pending ? B.creating : B.create}
    </Button>
  );
}

/**
 * The harness state in a word and one sentence, the problems as plain sentences, and the
 * "Build the harness" ticket: the button while there is no harness and no open harness ticket,
 * else the ticket with its stage.
 */
export function StatusCard({
  harness,
  ticket,
  created,
  showBuild,
  build,
  refreshing,
  onRefresh,
  className = '',
}: {
  harness: HarnessStatusDto;
  ticket: HarnessTicketView | null;
  /** The ticket was created from this page just now. */
  created: boolean;
  showBuild: boolean;
  build: BuildAction;
  refreshing: boolean;
  onRefresh: () => void;
  className?: string;
}) {
  const { state } = harness;
  const required = harness.checks.filter((c) => c.required).length;
  const problemTone =
    state === 'invalid'
      ? 'border-danger/30 bg-danger-soft text-danger'
      : 'border-warning/30 bg-warning-soft text-warning';
  return (
    <Card
      title={C.title}
      actions={<ReadAt harness={harness} refreshing={refreshing} onRefresh={onRefresh} />}
      className={className}
      testId="harness-status"
    >
      <div className="flex flex-col gap-6" data-state={state}>
        {state === 'none' ? (
          <EmptyState
            icon={<HarnessIcon size={22} />}
            title={C.headline.none}
            text={`${C.text.none} ${showBuild ? B.text : ''}`.trim()}
            action={
              showBuild ? (
                <div className="flex items-center gap-1.5">
                  <BuildButton build={build} />
                  <InfoTip tip={B.newFolderTip} label={B.create} />
                </div>
              ) : undefined
            }
          />
        ) : (
          <div className="flex items-start gap-4">
            <span
              aria-hidden="true"
              className={`flex size-12 shrink-0 items-center justify-center rounded-2xl border ${ICON_FRAME[state]}`}
            >
              <HarnessIcon size={22} />
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-section font-semibold tracking-tight">{C.headline[state]}</p>
                {harness.checks.length > 0 ? (
                  <Pill tone={HARNESS_TONE[state]}>
                    {C.counts(harness.checks.length, required)}
                  </Pill>
                ) : null}
              </div>
              <p className="text-dim">{C.text[state]}</p>
            </div>
          </div>
        )}
        {harness.problems.length > 0 ? (
          <div className={`rounded-control border px-4 py-3 ${problemTone}`}>
            <p className="font-medium">{C.problems}</p>
            <ul className="mt-1 list-disc pl-5 text-ink">
              {harness.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <ActionError error={build.error} message={B.failed} />
        {ticket !== null ? <HarnessTicket ticket={ticket} created={created} /> : null}
      </div>
    </Card>
  );
}
