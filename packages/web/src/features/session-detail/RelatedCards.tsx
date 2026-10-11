import type { SessionDetailDto, SessionSummaryDto, SessionTreeDto } from '@acp/core/api';
import type { ReactNode } from 'react';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { ErrorNotice } from '../../components/ErrorNotice';
import { InfoTip } from '../../components/InfoTip';
import { RelativeTime } from '../../components/RelativeTime';
import { ShortId } from '../../components/ShortId';
import { StatusBadge } from '../../components/StatusBadge';
import type { QueryState } from '../../lib/query-store';
import {
  EMPTY,
  GLOSSARY,
  helperAgentsText,
  SESSION_DETAIL_COPY,
  SESSIONS_COPY,
} from '../../lib/copy';
import { href } from '../../lib/router';
import { sessionName, TokenSummary } from '../sessions/session-bits';

const COPY = SESSION_DETAIL_COPY.related;

function SessionLink({ id, tree }: { id: string; tree: SessionTreeDto | undefined }) {
  const node = tree?.nodes.find((n) => n.session.id === id);
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2">
      <a href={href.session(id)} className="font-medium">
        {node ? sessionName(node.session) : GLOSSARY.session.term}
      </a>
      <ShortId id={id} label="session id" />
    </span>
  );
}

function Row({
  label,
  children,
  testId,
}: {
  label: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0" data-testid={testId}>
      <dt className="text-caption font-medium text-dim">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/**
 * Where this session came from and where it went: the session that started it or that it was
 * continued from (only with evidence; otherwise "No known parent", explained), and the sessions it
 * was continued as.
 */
export function RelatedSessionsCard({
  s,
  tree,
}: {
  s: SessionDetailDto;
  tree: SessionTreeDto | undefined;
}) {
  const parent = s.parent;
  return (
    <Card title={COPY.title} tip={GLOSSARY.continued.tip}>
      <dl className="flex flex-col divide-y divide-line">
        {parent.state === 'known' ? (
          <Row
            label={parent.kind === 'subagent' ? COPY.startedBy : COPY.continuedFrom}
            testId="parent-known"
          >
            <SessionLink id={parent.sessionId} tree={tree} />
          </Row>
        ) : (
          <Row
            label={
              <span className="inline-flex items-center gap-1">
                <span data-testid="parent-unknown">{GLOSSARY.noKnownParent.term}</span>
                <InfoTip tip={GLOSSARY.noKnownParent.tip} label={GLOSSARY.noKnownParent.term} />
              </span>
            }
          >
            <p className="text-dim">{GLOSSARY.noKnownParent.tip}</p>
          </Row>
        )}
        <Row label={COPY.continuedAs} testId="continuations">
          {s.continuationIds.length === 0 ? (
            <span className="text-dim">{COPY.notContinued}</span>
          ) : (
            <ul className="flex flex-col gap-1">
              {s.continuationIds.map((id) => (
                <li key={id}>
                  <SessionLink id={id} tree={tree} />
                </li>
              ))}
            </ul>
          )}
        </Row>
      </dl>
    </Card>
  );
}

/** The helper agents this session started, from the tree's verified `subagent` edges. */
export function HelperAgentsCard({
  s,
  tree,
}: {
  s: SessionDetailDto;
  tree: QueryState<SessionTreeDto>;
}) {
  const copy = SESSION_DETAIL_COPY.helpers;
  const t = tree.data;
  const children: SessionSummaryDto[] = [];
  if (t) {
    const byId = new Map(t.nodes.map((n) => [n.session.id, n.session]));
    const seen = new Set<string>();
    for (const e of t.edges) {
      if (e.kind !== 'subagent' || e.parentId !== s.id || seen.has(e.childId)) continue;
      seen.add(e.childId);
      const child = byId.get(e.childId);
      if (child) children.push(child);
    }
    children.sort((a, b) => (a.firstSeenAt < b.firstSeenAt ? -1 : 1));
  }
  return (
    <Card
      title={copy.title}
      tip={GLOSSARY.helperAgent.tip}
      description={
        s.childCount > 0
          ? (helperAgentsText(s.childCount) ?? SESSIONS_COPY.table.noHelpers)
          : copy.description
      }
      testId="helper-agents"
    >
      {s.childCount === 0 ? (
        <EmptyState compact title={EMPTY.helpers.title} text={EMPTY.helpers.text} />
      ) : t === undefined ? (
        tree.error ? (
          <ErrorNotice error={tree.error} />
        ) : (
          <p className="text-dim">{SESSION_DETAIL_COPY.activity.loading}</p>
        )
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {children.map((c) => (
            <li
              key={c.id}
              data-session-id={c.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0"
            >
              <a href={href.session(c.id)} className="min-w-0 flex-1 truncate font-medium">
                {sessionName(c)}
              </a>
              <StatusBadge status={c.status} withTip={false} />
              <span className="text-caption">
                <TokenSummary usage={c.directUsage} withCache={false} />
              </span>
              <span className="text-caption text-dim">
                <RelativeTime iso={c.lastEventAt} fallback={SESSIONS_COPY.table.noActivity} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
