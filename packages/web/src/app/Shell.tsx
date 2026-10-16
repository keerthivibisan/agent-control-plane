import type { ProjectDto } from '@acp/core/api';
import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { DemoBanner } from '../components/DemoBanner';
import { ErrorNotice } from '../components/ErrorNotice';
import {
  GridIcon,
  HealthIcon,
  MonitorIcon,
  MoonIcon,
  SearchIcon,
  SunIcon,
  type IconProps,
} from '../components/icons';
import { Tooltip } from '../components/Tooltip';
import { NewTicketDialog } from '../features/board/NewTicketDialog';
import { CommandPalette } from '../features/palette/CommandPalette';
import { paths, schemas } from '../lib/api';
import { APP_NAME, CONNECTION_COPY, SHELL_COPY } from '../lib/copy';
import { useApiQuery } from '../lib/query';
import { href, navigate, routeProjectId, type Route } from '../lib/router';
import { useTheme, type ThemePreference } from '../lib/theme';
import type { StreamState } from '../lib/useEventStream';
import { readLastProject, rememberLastProject, validLastProject } from './last-project';
import { availableProjectPages, type ProjectPageDef } from './project-pages';
import { ProjectSwitcher } from './ProjectSwitcher';

const N = SHELL_COPY.nav;

const DOT: Record<StreamState['status'], string> = {
  open: 'bg-status-active',
  connecting: 'bg-status-unknown',
  reconnecting: 'bg-status-idle',
  unsupported: 'bg-status-stale',
};

const THEME_ICON: Record<ThemePreference, ComponentType<IconProps>> = {
  system: MonitorIcon,
  light: SunIcon,
  dark: MoonIcon,
};
const THEME_WORD: Record<ThemePreference, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

/** The sidebar page a route belongs to (a ticket or a run belongs to the board). */
function activePage(route: Route): ProjectPageDef['id'] | null {
  if (route.name === 'project') return route.page;
  if (route.name === 'ticket' || route.name === 'run') return 'board';
  if (route.name === 'session') return 'sessions';
  return null;
}

// --------------------------------------------------------------------------------- top bar

function ThemeToggle() {
  const theme = useTheme();
  const Icon = THEME_ICON[theme.preference];
  const word =
    theme.preference === 'system'
      ? `System (${theme.resolved === 'dark' ? 'dark' : 'light'})`
      : THEME_WORD[theme.preference];
  return (
    <button
      type="button"
      onClick={theme.cycle}
      aria-label={SHELL_COPY.theme.label(word)}
      title={SHELL_COPY.theme.tip}
      className="flex size-9 shrink-0 items-center justify-center rounded-control border border-transparent text-dim transition-colors hover:border-line hover:bg-sunken hover:text-ink"
    >
      <Icon size={18} />
    </button>
  );
}

function TopBar({
  route,
  projects,
  currentId,
  onOpenPalette,
}: {
  route: Route;
  projects: readonly ProjectDto[] | undefined;
  currentId: string | null;
  onOpenPalette: () => void;
}) {
  return (
    <header
      aria-label={SHELL_COPY.topBar.label}
      className="sticky top-0 z-30 flex h-topbar items-center gap-3 border-b border-line bg-panel/85 px-4 backdrop-blur-md wide:px-5"
    >
      <a
        href={href.home()}
        aria-label={SHELL_COPY.topBar.home}
        className="flex shrink-0 items-center gap-2.5 font-semibold text-ink no-underline"
      >
        <span
          aria-hidden="true"
          className="flex size-8 items-center justify-center rounded-[0.625rem] bg-gradient-to-br from-accent to-[color-mix(in_srgb,var(--color-accent)_60%,#ec4899)] text-caption font-bold text-accent-ink shadow-raised"
        >
          AC
        </span>
        <span className="hidden tracking-tight wide:inline">{APP_NAME}</span>
      </a>
      <span aria-hidden="true" className="mx-1 h-6 w-px bg-line" />
      <ProjectSwitcher projects={projects} currentId={currentId} route={route} />
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenPalette}
          data-testid="open-palette"
          aria-keyshortcuts="Meta+K Control+K"
          className="flex h-9 items-center gap-2 rounded-control border border-line bg-sunken/70 pr-1.5 pl-3 text-dim transition-colors hover:border-line-strong hover:text-ink"
        >
          <SearchIcon size={16} />
          <span className="hidden w-44 text-left md:inline">{SHELL_COPY.palette.open}</span>
          <kbd className="rounded border border-line bg-panel px-1.5 py-0.5 font-sans text-caption">
            {SHELL_COPY.palette.shortcut}
          </kbd>
        </button>
        <ThemeToggle />
      </div>
    </header>
  );
}

// --------------------------------------------------------------------------------- sidebar

function NavLink({
  to,
  label,
  icon: Icon,
  active,
}: {
  to: string;
  label: string;
  icon: ComponentType<IconProps>;
  active: boolean;
}) {
  return (
    <a
      href={to}
      aria-current={active ? 'page' : undefined}
      title={label}
      className={`group relative flex h-9 items-center gap-3 rounded-control px-3 no-underline transition-colors focus-visible:-outline-offset-2 max-wide:justify-center max-wide:px-0 ${
        active ? 'bg-accent-soft font-medium text-accent' : 'text-dim hover:bg-sunken hover:text-ink'
      }`}
    >
      {active ? (
        <span
          aria-hidden="true"
          className="absolute top-2 bottom-2 -left-3 w-[3px] rounded-r-full bg-accent max-wide:-left-2.5"
        />
      ) : null}
      <Icon className="shrink-0" />
      <span className="truncate max-wide:sr-only">{label}</span>
    </a>
  );
}

