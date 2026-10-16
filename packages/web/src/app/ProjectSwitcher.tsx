import type { ProjectDto } from '@acp/core/api';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { CheckIcon, ChevronDownIcon, GridIcon, PlusSmallIcon } from '../components/icons';
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
      className={`flex shrink-0 items-center justify-center rounded-md bg-accent-soft font-semibold text-accent ${
        size === 'sm' ? 'size-5 text-[0.6875rem]' : 'size-6 text-caption'
      }`}
    >
      {initial}
    </span>
  );
}

/**
 * The top bar's project switcher: a button showing the current project, opening a menu of
 * projects plus All projects and New project. Arrow keys move through the menu, Esc closes it and
 * returns focus to the button.
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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
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
    menuRef.current?.querySelector<HTMLElement>('[aria-current="true"], a')?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpenOn(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('a') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      items[e.key === 'Home' ? 0 : items.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  const itemClass = (selected: boolean) =>
    `flex items-center gap-3 rounded-control px-2.5 py-2 text-ink no-underline outline-none hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-none ${
      selected ? 'bg-accent-soft/60' : ''
    }`;

  return (
    <div className="relative min-w-0">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={C.button(label)}
        data-testid="project-switcher"
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="flex h-9 max-w-80 min-w-0 items-center gap-2 rounded-control border border-line bg-panel pr-2 pl-2 text-ink shadow-card transition-colors hover:border-line-strong hover:bg-sunken"
      >
        {onAllProjects || !current ? (
          <span className="flex size-6 shrink-0 items-center justify-center text-dim">
            <GridIcon size={16} />
          </span>
        ) : (
          <ProjectMark name={current.name} />
        )}
        <span className="min-w-0 truncate font-medium">{label}</span>
        <ChevronDownIcon size={16} className="shrink-0 text-dim" />
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="navigation"
          aria-label={C.menu}
          onKeyDown={onMenuKey}
          className="absolute top-11 left-0 z-50 w-80 rounded-card border border-line bg-panel p-1.5 shadow-pop"
        >
          <p className="px-2.5 pt-1.5 pb-1 text-caption font-medium tracking-wide text-dim uppercase">
            {C.yourProjects}
          </p>
          {projects === undefined || projects.length === 0 ? (
            <p className="px-2.5 py-2 text-dim">{projects === undefined ? '…' : C.empty}</p>
          ) : (
            <ul className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
              {projects.map((p) => {
                const selected = p.id === currentId && !onAllProjects;
                return (
                  <li key={p.id}>
                    <a
                      href={switchTarget(route, p.id)}
                      aria-current={selected ? 'true' : undefined}
                      className={itemClass(selected)}
                    >
                      <ProjectMark name={p.name} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{p.name}</span>
                        <span className="block truncate font-mono text-caption text-dim" dir="ltr">
                          {p.rootPath}
                        </span>
                      </span>
                      {selected ? <CheckIcon size={16} className="shrink-0 text-accent" /> : null}
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="my-1.5 border-t border-line" />
          <a href={href.projects()} className={itemClass(false)}>
            <span className="flex size-6 items-center justify-center text-dim">
              <GridIcon size={16} />
            </span>
            {C.allProjects}
          </a>
          <a href={href.newProject()} className={itemClass(false)}>
            <span className="flex size-6 items-center justify-center text-dim">
              <PlusSmallIcon size={16} />
            </span>
            {C.newProject}
          </a>
        </div>
      ) : null}
    </div>
  );
}
