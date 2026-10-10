import type { ReactNode } from 'react';
import { DemoBanner } from '../components/DemoBanner';
import { ErrorNotice } from '../components/ErrorNotice';
import { paths, schemas } from '../lib/api';
import { useApiQuery } from '../lib/query';
import { href, type Route } from '../lib/router';
import { useTheme } from '../lib/theme';
import type { StreamState } from '../lib/useEventStream';

const NAV: readonly { label: string; to: string; match: Route['name'][] }[] = [
  { label: 'Command Center', to: href.home(), match: ['home'] },
  { label: 'Sessions', to: href.sessions(), match: ['sessions', 'session'] },
  { label: 'Usage', to: href.usage(), match: ['usage'] },
];

const STREAM_LABEL: Record<StreamState['status'], string> = {
  connecting: 'live updates: connecting',
  open: 'live updates: connected',
  reconnecting: 'live updates: reconnecting',
  unsupported: 'live updates: unavailable in this browser',
};

function NavLink({ to, active, children }: { to: string; active: boolean; children: ReactNode }) {
  return (
    <a
      href={to}
      aria-current={active ? 'page' : undefined}
      className={`block truncate rounded px-2 py-1 no-underline ${
        active ? 'bg-sunken font-semibold text-ink' : 'text-dim hover:bg-sunken hover:text-ink'
      }`}
    >
      {children}
    </a>
  );
}

export function Shell({
  route,
  stream,
  children,
}: {
  route: Route;
  stream: StreamState;
  children: ReactNode;
}) {
  const health = useApiQuery(paths.health(), schemas.health);
  const capabilities = useApiQuery(paths.capabilities(), schemas.capabilities);
  const projects = useApiQuery(paths.projects(), schemas.projects);
  const theme = useTheme();
  const mode = capabilities.data?.mode ?? health.data?.mode;
  const unreachable = health.data === undefined && health.error?.kind === 'unreachable';

  return (
    <div className="flex min-h-full flex-col">
      <DemoBanner mode={mode} />
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Main"
          className="sticky top-0 flex h-screen w-52 shrink-0 flex-col gap-3 border-r border-line bg-panel p-2"
        >
          <a href={href.home()} className="px-2 pt-1 text-sm font-semibold text-ink no-underline">
            Agent Control Plane
          </a>
          <div className="flex flex-col gap-0.5">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} active={n.match.includes(route.name)}>
                {n.label}
              </NavLink>
            ))}
          </div>
          <div className="flex min-h-0 flex-col gap-0.5">
            <div className="px-2 text-[11px] font-semibold tracking-wide text-dim uppercase">
              Projects
            </div>
            <div className="min-h-0 overflow-y-auto">
              {projects.data?.map((p) => (
                <NavLink
                  key={p.id}
                  to={href.project(p.id)}
                  active={route.name === 'project' && route.id === p.id}
                >
                  <span title={p.rootPath}>{p.name}</span>
                </NavLink>
              ))}
              {projects.data?.length === 0 ? (
                <p className="px-2 text-[11px] text-dim italic">none registered</p>
              ) : null}
            </div>
          </div>
          <div className="mt-auto flex flex-col gap-1 border-t border-line px-2 pt-2 text-[11px] text-dim">
            <span data-testid="server-status">
              {health.data
                ? `server ${health.data.version} · ${health.data.mode} mode`
                : unreachable
                  ? 'server not reachable'
                  : health.error
                    ? 'server error'
                    : 'server: checking…'}
            </span>
            <span>{STREAM_LABEL[stream.status]}</span>
            {stream.invalidNotices > 0 ? (
              <span
                className="text-red-700 dark:text-red-300"
                title={stream.lastInvalidNotice ?? ''}
              >
                {stream.invalidNotices} invalid stream notice
                {stream.invalidNotices === 1 ? '' : 's'} rejected
              </span>
            ) : null}
            <button
              type="button"
              onClick={theme.cycle}
              className="mt-1 self-start rounded border border-line px-1.5 py-0.5 text-ink hover:bg-sunken"
              title="Cycle theme: system → light → dark"
            >
              theme: {theme.preference}
              {theme.preference === 'system' ? ` (${theme.resolved})` : ''}
            </button>
          </div>
        </nav>
        <main className="min-w-0 flex-1 p-4">
          {unreachable && health.error ? <ErrorNotice error={health.error} /> : children}
        </main>
      </div>
    </div>
  );
}
