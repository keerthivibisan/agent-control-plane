import type { ConflictResolutionDto, TicketBranchDto } from '@acp/core/api';
import { Button } from '../../components/Button';
import { AlertIcon } from '../../components/icons';
import { Pill, type PillTone } from '../../components/Pill';
import {
  cancelConflictResolution,
  conflictResolutionPaths,
  conflictResolutionSchemas,
  promoteConflictResolution,
  startConflictResolution,
} from '../../lib/api';
import { RESOLUTION_COPY } from '../../lib/copy';
import { useApiQuery } from '../../lib/query';
import { ActionError, ConfirmAction } from '../control/bits';
import { useTicketAction } from '../ticket/actions';
import { ReasonForm } from './ReasonForm';

const R = RESOLUTION_COPY;
const MAX_REASON = 500;

type Op = ConflictResolutionDto;

const ACTIVE: readonly Op['state'][] = [
  'preparing',
  'resolving',
  'verifying',
  'awaiting-owner',
  'delivering',
];

/** Tones carry meaning only; every status also has its words, so color is never the only signal. */
export function verificationTone(status: Op['verification']['status']): PillTone {
  switch (status) {
    case 'passed':
      return 'success';
    case 'failed':
      return 'danger';
    case 'running':
    case 'pending':
      return 'accent';
    // Skipped, not verified, unavailable and stale are never shown as a pass.
    default:
      return 'warning';
  }
}

function resolutionTone(status: Op['resolution']['status']): PillTone {
  if (status === 'failed') return 'danger';
  if (status === 'resolved' || status === 'clean' || status === 'up-to-date') return 'success';
  if (status === 'cancelled') return 'neutral';
  return 'accent';
}

function reviewTone(status: Op['review']['status']): PillTone {
  if (status === 'owner-approved') return 'success';
  if (status === 'stale') return 'warning';
  return 'neutral';
}

function deliveryTone(status: Op['delivery']['status']): PillTone {
  if (status === 'merged' || status === 'pr-opened' || status === 'pr-updated') return 'success';
  if (status === 'blocked') return 'danger';
  if (status === 'unknown') return 'warning';
  if (status === 'pushing' || status === 'merging') return 'accent';
  return 'neutral';
}

function Dimension({
  name,
  label,
  tone,
  reason,
  testId,
  children,
}: {
  name: string;
  label: string;
  tone: PillTone;
  reason: string | null;
  testId: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 py-2" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-24 shrink-0 text-caption font-medium text-dim">{name}</span>
        <Pill tone={tone} testId={`${testId}-status`}>
          {label}
        </Pill>
      </div>
      {reason !== null ? (
        <p className="pl-26 text-caption text-dim" data-testid={`${testId}-reason`}>
          {reason}
        </p>
      ) : null}
      {children}
    </div>
  );
}

function Verification({ op }: { op: Op }) {
  const v = op.verification;
  return (
    <Dimension
      name={R.dimensions.verification}
      label={R.verification[v.status]}
      tone={verificationTone(v.status)}
      reason={v.reason}
      testId="resolution-verification"
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 pl-26 text-caption">
        {v.checkIds.length > 0 ? (
          <>
            <dt className="text-dim">{R.selected}</dt>
            <dd data-testid="resolution-checks">
              {v.checkIds.join(', ')}
              {v.checkedCommit !== null ? ` ${R.checked(v.checkedCommit)}` : ''}
            </dd>
          </>
        ) : null}
        {v.omitted.length > 0 ? (
          <>
            <dt className="text-dim">{R.omitted}</dt>
            <dd data-testid="resolution-omitted">
              {v.omitted.map((o) => `${o.id} (${o.reason})`).join('; ')}
            </dd>
          </>
        ) : null}
        {v.matchedRule !== null ? (
          <>
            <dt className="text-dim">{R.rule}</dt>
            <dd>
              <code>{v.matchedRule}</code>
            </dd>
          </>
        ) : null}
        {v.assessment !== null ? (
          <>
            <dt className="text-dim">{R.assessment}</dt>
            <dd data-testid="resolution-assessment">
              {v.assessment.classification}: {v.assessment.reason}
            </dd>
          </>
        ) : null}
      </dl>
    </Dimension>
  );
}

