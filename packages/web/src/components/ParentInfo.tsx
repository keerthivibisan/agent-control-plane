import type { ParentDto } from '@acp/core/api';
import { shortId } from '../lib/format';
import { href } from '../lib/router';
import { ProvenanceBadge } from './ProvenanceBadge';

/**
 * The parent relation. Without an edge the parent is "unknown", never "none" or "independent":
 * an external launcher can't be ruled out.
 */
export function ParentInfo({ parent }: { parent: ParentDto }) {
  if (parent.state === 'unknown') {
    return (
      <span
        data-testid="parent-unknown"
        className="italic"
        title="No verified edge names a parent. This is not the same as having no parent."
      >
        parent: unknown
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" data-testid="parent-known">
      <span>parent:</span>
      <a href={href.session(parent.sessionId)} className="font-mono" title={parent.sessionId}>
        {shortId(parent.sessionId)}
      </a>
      <span className="text-dim">({parent.kind})</span>
      <ProvenanceBadge provenance={parent.provenance} />
      <span className="text-[11px] text-dim">evidence: {parent.evidence.join(', ')}</span>
    </span>
  );
}
