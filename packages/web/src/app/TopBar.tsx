import type { ProjectDto } from '@acp/core/api';
import { BrandLogo } from '../components/BrandMark';
import { SearchIcon } from '../components/icons';
import { ThemeMenu } from '../components/ThemeSwitch';
import { APP_NAME, SHELL_COPY, SHELL_FRAME_COPY } from '../lib/copy';
import { href, type Route } from '../lib/router';
import { crumbsFor } from './nav';
import { ProjectSwitcher } from './ProjectSwitcher';
import { ShellTooltip } from './ShellTooltip';

/** The top bar's bordered icon button (the theme menu), like GitHub's. */
const headerIconButton =
  'inline-flex size-9 shrink-0 items-center justify-center rounded-control border border-header-line text-header-dim transition-colors hover:bg-header-hover hover:text-header-ink';

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
    <nav aria-label={SHELL_FRAME_COPY.breadcrumb} className="flex min-w-0 items-center">
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
 * The top bar (DESIGN.md, "Layout"; v0.3.0 C-S), 56px and dark in both themes like GitHub's
 * header, in three parts:
 * - left: the Control Core and the short name "ACP", linking home (the full name is the tooltip
 *   and the link's name);
 * - centre: the ⌘K search, wide and centred on the bar (the two sides share the rest equally, so
 *   it stays in the middle); on a narrow screen an icon button;
 * - right: the trail (the project switcher, then the page) and the theme menu.
 *
 * The sidebar toggle is on the sidebar itself (`SidebarToggle`).
 */
export function TopBar({
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
      data-topbar=""
      className="sticky top-0 z-30 flex h-topbar items-center gap-2 border-b border-header-line bg-header px-3 text-header-ink sm:px-4 md:gap-4"
    >
      <div className="flex shrink-0 items-center md:min-w-0 md:flex-1 md:basis-0">
        <ShellTooltip content={APP_NAME} side="bottom" align="start">
          <a
            href={href.home()}
            aria-label={SHELL_COPY.topBar.home}
            className="flex min-w-0 items-center rounded-control py-1 text-header-ink no-underline"
          >
            <BrandLogo size={28} shortName={SHELL_FRAME_COPY.shortName} />
          </a>
        </ShellTooltip>
      </div>
      {/* The search: 320px at md, 448px from lg, 544px from xl and 640px from 1440px. */}
      <div className="ml-auto flex shrink-0 justify-center md:ml-0 md:w-80 md:shrink lg:w-[28rem] xl:w-[34rem] min-[90rem]:w-[40rem]">
        <button
          type="button"
          onClick={onOpenPalette}
          data-testid="open-palette"
          aria-keyshortcuts="Meta+K Control+K"
          className="flex size-9 items-center justify-center gap-2 rounded-control border border-header-line text-header-dim transition-colors hover:border-header-dim hover:text-header-ink md:w-full md:justify-start md:pr-1.5 md:pl-3"
        >
          <SearchIcon size={16} className="shrink-0" />
          <span className="sr-only min-w-0 flex-1 truncate text-left md:not-sr-only">
            {SHELL_COPY.palette.open}
          </span>
          <kbd className="hidden rounded-[4px] border border-header-line px-1.5 font-sans text-micro leading-5 text-header-dim md:inline">
            {SHELL_COPY.palette.shortcut}
          </kbd>
        </button>
      </div>
      <div className="flex min-w-0 items-center justify-end gap-2 md:flex-1 md:basis-0">
        <Breadcrumbs route={route} projects={projects} currentId={currentId} />
        <ThemeMenu
          className={`${headerIconButton} aria-expanded:bg-header-hover aria-expanded:text-header-ink`}
          wrap={(button) => (
            <ShellTooltip content={SHELL_COPY.theme.tip} side="bottom" align="end" describe>
              {button}
            </ShellTooltip>
          )}
        />
      </div>
    </header>
  );
}
