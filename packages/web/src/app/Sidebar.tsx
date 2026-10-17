import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { ComponentType } from 'react';
import { GridIcon, HealthIcon, type IconProps } from '../components/icons';
import { paths, schemas } from '../lib/api';
import { CONNECTION_COPY, SHELL_COPY, SHELL_FRAME_COPY } from '../lib/copy';
import { useApiQuery } from '../lib/query';
import { href, routeProjectId, type Route } from '../lib/router';
import type { StreamState } from '../lib/useEventStream';
import { activePage } from './nav';
import { availableProjectPages } from './project-pages';
import { ShellTooltip, TipKey } from './ShellTooltip';
import { isMacLike } from './sidebar-state';

const N = SHELL_COPY.nav;
const F = SHELL_FRAME_COPY;

const DOT: Record<StreamState['status'], string> = {
  open: 'bg-status-active',
  connecting: 'bg-status-unknown',
  reconnecting: 'bg-status-idle',
  unsupported: 'bg-status-stale',
};

/** The sidebar and the top bar's brand cell share this width, so their borders line up. */
export function sidebarWidthClass(collapsed: boolean): string {
  return `shrink-0 transition-[width] duration-200 ease-(--ease-out-soft) motion-reduce:transition-none ${
    collapsed ? 'w-14' : 'w-sidebar'
  }`;
}

function NavLink({
  to,
  label,
  icon: Icon,
  active,
  collapsed,
}: {
  to: string;
  label: string;
  icon: ComponentType<IconProps>;
  active: boolean;
  collapsed: boolean;
}) {
  return (
    <ShellTooltip content={label} disabled={!collapsed} wrapperClassName="flex flex-col">
      <a
        href={to}
        aria-current={active ? 'page' : undefined}
        // The active entry: a raised ivory/graphite step and the brand's lime marker on the left
        // edge (framed on ivory, where lime alone would not show), like the logo's lit centre.
        className={`relative flex h-8 items-center gap-2.5 rounded-control px-3 no-underline transition-colors focus-visible:-outline-offset-2 ${
          active
            ? 'bg-panel font-medium text-ink shadow-[inset_0_0_0_1px_var(--color-line)] before:absolute before:top-1/2 before:left-0 before:h-4 before:w-[3px] before:-translate-y-1/2 before:bg-accent-fill before:shadow-[0_0_0_1px_var(--color-accent-fill-edge)]'
            : 'text-dim hover:bg-hover hover:text-ink'
        }`}
      >
        <Icon size={16} className="shrink-0" />
        <span className={collapsed ? 'sr-only' : 'truncate whitespace-nowrap'}>{label}</span>
      </a>
    </ShellTooltip>
  );
}

function ToggleButton({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const mac = isMacLike();
  const label = collapsed ? F.sidebar.expand : F.sidebar.collapse;
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <ShellTooltip
      side={collapsed ? 'right' : 'top'}
      content={
        <>
          <span>{label}</span>
          <TipKey>{F.sidebarShortcut(mac)}</TipKey>
        </>
      }
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={label}
        aria-keyshortcuts={mac ? 'Meta+B' : 'Control+B'}
        data-testid="sidebar-toggle"
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-control text-dim transition-colors hover:bg-hover hover:text-ink"
      >
        <Icon size={16} strokeWidth={1.75} aria-hidden="true" focusable="false" />
      </button>
    </ShellTooltip>
  );
}

