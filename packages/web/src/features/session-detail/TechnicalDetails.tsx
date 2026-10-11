import type { SessionDetailDto } from '@acp/core/api';
import type { ReactNode } from 'react';
import { Details } from '../../components/Details';
import { NOT_REPORTED, SESSION_DETAIL_COPY } from '../../lib/copy';
import { formatExactTime } from '../../lib/format';

const COPY = SESSION_DETAIL_COPY.technical;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-0.5 border-b border-line/70 py-2 last:border-b-0 sm:grid-cols-[14rem_1fr]">
      <dt className="text-dim">{label}</dt>
      <dd className="min-w-0 font-mono text-caption break-all">{children}</dd>
    </div>
  );
}

const missing = (text: string = NOT_REPORTED) => (
  <span className="font-sans text-body text-unavailable">{text}</span>
);

const time = (iso: string | null, fallback?: string) =>
  iso === null ? missing(fallback) : formatExactTime(iso);

/**
 * Everything else we know about the session, collapsed: launch folder, branch, entry point,
 * versions, full ids, and where each kind of value comes from (provenance and evidence).
 */
export function TechnicalDetails({ s }: { s: SessionDetailDto }) {
  const p = s.parent;
  return (
    <Details testId="technical-details">
      <dl data-testid="session-metadata">
        <Row label={COPY.launchFolder}>{s.launchCwd ?? missing()}</Row>
        <Row label={COPY.gitBranch}>{s.gitBranch ?? missing()}</Row>
        <Row label={COPY.entryPoint}>{s.entrypoint ?? missing()}</Row>
        <Row label={COPY.version}>{s.providerVersion ?? missing()}</Row>
        <Row label={COPY.provider}>{s.provider}</Row>
        <Row label={COPY.sessionId}>{s.id}</Row>
        <Row label={COPY.providerSessionId}>{s.providerSessionId}</Row>
        <Row label={COPY.agentId}>{s.providerAgentId ?? missing(COPY.notHelper)}</Row>
        {s.description ? <Row label={COPY.task}>{s.description}</Row> : null}
        <Row label={COPY.projectId}>{s.projectId ?? missing(SESSION_DETAIL_COPY.noProject)}</Row>
        <Row label={COPY.origin}>{s.origin}</Row>
        <Row label={COPY.firstSeen}>{time(s.firstSeenAt)}</Row>
        <Row label={SESSION_DETAIL_COPY.lastActivity}>{time(s.lastEventAt)}</Row>
        <Row label={COPY.ended}>
          {time(s.endedAt, COPY.notEnded)}
          {s.endReason ? ` (${s.endReason})` : null}
        </Row>
        <Row label={COPY.attention}>{time(s.lastAttentionAt, COPY.never)}</Row>
        <Row label={COPY.status}>
          {s.status.value} · {COPY.statusBasis(formatExactTime(s.status.basis.evaluatedAt))}
        </Row>
        <Row label={COPY.parent}>
          {p.state === 'known'
            ? `${p.sessionId} · ${COPY.parentEvidence(p.kind, p.provenance, p.evidence.join(', '))}`
            : missing(COPY.noParent)}
        </Row>
        <Row label={COPY.snapshot}>
          {s.latestSnapshot
            ? COPY.snapshotSummary(
                s.latestSnapshot.reportedCostUsd.provenance,
                s.latestSnapshot.scope,
              )
            : missing(COPY.noSnapshot)}
        </Row>
        <Row label={COPY.sharedRecords}>{s.ambiguousAttributionCount}</Row>
      </dl>
      <p className="mt-3 text-caption text-dim">
        <span className="font-medium">{COPY.sources}:</span> {COPY.sourcesText}
      </p>
    </Details>
  );
}
