import type { ProjectDto } from '@acp/core/api';
import type { ComponentType } from 'react';
import { BrandLogo } from '../components/BrandMark';
import { MonitorIcon, MoonIcon, SearchIcon, SunIcon, type IconProps } from '../components/icons';
import { SHELL_COPY, SHELL_FRAME_COPY } from '../lib/copy';
import { href, type Route } from '../lib/router';
import { useTheme, type ThemePreference } from '../lib/theme';
import { crumbsFor } from './nav';
import { ProjectSwitcher } from './ProjectSwitcher';
import { ShellTooltip } from './ShellTooltip';
import { sidebarWidthClass } from './Sidebar';

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

function ThemeToggle() {
  const theme = useTheme();
  const Icon = THEME_ICON[theme.preference];
  const word =
    theme.preference === 'system'
      ? `System (${theme.resolved === 'dark' ? 'dark' : 'light'})`
      : THEME_WORD[theme.preference];
  return (
    <ShellTooltip content={SHELL_COPY.theme.tip} side="bottom" align="end" describe>
      <button
        type="button"
        onClick={theme.cycle}
        aria-label={SHELL_COPY.theme.label(word)}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-control text-dim transition-colors hover:bg-hover hover:text-ink"
      >
        <Icon size={16} />
      </button>
    </ShellTooltip>
  );
}

/** A slanted hairline between crumbs (no text, so it adds nothing to the bar's words). */
function Slash() {
  return (
    <li aria-hidden="true" className="flex h-5 w-3 shrink-0 items-center justify-center">
      <span className="h-4 w-px rotate-[18deg] bg-line-strong" />
    </li>
  );
}

function Breadcrumbs({
  route,
  projects,
  currentId,
}: {
  route: Route;
  projects: readonly ProjectDto[] | undefined;
  currentId: string | null;
}) {
  const crumbs = crumbsFor(route, currentId);
  return (
    <nav aria-label={SHELL_FRAME_COPY.breadcrumb} className="flex min-w-0 flex-1 items-center">
      <ol className="flex min-w-0 items-center gap-1">
        <li className="min-w-0 shrink">
          <ProjectSwitcher projects={projects} currentId={currentId} route={route} />
        </li>
        {crumbs.map((c) => (
          <CrumbItem key={`${c.label}:${c.to ?? ''}`} label={c.label} to={c.to} />
        ))}
      </ol>
    </nav>
  );
}

function CrumbItem({ label, to }: { label: string; to: string | null }) {
  return (
    <>
      <Slash />
      <li className="flex min-w-0 shrink-[2] items-center">
        {to === null ? (
          <span aria-current="page" className="truncate px-1.5 font-medium text-ink">
            {label}
          </span>
        ) : (
          <a
            href={to}
            className="truncate rounded-control px-1.5 py-1 text-dim no-underline transition-colors hover:bg-hover hover:text-ink"
          >
            {label}
          </a>
        )}
      </li>
    </>
  );
}

/**
 * The top bar (DESIGN.md, "Layout"): the brand cell over the sidebar, the trail (project
 * switcher, then the page), the ⌘K search and the theme toggle.
 */
export function TopBar({
  route,
  projects,
  currentId,
  collapsed,
  onOpenPalette,
}: {
  route: Route;
  projects: readonly ProjectDto[] | undefined;
  currentId: string | null;
  /** The sidebar is the icon rail: the brand cell narrows with it. */
  collapsed: boolean;
  onOpenPalette: () => void;
}) {
  return (
    <header
      aria-label={SHELL_COPY.topBar.label}
      className="sticky top-0 z-30 flex h-topbar items-center border-b border-line bg-canvas/85 backdrop-blur-md"
    >
      <div
        className={`flex h-full items-center border-r border-line bg-sidebar ${sidebarWidthClass(collapsed)} ${
          collapsed ? 'justify-center' : 'px-4'
        }`}
      >
        <a
          href={href.home()}
          aria-label={SHELL_COPY.topBar.home}
          className="flex min-w-0 items-center rounded-control text-ink no-underline"
        >
          <BrandLogo size={24} hideName={collapsed} />
        </a>
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 px-3 wide:px-4">
        <Breadcrumbs route={route} projects={projects} currentId={currentId} />
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onOpenPalette}
            data-testid="open-palette"
            aria-keyshortcuts="Meta+K Control+K"
            className="flex h-8 items-center gap-2 rounded-control border border-line bg-panel pr-1 pl-2.5 text-dim shadow-card transition-colors hover:border-line-strong hover:text-ink"
          >
            <SearchIcon size={15} />
            <span className="hidden w-40 truncate text-left md:inline lg:w-52">
              {SHELL_COPY.palette.open}
            </span>
            <kbd className="rounded-[4px] border border-line bg-sunken px-1.5 font-sans text-micro leading-5 text-dim">
              {SHELL_COPY.palette.shortcut}
            </kbd>
          </button>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