function Footer({
  stream,
  collapsed,
  onToggle,
}: {
  stream: StreamState;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const health = useApiQuery(paths.health(), schemas.health);
  const unreachable = health.data === undefined && health.error?.kind === 'unreachable';
  const connection = CONNECTION_COPY[stream.status];
  // Full list: the dot sits in the icon column and the words in the label column.
  const text = collapsed ? 'sr-only' : 'truncate pl-[1.625rem]';
  return (
    <div
      className={`flex border-t border-line p-2 text-caption text-dim ${
        collapsed ? 'flex-col items-center gap-1 pt-3' : 'items-center gap-2'
      }`}
    >
      <div
        className={`flex min-w-0 flex-col ${collapsed ? 'items-center' : 'flex-1 gap-0.5 pl-3'}`}
      >
        <ShellTooltip
          content={connection.tip}
          side={collapsed ? 'right' : 'top'}
          align={collapsed ? 'center' : 'start'}
          describe
        >
          <span
            tabIndex={0}
            className={`inline-flex items-center rounded-control font-medium text-ink ${
              collapsed ? 'size-8 justify-center' : 'gap-2.5 self-start'
            }`}
            data-testid="connection-status"
          >
            <span aria-hidden="true" className="flex w-4 shrink-0 justify-center">
              <span
                className={`inline-block size-2 rounded-full ${DOT[stream.status]} ${
                  stream.status === 'open'
                    ? 'shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-status-active)_20%,transparent)]'
                    : ''
                }`}
              />
            </span>
            <span className={collapsed ? 'sr-only' : 'truncate'}>{connection.word}</span>
          </span>
        </ShellTooltip>
        <span data-testid="server-status" className={text}>
          {health.data
            ? `Server ${health.data.version} · ${health.data.mode} mode`
            : unreachable
              ? 'Server not reachable'
              : health.error
                ? 'Server error'
                : 'Checking the server…'}
        </span>
        {stream.invalidNotices > 0 ? (
          <span className={`text-danger ${text}`} title={stream.lastInvalidNotice ?? ''}>
            {stream.invalidNotices} invalid live update
            {stream.invalidNotices === 1 ? '' : 's'} ignored
          </span>
        ) : null}
      </div>
      <ToggleButton collapsed={collapsed} onToggle={onToggle} />
    </div>
  );
}

/**
 * The project sidebar (DESIGN.md, "Layout"): the project's pages, then All projects and Data
 * health, and the live-connection footer with the toggle between the full list and the icon rail
 * (each entry's label then shows as a tooltip and stays the link's name).
 */
export function Sidebar({
  route,
  projectId,
  stream,
  collapsed,
  onToggle,
}: {
  route: Route;
  /** The project the project pages link to; null hides the project section. */
  projectId: string | null;
  stream: StreamState;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const page = activePage(route);
  const onRouteProject = routeProjectId(route) === projectId || route.name === 'session';
  return (
    <div
      id="app-sidebar"
      data-testid="sidebar"
      data-collapsed={collapsed ? 'true' : undefined}
      className={`border-r border-line bg-sidebar ${sidebarWidthClass(collapsed)}`}
    >
      <nav
        aria-label={N.label}
        className="sticky top-topbar flex h-[calc(100vh-var(--spacing-topbar))] flex-col overflow-hidden"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-px overflow-x-hidden overflow-y-auto px-2 py-3">
          {projectId !== null ? (
            <>
              <p
                className={
                  collapsed
                    ? 'sr-only'
                    : 'truncate px-3 pt-0.5 pb-1.5 text-caption font-medium whitespace-nowrap text-dim'
                }
              >
                {N.project}
              </p>
              {availableProjectPages().map((p) => (
                <NavLink
                  key={p.id}
                  to={href.projectPage(projectId, p.id)}
                  label={p.label}
                  icon={p.icon}
                  active={onRouteProject && page === p.id}
                  collapsed={collapsed}
                />
              ))}
              <div aria-hidden="true" className="mx-2 my-3 border-t border-line" />
            </>
          ) : null}
          <NavLink
            to={href.projects()}
            label={N.allProjects}
            icon={GridIcon}
            active={route.name === 'projects' || route.name === 'project-new'}
            collapsed={collapsed}
          />
          <NavLink
            to={href.health()}
            label={N.health}
            icon={HealthIcon}
            active={route.name === 'health'}
            collapsed={collapsed}
          />
        </div>
        <Footer stream={stream} collapsed={collapsed} onToggle={onToggle} />
      </nav>
    </div>
  );
}
