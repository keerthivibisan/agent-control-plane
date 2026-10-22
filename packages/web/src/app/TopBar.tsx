import type { ProjectDto } from '@acp/core/api';
import { BrandLogo } from '../components/BrandMark';
import { SearchIcon } from '../components/icons';
import { ThemeMenu } from '../components/ThemeSwitch';
import { SHELL_COPY, SHELL_FRAME_COPY } from '../lib/copy';
import { href, type Route } from '../lib/router';
import { crumbsFor } from './nav';
import { ProjectSwitcher } from './ProjectSwitcher';
import { ShellTooltip } from './ShellTooltip';
import { SidebarToggle } from './Sidebar';

/** The top bar's bordered icon buttons (the sidebar toggle, the theme menu), like GitHub's. */
const headerIconButton =
  'inline-flex size-8 shrink-0 items-center justify-center rounded-control border border-header-line text-header-dim transition-colors hover:bg-header-hover hover:text-header-ink';

/** A slanted hairline between crumbs (no text, so it adds nothing to the bar's words). */
function Slash() {
  return (
    <li aria-hidden="true" className="flex h-5 w-3 shrink-0 items-center justify-center">
      <span className="h-4 w-px rotate-[18deg] bg-header-dim/60" />
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
          <span aria-current="page" className="truncate px-1.5 font-semibold text-header-ink">
            {label}
          </span>
        ) : (
          <a
            href={to}
            className="truncate rounded-control px-1.5 py-1 text-header-dim no-underline transition-colors hover:bg-header-hover hover:text-header-ink"
          >
            {label}
          </a>
        )}
      </li>
    </>
  );
}

/**
 * The top bar (DESIGN.md, "Layout"), dark in both themes like GitHub's header: the sidebar toggle
 * over the rail's icon column, the Control Core and the wordmark, the trail (project switcher,
 * then the page), the ⌘K search and the theme menu.
 */
export function TopBar({
  route,
  projects,
  currentId,
  collapsed,
  onToggleSidebar,
  onOpenPalette,
}: {
  route: Route;
  projects: readonly ProjectDto[] | undefined;
  currentId: string | null;
  /** The sidebar is the icon rail: the wordmark gives way to the mark alone. */
  collapsed: boolean;
  onToggleSidebar: () => void;
  onOpenPalette: () => void;
}) {
  return (
    <header
      aria-label={SHELL_COPY.topBar.label}
      data-topbar=""
      className="sticky top-0 z-30 flex h-topbar items-center border-b border-header-line bg-header text-header-ink"
    >
      {/* As wide as the rail, so the toggle sits over the rail's icons. */}
      <div className="flex w-14 shrink-0 justify-center">
        <SidebarToggle
          collapsed={collapsed}
          onToggle={onToggleSidebar}
          className={headerIconButton}
        />
      </div>
      <a
        href={href.home()}
        aria-label={SHELL_COPY.topBar.home}
        className="flex min-w-0 shrink-0 items-center rounded-control text-header-ink no-underline"
      >
        <BrandLogo size={24} hideName={collapsed} />
      </a>
      <div className="flex min-w-0 flex-1 items-center gap-2 pr-3 pl-3 wide:pr-4 wide:pl-4">
        <Breadcrumbs route={route} projects={projects} currentId={currentId} />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onOpenPalette}
            data-testid="open-palette"
            aria-keyshortcuts="Meta+K Control+K"
            className="flex h-8 items-center gap-2 rounded-control border border-header-line pr-1 pl-2.5 text-header-dim transition-colors hover:border-header-dim hover:text-header-ink"
          >
            <SearchIcon size={15} />
            <span className="hidden w-40 truncate text-left md:inline lg:w-52">
              {SHELL_COPY.palette.open}
            </span>
            <kbd className="rounded-[4px] border border-header-line px-1.5 font-sans text-micro leading-5 text-header-dim">
              {SHELL_COPY.palette.shortcut}
            </kbd>
          </button>
          <ThemeMenu
            className={`${headerIconButton} aria-expanded:bg-header-hover aria-expanded:text-header-ink`}
            wrap={(button) => (
              <ShellTooltip content={SHELL_COPY.theme.tip} side="bottom" align="end" describe>
                {button}
              </ShellTooltip>
            )}
          />
        </div>
      </div>
    </header>
  );
}
