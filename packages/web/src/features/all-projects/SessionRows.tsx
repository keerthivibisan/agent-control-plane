import type { SessionSummaryDto } from '@acp/core/api';
import type { ReactNode } from 'react';
import { RelativeTime } from '../../components/RelativeTime';
import { StatusBadge } from '../../components/StatusBadge';
import { helperAgentsText, OVERVIEW_COPY } from '../../lib/copy';
import { href } from '../../lib/router';

/** What to call a session in plain words: its title, else its helper-agent type. */
export function sessionName(s: Pick<SessionSummaryDto, 'title' | 'agentType'>): string {
  return s.title ?? s.agentType ?? OVERVIEW_COPY.untitled;
}

/**
 * A friendly one-line session: name (link), project and helper-agent count, status, and a time on
 * the right (last activity by default; the caller can pass another, e.g. "Asked 3 min ago").
 */
function SessionRow({
  session,
  projectName,
  time,
}: {
  session: SessionSummaryDto;
  projectName: string | undefined;
  time: ReactNode;
}) {
  const helpers = helperAgentsText(session.childCount);
  const context = [projectName ?? OVERVIEW_COPY.noProject, helpers].filter(Boolean).join(' · ');
  return (
    <li
      data-session-id={session.id}
      className="flex items-center gap-4 border-b border-line py-3 last:border-b-0"
    >
      <div className="min-w-0 flex-1">
        <a
          href={href.session(session.id)}
          className="block truncate font-medium text-ink no-underline hover:text-accent hover:underline"
        >
          {sessionName(session)}
        </a>
        <div className="truncate text-caption text-dim">{context}</div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <StatusBadge status={session.status} withTip={false} />
        <span className="text-caption text-dim">{time}</span>
      </div>
    </li>
  );
}

export function SessionRows({
  sessions,
  projectNames,
  label,
  testId,
  timeOf = (s) => <RelativeTime iso={s.lastEventAt} fallback={OVERVIEW_COPY.noActivity} />,
}: {
  sessions: readonly SessionSummaryDto[];
  projectNames: ReadonlyMap<string, string>;
  /** Accessible name of the list. */
  label: string;
  testId?: string;
  timeOf?: (s: SessionSummaryDto) => ReactNode;
}) {
  return (
    <ul aria-label={label} data-testid={testId} className="-my-3">
      {sessions.map((s) => (
        <SessionRow
          key={s.id}
          session={s}
          projectName={s.projectId === null ? undefined : projectNames.get(s.projectId)}
          time={timeOf(s)}
        />
      ))}
    </ul>
  );
}
