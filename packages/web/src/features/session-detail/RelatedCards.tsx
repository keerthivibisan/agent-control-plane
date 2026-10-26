import type { SessionDetailDto, SessionTreeDto } from '@acp/core/api';
import type { ReactNode } from 'react';
import { Card } from '../../components/Card';
import { ErrorNotice } from '../../components/ErrorNotice';
import { InfoTip } from '../../components/InfoTip';
import { ShortId } from '../../components/ShortId';
import type { QueryState } from '../../lib/query-store';
import { EMPTY, GLOSSARY, SESSION_DETAIL_COPY, SESSIONS_COPY } from '../../lib/copy';
import { href } from '../../lib/router';
import { FamilyTree } from '../sessions/FamilyTree';
import { sessionName } from '../../lib/session-name';

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

/**
 * "Session family": this session's whole family as a tree (top-level session first, helper agents
 * nested, continuations dashed), with this session outlined. Built from the tree's evidence edges.
 */
export function FamilyCard({ s, tree }: { s: SessionDetailDto; tree: QueryState<SessionTreeDto> }) {
  const copy = SESSIONS_COPY.family;
  return (
    <Card
      title={copy.title}
      tip={GLOSSARY.helperAgent.tip}
      description={copy.description}
      testId="helper-agents"
    >
      {/* With helpers, the tree card says how many; without, one sentence says so. */}
      {s.childCount === 0 ? (
        <p className="mb-3 text-dim" data-testid="helper-count">
          {EMPTY.helpers.text}
        </p>
      ) : null}
      {tree.data !== undefined ? (
        <FamilyTree tree={tree.data} currentId={s.id} />
      ) : tree.error ? (
        <ErrorNotice error={tree.error} />
      ) : (
        <p className="text-dim">{SESSION_DETAIL_COPY.activity.loading}</p>
      )}
    </Card>
  );
}
