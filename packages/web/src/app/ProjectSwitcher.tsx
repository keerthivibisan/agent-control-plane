import type { ProjectDto } from '@acp/core/api';
import * as RadixMenu from '@radix-ui/react-dropdown-menu';
import { ChevronsUpDown } from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { CheckIcon, GridIcon, PlusSmallIcon } from '../components/icons';
import { floatingClass, MenuLabel, MenuSeparator } from '../components/Menu';
import { SHELL_COPY } from '../lib/copy';
import { href, type Route } from '../lib/router';
import { isProjectPageAvailable } from './project-pages';

const C = SHELL_COPY.switcher;

/**
 * Where switching to `projectId` goes: the same project page when you are on one (Tokens stays
 * Tokens), else the project's board. Query parameters belong to the old project and are dropped.
 */
export function switchTarget(route: Route, projectId: string): string {
  if (route.name === 'project' && isProjectPageAvailable(route.page)) {
    return href.projectPage(projectId, route.page);
  }
  return href.board(projectId);
}

/** A project's initial on a soft square, so the switcher reads at a glance. */
export function ProjectMark({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? '?';
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-[5px] bg-accent-soft font-semibold text-accent ${
        size === 'sm' ? 'size-5 text-micro' : 'size-6 text-caption'
      }`}
    >
      {initial}
    </span>
  );
}

const itemClass = (selected: boolean) =>
  `flex items-center gap-2.5 rounded-control px-2 py-1.5 text-ink no-underline outline-none select-none data-[highlighted]:bg-hover focus-visible:outline-none ${
    selected ? 'bg-accent-soft/50' : ''
  }`;

/**
 * One entry of the switcher: a real link (Radix gives it the menu's arrow keys, typeahead and
 * close-on-choose; `role` undefined keeps it a link, as the navigation it sits in expects).
 */
function SwitchLink({
  to,
  current = false,
  children,
}: {
  to: string;
  current?: boolean;
  children: ReactNode;
}) {
  return (
    <RadixMenu.Item asChild role={undefined}>
      <a href={to} aria-current={current ? 'true' : undefined} className={itemClass(current)}>
        {children}
      </a>
    </RadixMenu.Item>
  );
}

/**
 * The top bar's project switcher: a button showing the current project, opening a navigation of
 * projects plus All projects and New project (Radix DropdownMenu, so it is positioned, dismissed
 * and keyboard-driven like every menu). Focus starts on the current project; arrow keys, Home and
 * End move, Esc closes it and returns focus to the button, Tab closes it.
 *
 * It composes Radix directly instead of the shared `Menu`: its entries are links in a
 * `navigation` (they change the address), where the shared Menu's are `menuitem` actions.
 */
export function ProjectSwitcher({
  projects,
  currentId,
  route,
}: {
  projects: readonly ProjectDto[] | undefined;
  /** The project in view or remembered; null on All projects or when there is none. */
  currentId: string | null;
  route: Route;
}) {
  // Open "for" the route it was opened on: any navigation (a click in the menu, Back) gives a new
  // route object, which closes the menu without an effect.
  const [openOn, setOpenOn] = useState<Route | null>(null);
  const open = openOn === route;
  const setOpen = (next: boolean) => setOpenOn(next ? route : null);
  const contentRef = useRef<HTMLDivElement>(null);
  const current = currentId === null ? null : projects?.find((p) => p.id === currentId);
  const onAllProjects = route.name === 'projects';
  const label = onAllProjects
    ? C.allProjects
    : currentId === null
      ? C.none
      : current
        ? current.name
        : projects === undefined
          ? '…'
          : C.unknown;

  useEffect(() => {
    if (!open) return;
    // Radix focuses the menu (or its first entry) as it opens; start on the current project.
    const t = window.setTimeout(() => {
      contentRef.current?.querySelector<HTMLElement>('[aria-current="true"], a')?.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [open]);

  return (
    <RadixMenu.Root open={open} onOpenChange={setOpen} modal={false}>
      <RadixMenu.Trigger
        asChild
        // A disclosure of links, not a menu of actions.
        aria-haspopup={undefined}
        // Radix opens on pointerdown and on keys; a click with no pointer behind it (assistive
        // tech, `element.click()`) toggles it too.
        onClick={(e: MouseEvent) => {
          if (e.detail === 0) setOpen(!open);
        }}
      >
        <button
          type="button"
          aria-label={C.button(label)}
          data-testid="project-switcher"
          className="flex h-8 max-w-72 min-w-0 items-center gap-2 rounded-control px-1.5 text-ink transition-colors hover:bg-hover aria-expanded:bg-hover"
        >
          {onAllProjects || !current ? (
            <span className="flex size-5 shrink-0 items-center justify-center text-dim">
              <GridIcon size={16} />
            </span>
          ) : (
            <ProjectMark name={current.name} size="sm" />
          )}
          <span className="min-w-0 truncate font-medium">{label}</span>
          <ChevronsUpDown
            size={14}
            strokeWidth={1.75}
            aria-hidden="true"
            focusable="false"
            className="shrink-0 text-dim"
          />
        </button>
      </RadixMenu.Trigger>
      <RadixMenu.Portal>
        <RadixMenu.Content
          ref={contentRef}
          role="navigation"
          aria-label={C.menu}
          aria-labelledby={undefined}
          aria-orientation={undefined}
          align="start"
          sideOffset={6}
          collisionPadding={8}
          loop
          onKeyDown={(e) => {
            // Radix keeps Tab inside a menu; this one closes, as it did before.
            if (e.key === 'Tab') setOpen(false);
          }}
          className={`${floatingClass} flex w-80 max-w-[calc(100vw-1rem)] flex-col p-1 focus:outline-none`}
        >
          <MenuLabel>{C.yourProjects}</MenuLabel>
          {projects === undefined || projects.length === 0 ? (
            <p className="px-2.5 py-2 text-dim">{projects === undefined ? '…' : C.empty}</p>
          ) : (
            <ul className="flex max-h-80 flex-col gap-px overflow-y-auto">
              {projects.map((p) => {
                const selected = p.id === currentId && !onAllProjects;
                return (
                  <li key={p.id}>
                    <SwitchLink to={switchTarget(route, p.id)} current={selected}>
                      <ProjectMark name={p.name} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{p.name}</span>
                        <span className="block truncate font-mono text-micro text-dim" dir="ltr">
                          {p.rootPath}
                        </span>
                      </span>
                      {selected ? <CheckIcon size={16} className="shrink-0 text-accent" /> : null}
                    </SwitchLink>
                  </li>
                );
              })}
            </ul>
          )}
          <MenuSeparator />
          <SwitchLink to={href.projects()}>
            <span className="flex size-6 items-center justify-center text-dim">
              <GridIcon size={16} />
            </span>
            {C.allProjects}
          </SwitchLink>
          <SwitchLink to={href.newProject()}>
            <span className="flex size-6 items-center justify-center text-dim">
              <PlusSmallIcon size={16} />
            </span>
            {C.newProject}
          </SwitchLink>
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  );
}
