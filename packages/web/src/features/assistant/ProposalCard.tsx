import type { AssistantProposalDto, AssistantProposalState } from '@acp/core/api';
import { useState } from 'react';
import { Button } from '../../components/Button';
import { AlertIcon } from '../../components/icons';
import { Badge, Pill, type PillTone } from '../../components/Pill';
import { ASSISTANT_COPY } from '../../lib/copy';

const P = ASSISTANT_COPY.proposal;

const TONE: Record<AssistantProposalState, PillTone> = {
  pending: 'accent',
  applied: 'success',
  discarded: 'neutral',
  written: 'warning',
  failed: 'danger',
};

/**
 * One skill or agent file the assistant drafted (ADR-0035 §5). The preview is the file as the app
 * writes it, shown as plain text (repository data, never HTML). Apply and Discard while it waits,
 * in Approve mode.
 */
export function ProposalCard({
  proposal,
  onDecide,
}: {
  proposal: AssistantProposalDto;
  /**
   * Decides a pending file. Only Approve mode creates pending proposals; one made before the owner
   * switched to Auto stays decidable here rather than stuck.
   */
  onDecide: (decision: 'apply' | 'discard') => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (decision: 'apply' | 'discard') => {
    setPending(true);
    setError(null);
    try {
      await onDecide(decision);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <article
      className="flex flex-col gap-2 rounded-card border border-line bg-panel p-3 shadow-card"
      data-testid="assistant-proposal"
      data-proposal-id={proposal.id}
      data-state={proposal.state}
      aria-label={`${P.kinds[proposal.kind]} ${proposal.slug}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={proposal.kind === 'skill' ? 'accent' : 'done'}>{P.kinds[proposal.kind]}</Badge>
        <span className="font-mono text-caption font-semibold text-ink">{proposal.slug}</span>
        <span className="ml-auto">
          <Pill tone={TONE[proposal.state]} testId="assistant-proposal-state">
            {P.states[proposal.state]}
          </Pill>
        </span>
      </div>
      <p className="font-mono text-micro break-all text-dim">{proposal.path}</p>
      {proposal.replace ? (
        <p
          className="flex items-center gap-1.5 text-caption font-medium text-warning"
          data-testid="assistant-proposal-replace"
        >
          <AlertIcon size={14} />
          {P.replaces}
        </p>
      ) : null}
      {proposal.state === 'failed' && proposal.problem !== null ? (
        <p className="text-caption text-danger" role="alert">
          {proposal.problem}
        </p>
      ) : null}
      <details className="group rounded-control border border-line bg-sunken">
        <summary className="cursor-pointer px-2 py-1 text-caption font-medium text-dim select-none hover:text-ink">
          {P.preview}
        </summary>
        <pre
          className="max-h-64 overflow-auto border-t border-line px-2 py-1.5 font-mono text-micro whitespace-pre-wrap break-words text-ink"
          data-testid="assistant-proposal-content"
        >
          {proposal.content}
        </pre>
      </details>
      {proposal.state === 'pending' ? (
        <div className="flex gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={pending}
            aria-label={P.applyLabel(proposal.path)}
            onClick={() => void decide('apply')}
          >
            {P.apply}
          </Button>
          <Button
            size="sm"
            disabled={pending}
            aria-label={P.discardLabel(proposal.path)}
            onClick={() => void decide('discard')}
          >
            {P.discard}
          </Button>
        </div>
      ) : null}
      {error !== null ? (
        <p className="text-caption text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}
