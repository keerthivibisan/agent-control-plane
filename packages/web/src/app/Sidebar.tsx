import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useId, type ComponentType, type ReactNode } from 'react';
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

/** The sidebar's two widths: the full list or the 56px icon rail. */
export function sidebarWidthClass(collapsed: boolean): string {
  return `shrink-0 transition-[width] duration-200 ease-(--ease-out-soft) motion-reduce:transition-none ${
    collapsed ? 'w-14' : 'w-sidebar'
  }`;
}

/**
 * One entry, GitHub's nav list item: icon and label, a hover fill; the selected one semibold on
 * the hover fill with a 4px accent bar at the sidebar's edge. In the rail the label is
 * screen-reader text and shows as a tooltip.
 */
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
        className={`group relative flex h-8 items-center gap-2.5 rounded-control px-3 no-underline transition-colors focus-visible:-outline-offset-2 ${
          active
            ? 'bg-hover font-semibold text-ink before:absolute before:top-1/2 before:-left-2 before:h-6 before:w-1 before:-translate-y-1/2 before:rounded-full before:bg-accent'
            : 'text-ink hover:bg-hover'
        }`}
      >
        <Icon
          size={16}
          className={`shrink-0 ${active ? 'text-ink' : 'text-dim group-hover:text-ink'}`}
        />
        <span className={collapsed ? 'sr-only' : 'truncate whitespace-nowrap'}>{label}</span>
      </a>
    </ShellTooltip>
  );
}

/** A group of entries under a small muted heading (only a divider in the rail). */
function Section({
  heading,
  collapsed,
  first = false,
  children,
}: {
  heading: string;
  collapsed: boolean;
  first?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-0.5">
      {!first ? <div aria-hidden="true" className="mx-1 my-2 border-t border-line" /> : null}
      <p
        id={id}
        className={
          collapsed
            ? 'sr-only'
            : 'truncate px-3 pt-1 pb-1 text-caption font-semibold whitespace-nowrap text-dim'
        }
      >
        {heading}
      </p>
      {children}
    </div>
  );
}

/**
 * The sidebar toggle (v0.3.0 D-0, owner request): a panel icon button at the left of the top
 * bar, over the sidebar column, where people look for it; it stays there over the icon rail. The
 * tooltip names it with its shortcut ("Hide sidebar ⌘B"); ⌘B/Ctrl+B and the remembered choice are
 * `useSidebar`'s.
 */
export function SidebarToggle({
  collapsed,
  onToggle,
  className,
}: {
  collapsed: boolean;
  onToggle: () => void;
  className: string;
}) {
  const mac = isMacLike();
  const label = collapsed ? F.sidebar.expand : F.sidebar.collapse;
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <ShellTooltip
      side="bottom"
      align="start"
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
        aria-controls="app-sidebar"
        aria-expanded={!collapsed}
        aria-keyshortcuts={mac ? 'Meta+B' : 'Control+B'}
        data-testid="sidebar-toggle"
        className={className}
      >
        <Icon size={16} strokeWidth={1.75} aria-hidden="true" focusable="false" />
      </button>
    </ShellTooltip>
  );
}

/** The bottom of the sidebar: the live connection and the server, as small text. */
function Footer({ stream, collapsed }: { stream: StreamState; collapsed: boolean }) {
  const health = useApiQuery(paths.health(), schemas.health);
  const unreachable = health.data === undefined && health.error?.kind === 'unreachable';
  const connection = CONNECTION_COPY[stream.status];
  const text = collapsed ? 'sr-only' : 'truncate';
  return (
    <div
      className={`flex min-w-0 flex-col border-t border-line px-2 py-2.5 text-caption text-dim ${
        collapsed ? 'items-center' : 'gap-0.5 px-3'
      }`}
    >
      <ShellTooltip
        content={connection.tip}
        side={collapsed ? 'right' : 'top'}
        align={collapsed ? 'center' : 'start'}
        describe
      >
        <span
          tabIndex={0}
          className={`inline-flex items-center rounded-control ${
            collapsed ? 'size-8 justify-center' : 'gap-2 self-start'
          }`}
          data-testid="connection-status"
        >
          <span
            aria-hidden="true"
            className={`inline-block size-2 shrink-0 rounded-full ${DOT[stream.status]}`}
          />
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
  );
}

/**
 * The side navigation (DESIGN.md, "Layout"), GitHub-like: a "Project" section with the project's
 * pages and a "Workspace" section with All projects and Data health, each under a small muted
 * heading; the full list or the icon rail (each entry's label then shows as a tooltip and stays
 * the link's name). The toggle is at the top, in the top bar (`SidebarToggle`); the bottom keeps
 * only the connection and server status.
 */
export function Sidebar({
  route,
  projectId,
  stream,
  collapsed,
}: {
  route: Route;
  /** The project the project pages link to; null hides the project section. */
  projectId: string | null;
  stream: StreamState;
  collapsed: boolean;
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
        <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-2 py-3">
          {projectId !== null ? (
            <Section heading={N.project} collapsed={collapsed} first>
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
            </Section>
          ) : null}
          <Section heading={N.workspace} collapsed={collapsed} first={projectId === null}>
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
          </Section>
        </div>
        <Footer stream={stream} collapsed={collapsed} />
      </nav>
    </div>
  );
}
