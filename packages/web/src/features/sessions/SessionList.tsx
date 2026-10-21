import type { SessionEdgeDto, SessionSummaryDto } from '@acp/core/api';
import type { ReactNode } from 'react';
import { DataTable, type Column } from '../../components/DataTable';
import { InfoTip } from '../../components/InfoTip';
import { RelativeTime } from '../../components/RelativeTime';
import { ShortId } from '../../components/ShortId';
import { StatusBadge } from '../../components/StatusBadge';
import { schemas, paths } from '../../lib/api';
import { GLOSSARY, helperAgentsText, SESSIONS_COPY } from '../../lib/copy';
import { href } from '../../lib/router';
import { groupSessions, type GroupedRow } from './grouping';
import { nameSession } from '../../lib/session-name';
import { isHelperAgent, SessionNameExtra, TokenSummary } from './session-bits';
import { useApiQueries } from './use-api-queries';

const COPY = SESSIONS_COPY.table;

/**
 * The `subagent` edges among this page's sessions, from each top-level parent's tree (verified
 * edges only). Helpers are never matched to a parent any other way (ids, folders, timing).
 */
function usePageEdges(sessions: readonly SessionSummaryDto[]): SessionEdgeDto[] {
  const treePaths = sessions
    .filter((s) => s.childCount > 0 && !isHelperAgent(s))
    .map((s) => paths.sessionTree(s.id));
  const trees = useApiQueries(treePaths, schemas.sessionTree);
  return trees.flatMap((t) => t.data?.edges ?? []);
}

/**
 * Name on top; underneath, in a quieter line: short id, project and how many helper agents it
 * started (a helper agent shows its task instead). Keeps the table narrow enough for 1024px.
 */
function SessionCell({ row, projectName }: { row: GroupedRow; projectName: string | null }) {
  const s = row.session;
  const naming = nameSession(s);
  return (
    <div
      className="flex min-w-0 items-start gap-2"
      style={{ paddingLeft: `${Math.min(row.depth, 4) * 1.25}rem` }}
    >
      {row.depth > 0 ? (
        <span aria-hidden="true" className="mt-0.5 text-dim">
          ↳
        </span>
      ) : null}
      <div className="min-w-0">
        <a
          href={href.session(s.id)}
          className="block truncate font-medium"
          data-testid="session-name"
          data-name-kind={naming.kind}
        >
          {naming.name}
        </a>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-caption text-dim">
          <ShortId id={s.id} label="session id" />
          {s.projectId ? (
            <a
              href={href.project(s.projectId)}
              className="text-dim hover:text-ink"
              data-testid="session-project"
            >
              {projectName ?? s.projectId}
            </a>
          ) : (
            <span>{COPY.noProject}</span>
          )}
          {s.childCount > 0 ? (
            <span className="inline-flex items-center gap-0.5" data-testid="helper-count">
              {helperAgentsText(s.childCount)}
            </span>
          ) : null}
        </div>
        <SessionNameExtra naming={naming} />
      </div>
    </div>
  );
}

/**
 * The sessions on one page, with each helper agent indented under the session that started it
 * when both are on the page. Token columns are this session's own tokens.
 */
export function SessionList({
  sessions,
  projectNames,
  empty,
}: {
  sessions: readonly SessionSummaryDto[];
  projectNames: ReadonlyMap<string, string>;
  empty: ReactNode;
}) {
  const rows = groupSessions(sessions, usePageEdges(sessions));

  const columns: readonly Column<GroupedRow>[] = [
    {
      key: 'session',
      label: COPY.session,
      header: (
        <span className="inline-flex items-center gap-1">
          {COPY.session}
          <InfoTip tip={GLOSSARY.helperAgent.tip} label={GLOSSARY.helperAgent.term} />
        </span>
      ),
      className: 'lg:max-w-[24rem]',
      cell: (r) => (
        <SessionCell
          row={r}
          projectName={r.session.projectId ? (projectNames.get(r.session.projectId) ?? null) : null}
        />
      ),
    },
    {
      key: 'status',
      label: COPY.status,
      cell: ({ session: s }) => <StatusBadge status={s.status} withTip={false} />,
    },
    {
      key: 'tokens',
      label: COPY.tokens,
      header: (
        <span className="inline-flex items-center gap-1">
          {COPY.tokens}
          <InfoTip tip={GLOSSARY.tokensThisSession.tip} label={COPY.tokens} />
        </span>
      ),
      cell: ({ session: s }) => <TokenSummary usage={s.directUsage} />,
    },
    {
      key: 'last',
      label: COPY.lastActivity,
      cell: ({ session: s }) => <RelativeTime iso={s.lastEventAt} fallback={COPY.noActivity} />,
    },
  ];

  return (
    // Safety net only: at 1024px and up the columns fit; below that the rows become cards.
    <div className="overflow-x-auto">
      <DataTable
        label={COPY.label}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.session.id}
        rowAttributes={(r) => ({
          'data-session-id': r.session.id,
          'data-depth': String(r.depth),
        })}
        empty={empty}
      />
    </div>
  );
}
