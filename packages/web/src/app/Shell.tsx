import type { ComponentType, ReactNode } from 'react';
import { DemoBanner } from '../components/DemoBanner';
import { ErrorNotice } from '../components/ErrorNotice';
import {
  HealthIcon,
  MonitorIcon,
  MoonIcon,
  OverviewIcon,
  ProjectsIcon,
  SessionsIcon,
  SetupIcon,
  SunIcon,
  TokensIcon,
  type IconProps,
} from '../components/icons';
import { Tooltip } from '../components/Tooltip';
import { BoardIcon } from '../features/board/icons';
import { ControlIcon } from '../features/control/bits';
import { paths, schemas } from '../lib/api';
import { APP_NAME, BOARD_COPY, CONNECTION_COPY, CONTROL_COPY, NAV_LABELS } from '../lib/copy';
import { useApiQuery } from '../lib/query';
import { href, type Route } from '../lib/router';
import { useTheme, type ThemePreference } from '../lib/theme';
import type { StreamState } from '../lib/useEventStream';

interface NavItem {
  label: string;
  to: string;
  icon: ComponentType<IconProps>;
  match: readonly Route['name'][];
}

const PRIMARY: readonly NavItem[] = [
  { label: BOARD_COPY.nav, to: href.board(), icon: BoardIcon, match: ['board'] },
  { label: NAV_LABELS.overview, to: href.home(), icon: OverviewIcon, match: ['home'] },
  { label: CONTROL_COPY.nav, to: href.control(), icon: ControlIcon, match: ['control'] },
  {
    label: NAV_LABELS.sessions,
    to: href.sessions(),
    icon: SessionsIcon,
    match: ['sessions', 'session'],
  },
  { label: NAV_LABELS.tokens, to: href.usage(), icon: TokensIcon, match: ['usage'] },
];
const PROJECTS: NavItem = {
  label: NAV_LABELS.projects,
  to: href.projects(),
  icon: ProjectsIcon,
  match: ['projects', 'project-new'],
};
const SECONDARY: readonly NavItem[] = [
  { label: NAV_LABELS.setup, to: href.setup(), icon: SetupIcon, match: ['setup'] },
  { label: NAV_LABELS.health, to: href.health(), icon: HealthIcon, match: ['health'] },
];

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

const itemClass = (active: boolean) =>
  `flex items-center gap-3 rounded-control px-3 py-2 no-underline transition-colors focus-visible:-outline-offset-2 max-lg:justify-center ${
    active ? 'bg-accent-soft font-medium text-accent' : 'text-dim hover:bg-sunken hover:text-ink'
  }`;

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <a
      href={item.to}
      aria-current={active ? 'page' : undefined}
      className={itemClass(active)}
      title={item.label}
    >
      <Icon className="shrink-0" />
      <span className="truncate max-lg:sr-only">{item.label}</span>
    </a>
  );
}