function Operation({ op, runId }: { op: Op; runId: string }) {
  const cancel = useTicketAction(cancelConflictResolution);
  const promote = useTicketAction(promoteConflictResolution);
  const active = ACTIVE.includes(op.state);
  const needsReason =
    op.verification.status === 'failed' || op.verification.status === 'unavailable';
  return (
    <div
      className="flex flex-col rounded-control border border-line px-3 py-2"
      data-testid="resolution-operation"
      data-state={op.state}
    >
      <div className="flex flex-wrap items-center gap-2 pb-1">
        <span className="font-medium">{R.state[op.state]}</span>
        {op.candidateCommit !== null ? (
          <span className="text-caption text-dim">{R.candidate(op.candidateCommit)}</span>
        ) : null}
        {op.conflictFiles.length > 0 ? (
          <span className="text-caption text-dim" title={op.conflictFiles.join('\n')}>
            {R.conflicts(op.conflictFiles.length)}
          </span>
        ) : null}
      </div>
      {op.stale !== null ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-control border border-warning/30 bg-warning-soft px-3 py-2 text-caption"
          data-testid="resolution-stale"
        >
          <AlertIcon size={14} className="mt-0.5 shrink-0 text-warning" />
          <span>
            <strong>{R.stale}:</strong> {op.stale}
          </span>
        </p>
      ) : null}
      <div className="flex flex-col divide-y divide-line">
        <Dimension
          name={R.dimensions.resolution}
          label={R.resolution[op.resolution.status]}
          tone={resolutionTone(op.resolution.status)}
          reason={op.resolution.reason}
          testId="resolution-resolution"
        >
          {op.attempts.length > 0 ? (
            <ol className="pl-26 text-caption text-dim" data-testid="resolution-attempts">
              {op.attempts.map((a) => (
                <li key={`${a.attempt}-${a.at}-${a.outcome}`}>
                  {a.attempt}. {a.outcome}
                  {a.note !== null ? ` — ${a.note}` : ''}
                </li>
              ))}
            </ol>
          ) : null}
        </Dimension>
        <Verification op={op} />
        <Dimension
          name={R.dimensions.review}
          label={R.review[op.review.status]}
          tone={reviewTone(op.review.status)}
          reason={op.review.reason}
          testId="resolution-review"
        />
        <Dimension
          name={R.dimensions.delivery}
          label={R.delivery[op.delivery.status]}
          tone={deliveryTone(op.delivery.status)}
          reason={op.delivery.reason}
          testId="resolution-delivery"
        />
      </div>
      {active ? (
        <div className="flex flex-wrap items-start gap-2 pt-2">
          {op.state === 'awaiting-owner' && op.stale === null ? (
            needsReason ? (
              <ReasonForm
                openLabel={R.apply}
                title={R.applyReason}
                label={R.applyReason}
                hint={R.applyHint}
                placeholder={R.applyPlaceholder}
                max={MAX_REASON}
                tooLong={R.tooLong(MAX_REASON)}
                submitLabel={R.apply}
                cancelLabel={R.back}
                pendingLabel={R.working}
                pending={promote.pending}
                tone="danger"
                testId="resolution-apply"
                onConfirm={(reason) => promote.run(runId, reason)}
              />
            ) : (
              <Button
                size="sm"
                disabled={promote.pending}
                onClick={() => void promote.run(runId)}
                data-testid="resolution-apply"
              >
                {R.applyPlain}
              </Button>
            )
          ) : null}
          {op.state !== 'delivering' ? (
            <ConfirmAction
              label={R.cancel}
              question={R.cancelConfirm}
              confirmLabel={R.cancel}
              cancelLabel={R.back}
              pendingLabel={R.working}
              pending={cancel.pending}
              onConfirm={() => cancel.run(runId)}
            />
          ) : null}
        </div>
      ) : null}
      <ActionError error={cancel.error ?? promote.error} message={R.failed} />
    </div>
  );
}

/**
 * ADR-0030: "Update target / Resolve conflicts" for the ticket branch, offered whenever its target
 * moved, also while a pull request is open (the update then needs a push to reach it). Shows the
 * latest operation's resolution, verification, review and delivery separately, with each reason.
 */
export function ResolutionPanel({
  runId,
  branch,
  baseMoved,
}: {
  runId: string;
  branch: TicketBranchDto;
  baseMoved: boolean;
}) {
  const query = useApiQuery(conflictResolutionPaths.view(runId), conflictResolutionSchemas.view);
  const start = useTicketAction(startConflictResolution);
  const view = query.data;
  const op = view?.operation ?? null;
  const active = op !== null && ACTIVE.includes(op.state);
  const offer = !active && (baseMoved || view?.baseMoved === true);
  if (!offer && op === null) return null;
  const target = branch.baseBranch;
  return (
    <div className="flex flex-col gap-2" data-testid="resolution-panel">
      {offer ? (
        <div
          role="note"
          className="flex flex-wrap items-center gap-3 rounded-control border border-warning/30 bg-warning-soft px-3 py-2"
          data-testid="branch-base-moved"
        >
          <AlertIcon size={15} className="shrink-0 text-warning" />
          <span className="min-w-0 flex-1 text-caption">{R.moved(target)}</span>
          <Button
            size="sm"
            disabled={start.pending || (view?.startBlocked ?? null) !== null}
            title={view?.startBlocked ?? undefined}
            onClick={() => void start.run(runId)}
            data-testid="resolution-start"
          >
            {start.pending ? R.starting : R.start(target)}
          </Button>
        </div>
      ) : null}
      {op !== null ? <Operation op={op} runId={runId} /> : null}
      <ActionError error={start.error} message={R.failed} />
    </div>
  );
}
