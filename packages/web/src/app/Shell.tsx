import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { DemoBanner } from '../components/DemoBanner';
import { ErrorNotice } from '../components/ErrorNotice';
import { NewTicketDialog } from '../features/board/NewTicketDialog';
import { CommandPalette } from '../features/palette/CommandPalette';
import { paths, schemas } from '../lib/api';
import { useApiQuery } from '../lib/query';
import { href, navigate, routeProjectId, type Route } from '../lib/router';
import type { StreamState } from '../lib/useEventStream';
import { readLastProject, rememberLastProject, validLastProject } from './last-project';
import { pageKey } from './nav';
import { PageTransition } from './PageTransition';
import { ShellTooltipProvider } from './ShellTooltip';
import { Sidebar } from './Sidebar';
import { useSidebar } from './sidebar-state';
import { TopBar } from './TopBar';

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
 * App frame (DESIGN.md, "Layout"): a top bar (brand, the project / page trail with the project
 * switcher, ⌘K, theme), the project sidebar (the project's pages, then All projects and Data
 * health; the full list or an icon rail, toggled with its button or ⌘B/Ctrl+B and remembered per
 * browser, the rail by default at 1280px and below; the live-connection dot at the bottom), the
 * demo banner and the page.
 *
 * The bar is 48px: the shell sets `--spacing-topbar` for everything under it (the sticky sidebar
 * and demo banner use it), so they follow without a token change.
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
  const sidebar = useSidebar();

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
  // "New ticket" opens its dialog as the palette closes; the shared Dialog leaves focus in the new
  // one, which gives it back to the palette's opener when it closes.
  const openNewTicket = useCallback((projectId: string) => setNewTicketFor(projectId), []);

  return (
    <ShellTooltipProvider>
      <div className="flex min-h-full flex-col [--spacing-topbar:3rem]">
        <TopBar
          route={route}
          projects={projects.data}
          currentId={contextId}
          collapsed={sidebar.collapsed}
          onOpenPalette={() => setPaletteOpen(true)}
        />
        <div className="flex min-h-0 flex-1">
          <Sidebar
            route={route}
            projectId={contextId}
            stream={stream}
            collapsed={sidebar.collapsed}
            onToggle={sidebar.toggle}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <DemoBanner mode={mode} />
            <main className="mx-auto w-full max-w-content min-w-0 flex-1 px-6 py-8 wide:px-10">
              <PageTransition pageKey={pageKey(route)}>
                {unreachable && health.error ? <ErrorNotice error={health.error} /> : children}
              </PageTransition>
            </main>
          </div>
        </div>
        {paletteOpen ? (
          <CommandPalette
            projects={projects.data ?? []}
            current={contextProject ? { id: contextProject.id, name: contextProject.name } : null}
            onClose={() => setPaletteOpen(false)}
            onNewTicket={openNewTicket}
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
    </ShellTooltipProvider>
  );
}