function Footer({ stream }: { stream: StreamState }) {
  const health = useApiQuery(paths.health(), schemas.health);
  const unreachable = health.data === undefined && health.error?.kind === 'unreachable';
  const connection = CONNECTION_COPY[stream.status];
  return (
    <div className="flex flex-col gap-1.5 border-t border-line px-3 pt-3 text-caption text-dim max-wide:items-center max-wide:px-0">
      <Tooltip content={connection.tip}>
        <span className="inline-flex items-center gap-2" data-testid="connection-status">
          <span
            aria-hidden="true"
            className={`inline-block size-2 rounded-full ${DOT[stream.status]}`}
          />
          <span className="max-wide:sr-only">{connection.word}</span>
        </span>
      </Tooltip>
      <span data-testid="server-status" className="max-wide:sr-only">
        {health.data
          ? `Server ${health.data.version} · ${health.data.mode} mode`
          : unreachable
            ? 'Server not reachable'
            : health.error
              ? 'Server error'
              : 'Checking the server…'}
      </span>
      {stream.invalidNotices > 0 ? (
        <span className="text-danger max-wide:sr-only" title={stream.lastInvalidNotice ?? ''}>
          {stream.invalidNotices} invalid live update
          {stream.invalidNotices === 1 ? '' : 's'} ignored
        </span>
      ) : null}
    </div>
  );
}

function Sidebar({
  route,
  projectId,
  stream,
}: {
  route: Route;
  /** The project the project pages link to; null hides the project section. */
  projectId: string | null;
  stream: StreamState;
}) {
  const page = activePage(route);
  const onRouteProject = routeProjectId(route) === projectId || route.name === 'session';
  return (
    <div className="w-sidebar-collapsed shrink-0 border-r border-line bg-panel wide:w-sidebar">
      <nav
        aria-label={N.label}
        className="sticky top-topbar flex h-[calc(100vh-var(--spacing-topbar))] flex-col gap-1 py-4 max-wide:px-2.5 wide:px-3"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
          {projectId !== null ? (
            <>
              <p className="px-3 pb-1.5 text-caption font-medium tracking-wide text-dim uppercase max-wide:sr-only">
                {N.project}
              </p>
              {availableProjectPages().map((p) => (
                <NavLink
                  key={p.id}
                  to={href.projectPage(projectId, p.id)}
                  label={p.label}
                  icon={p.icon}
                  active={onRouteProject && page === p.id}
                />
              ))}
              <div aria-hidden="true" className="mx-3 my-3 border-t border-line max-wide:mx-1" />
            </>
          ) : null}
          <NavLink
            to={href.projects()}
            label={N.allProjects}
            icon={GridIcon}
            active={route.name === 'projects' || route.name === 'project-new'}
          />
          <NavLink
            to={href.health()}
            label={N.health}
            icon={HealthIcon}
            active={route.name === 'health'}
          />
        </div>
        <Footer stream={stream} />
      </nav>
    </div>
  );
}

// --------------------------------------------------------------------------------- shell

/** ⌘K on macOS, Ctrl+K elsewhere: opens (or closes) the command palette from anywhere. */
function usePaletteShortcut(toggle: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);
}

/**
 * App frame (DESIGN.md, "Layout"): a top bar (app mark, project switcher, ⌘K, theme), the
 * project sidebar (the project's pages, then All projects and Data health; icons only at 1280px
 * and below; the live-connection dot at the bottom), the demo banner and the page.
 */
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
  const mode = capabilities.data?.mode ?? health.data?.mode;
  const unreachable = health.data === undefined && health.error?.kind === 'unreachable';
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [newTicketFor, setNewTicketFor] = useState<string | null>(null);

  const inRoute = routeProjectId(route);
  const known = inRoute !== null && projects.data?.some((p) => p.id === inRoute) === true;
  useEffect(() => {
    if (inRoute !== null && known) rememberLastProject(inRoute);
  }, [inRoute, known]);
  // The project in view; on global pages the last one (so its pages stay one click away).
  const contextId =
    inRoute ?? (projects.data ? validLastProject(projects.data, readLastProject()) : null);
  const contextProject = projects.data?.find((p) => p.id === contextId) ?? null;

  const togglePalette = useCallback(() => setPaletteOpen((o) => !o), []);
  usePaletteShortcut(togglePalette);

  return (
    <div className="flex min-h-full flex-col">
      <TopBar
        route={route}
        projects={projects.data}
        currentId={contextId}
        onOpenPalette={() => setPaletteOpen(true)}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar route={route} projectId={contextId} stream={stream} />
        <div className="flex min-w-0 flex-1 flex-col">
          <DemoBanner mode={mode} />
          <main className="mx-auto w-full max-w-content min-w-0 flex-1 px-6 py-8 wide:px-10">
            {unreachable && health.error ? <ErrorNotice error={health.error} /> : children}
          </main>
        </div>
      </div>
      {paletteOpen ? (
        <CommandPalette
          projects={projects.data ?? []}
          current={
            contextProject ? { id: contextProject.id, name: contextProject.name } : null
          }
          onClose={() => setPaletteOpen(false)}
          onNewTicket={setNewTicketFor}
        />
      ) : null}
      {newTicketFor !== null ? (
        <NewTicketDialog
          projectId={newTicketFor}
          onClose={() => setNewTicketFor(null)}
          onCreated={(t) => {
            setNewTicketFor(null);
            navigate(href.ticket(t));
          }}
        />
      ) : null}
    </div>
  );
}