function ProjectLinks({ route }: { route: Route }) {
  const projects = useApiQuery(paths.projects(), schemas.projects);
  if (projects.data === undefined) return null;
  if (projects.data.length === 0) {
    return (
      <p className="py-1 pr-2 pl-11 text-caption text-dim max-lg:hidden">
        None yet. <a href={href.setup()}>Add one</a>
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-0.5 max-lg:hidden" aria-label="Your projects">
      {projects.data.map((p) => {
        const active =
          (route.name === 'project' || route.name === 'project-settings') && route.id === p.id;
        return (
          <li key={p.id}>
            <a
              href={href.project(p.id)}
              aria-current={active ? 'page' : undefined}
              title={p.rootPath}
              className={`block truncate rounded-control py-1.5 pr-3 pl-11 no-underline focus-visible:-outline-offset-2 ${
                active
                  ? 'bg-accent-soft font-medium text-accent'
                  : 'text-dim hover:bg-sunken hover:text-ink'
              }`}
            >
              {p.name}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function Footer({ stream }: { stream: StreamState }) {
  const health = useApiQuery(paths.health(), schemas.health);
  const theme = useTheme();
  const unreachable = health.data === undefined && health.error?.kind === 'unreachable';
  const connection = CONNECTION_COPY[stream.status];
  const ThemeIcon = THEME_ICON[theme.preference];
  const themeWord =
    theme.preference === 'system'
      ? `System (${theme.resolved === 'dark' ? 'dark' : 'light'})`
      : THEME_WORD[theme.preference];

  return (
    <div className="flex flex-col gap-2 border-t border-line px-3 pt-3 text-caption text-dim max-lg:items-center">
      <Tooltip content={connection.tip}>
        <span className="inline-flex items-center gap-2" data-testid="connection-status">
          <span
            aria-hidden="true"
            className={`inline-block size-2 rounded-full ${DOT[stream.status]}`}
          />
          <span className="max-lg:sr-only">{connection.word}</span>
        </span>
      </Tooltip>
      <span data-testid="server-status" className="max-lg:sr-only">
        {health.data
          ? `Server ${health.data.version} · ${health.data.mode} mode`
          : unreachable
            ? 'Server not reachable'
            : health.error
              ? 'Server error'
              : 'Checking the server…'}
      </span>
      {stream.invalidNotices > 0 ? (
        <span className="text-danger max-lg:sr-only" title={stream.lastInvalidNotice ?? ''}>
          {stream.invalidNotices} invalid live update
          {stream.invalidNotices === 1 ? '' : 's'} ignored
        </span>
      ) : null}
      <button
        type="button"
        onClick={theme.cycle}
        aria-label={`Theme: ${themeWord}. Change theme`}
        title="Change theme: system → light → dark"
        className="inline-flex items-center gap-2 self-start rounded-control px-1 py-1 text-dim hover:bg-sunken hover:text-ink max-lg:self-center"
      >
        <ThemeIcon size={16} />
        <span className="max-lg:sr-only">Theme: {themeWord}</span>
      </button>
    </div>
  );
}

/**
 * App frame (DESIGN.md, Layout): icon sidebar on the left (Overview, Sessions, Tokens, Projects
 * with the registered projects underneath; Setup and Data health at the bottom; live-connection
 * dot and theme toggle in the footer), the demo banner and the page on the right. Below 1024px the
 * sidebar collapses to icons.
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
  const mode = capabilities.data?.mode ?? health.data?.mode;
  const unreachable = health.data === undefined && health.error?.kind === 'unreachable';
  const isActive = (item: NavItem) => item.match.includes(route.name);

  return (
    <div className="flex min-h-full">
      {/* The outer column paints the sidebar full height; the nav inside stays in view (sticky). */}
      <div className="w-sidebar-collapsed shrink-0 border-r border-line bg-panel lg:w-sidebar">
        <nav
          aria-label="Main"
          className="sticky top-0 flex h-screen flex-col gap-1 py-4 max-lg:px-2 lg:px-3"
        >
          <a
            href={href.home()}
            className="mb-4 flex items-center gap-2.5 px-3 font-semibold text-ink no-underline max-lg:justify-center max-lg:px-0"
          >
            <span
              aria-hidden="true"
              className="flex size-7 shrink-0 items-center justify-center rounded-control bg-accent text-caption font-bold text-accent-ink"
            >
              AC
            </span>
            <span className="truncate max-lg:sr-only">{APP_NAME}</span>
          </a>
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
            {PRIMARY.map((item) => (
              <NavLink key={item.to} item={item} active={isActive(item)} />
            ))}
            <NavLink item={PROJECTS} active={isActive(PROJECTS)} />
            <ProjectLinks route={route} />
          </div>
          <div className="flex flex-col gap-0.5 pt-2 pb-3">
            {SECONDARY.map((item) => (
              <NavLink key={item.to} item={item} active={isActive(item)} />
            ))}
          </div>
          <Footer stream={stream} />
        </nav>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <DemoBanner mode={mode} />
        <main className="mx-auto w-full max-w-content min-w-0 flex-1 px-6 py-8 lg:px-10">
          {unreachable && health.error ? <ErrorNotice error={health.error} /> : children}
        </main>
      </div>
    </div>
  );
}
