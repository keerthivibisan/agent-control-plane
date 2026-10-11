import { APPROVAL_TIMEOUT_MS } from '@acp/core';
import type { AgentRunDto, ApprovalDto } from '@acp/core/api';
import { Button } from '../../components/Button';
import { Details } from '../../components/Details';
import { RelativeTime } from '../../components/RelativeTime';
import { decideApproval } from '../../lib/api';
import { CONTROL_COPY } from '../../lib/copy';
import { useControlAction } from './actions';
import { ActionError } from './bits';
import { splitApprovals } from './run-state';

const C = CONTROL_COPY.approvals;

function roleOf(agents: readonly AgentRunDto[], id: string): string {
  return agents.find((a) => a.id === id)?.role ?? CONTROL_COPY.terms.worker.term.toLowerCase();
}

function Request({ approval, role }: { approval: ApprovalDto; role: string }) {
  const decide = useControlAction(decideApproval);
  const budget = approval.kind === 'budget-raise';
  return (
    <li
      className="flex flex-col gap-2 rounded-control border border-line bg-panel px-4 py-3"
      data-testid={`approval-${approval.id}`}
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p>{budget ? C.budgetRaise(role) : C.toolUse(role)}</p>
          {budget ? null : (
            <p className="rounded-control bg-sunken px-2.5 py-1.5 font-mono text-caption break-all">
              {approval.summary}
            </p>
          )}
          <span className="text-caption text-dim">
            <RelativeTime iso={approval.requestedAt} />
          </span>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="primary"
            disabled={decide.pending}
            onClick={() => void decide.run(approval.id, { decision: 'approve' })}
          >
            {C.approve}
          </Button>
          <Button
            disabled={decide.pending}
            onClick={() => void decide.run(approval.id, { decision: 'deny' })}
          >
            {C.deny}
          </Button>
        </div>
      </div>
      <ActionError error={decide.error} message={C.failed} />
    </li>
  );
}

/**
 * Requests the agents are waiting on (ADR-0013): one row each with the redacted summary and
 * Approve / Deny. Shown above everything else while anything waits; earlier answers stay listed,
 * collapsed.
 */
export function Approvals({
  approvals,
  agents,
}: {
  approvals: readonly ApprovalDto[];
  agents: readonly AgentRunDto[];
}) {
  const { pending, decided } = splitApprovals(approvals);
  if (pending.length === 0 && decided.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {pending.length > 0 ? (
        <section
          aria-label={C.title}
          data-testid="approvals"
          className="rounded-card border border-warning/40 bg-warning-soft px-5 py-4 shadow-card"
        >
          <h2 className="text-title font-semibold">{C.title}</h2>
          <p className="mt-0.5 text-dim">
            {C.description} {C.timeout(Math.round(APPROVAL_TIMEOUT_MS / 60_000))}
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {pending.map((a) => (
              <Request key={a.id} approval={a} role={roleOf(agents, a.agentRunId)} />
            ))}
          </ul>
        </section>
      ) : null}
      {decided.length > 0 ? (
        <Details summary={C.history(decided.length)} testId="approval-history">
          <ul className="flex flex-col gap-2 text-caption">
            {decided.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="font-medium">{roleOf(agents, a.agentRunId)}</span>
                {a.kind === 'budget-raise' ? (
                  <span className="min-w-0 flex-1">{C.budgetRaiseShort}</span>
                ) : (
                  <span className="min-w-0 flex-1 font-mono break-all">{a.summary}</span>
                )}
                <span className={a.status === 'approved' ? 'text-success' : 'text-dim'}>
                  {C.status[a.status]}
                </span>
                <RelativeTime iso={a.decidedAt ?? a.requestedAt} />
              </li>
            ))}
          </ul>
        </Details>
      ) : null}
    </div>
  );
}
