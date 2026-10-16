import type { ProjectDto } from '@acp/core/api';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
} from 'react';
import { PROJECT_PAGES } from '../../app/project-pages';
import {
  ArrowRightIcon,
  GridIcon,
  HarnessIcon,
  HealthIcon,
  PlusSmallIcon,
  ProjectsIcon,
  SearchIcon,
  TicketIcon,
  type IconProps,
} from '../../components/icons';
import { boardPaths, boardSchemas } from '../../lib/api';
import { PALETTE_COPY } from '../../lib/copy';
import { useApiQuery, useQueryStore } from '../../lib/query';
import { href, navigate } from '../../lib/router';
import { mainCheckRunsFor } from '../harness/main-check-runs';
import { buildCommands, filterCommands, type Command, type CommandGroup } from './commands';

const C = PALETTE_COPY;

const GROUP_ICON: Record<CommandGroup, ComponentType<IconProps>> = {
  actions: PlusSmallIcon,
  pages: GridIcon,
  projects: ProjectsIcon,
  tickets: TicketIcon,
};

function pageIcon(c: Command): ComponentType<IconProps> {
  if (c.id === 'page:health' || c.id === 'page:connection') return HealthIcon;
  if (c.id === 'action:run-checks') return HarnessIcon;
  const id = c.id.startsWith('page:') ? c.id.slice(5) : null;
  return PROJECT_PAGES.find((p) => p.id === id)?.icon ?? GROUP_ICON[c.group];
}

/**
 * The ⌘K command palette (DESIGN.md, "Command palette"): a modal dialog with one search field
 * (`role="combobox"`) over a listbox of results. Keyboard first: ↑/↓ move, Enter opens, Esc
 * closes, Tab stays in the dialog, and focus returns to whatever opened it. Tickets come from the
 * current project's board (the existing `GET /api/board`).
 */
export function CommandPalette({
  projects,
  current,
  onClose,
  onNewTicket,
}: {
  projects: readonly ProjectDto[];
  current: { id: string; name: string } | null;
  onClose: () => void;
  onNewTicket: (projectId: string) => void;
}) {
  const store = useQueryStore();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const titleId = useId();
  const board = useApiQuery(
    current === null ? null : boardPaths.board(current.id),
    boardSchemas.board,
  );

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const commands = useMemo(() => {
    const tickets = (board.data?.columns ?? [])
      .flatMap((c) => c.tickets)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return buildCommands({ projects, current, pages: PROJECT_PAGES, tickets });
  }, [board.data, projects, current]);
  const results = useMemo(() => filterCommands(commands, query), [commands, query]);
  const selected = Math.min(active, Math.max(results.length - 1, 0));
  const optionId = (i: number) => `${listId}-${i}`;

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`);
    // jsdom has no layout, so no scrollIntoView there.
    if (typeof el?.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const run = (c: Command | undefined) => {
    if (c === undefined) return;
    onClose();
    if (c.action.kind === 'go') navigate(c.action.hash);
    else if (c.action.kind === 'run-checks') {
      // The run lives in the store, so the Harness page shows it while it runs and after.
      void mainCheckRunsFor(store).start(c.action.projectId);
      navigate(href.projectPage(c.action.projectId, 'harness'));
    } else onNewTicket(c.action.projectId);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Tab') {
      // The search field is the dialog's only stop: keep focus inside.
      e.preventDefault();
      inputRef.current?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((selected + step + results.length) % results.length);
    } else if (e.key === 'Home' || e.key === 'End') {
      if (results.length === 0) return;
      e.preventDefault();
      setActive(e.key === 'Home' ? 0 : results.length - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(results[selected]);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[rgb(15_15_20/0.4)] px-4 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="command-palette"
        onKeyDown={onKeyDown}
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-card border border-line bg-panel shadow-pop"
      >
        <h2 id={titleId} className="sr-only">
          {C.title}
        </h2>
        <div className="flex items-center gap-3 border-b border-line px-4">
          <SearchIcon size={18} className="shrink-0 text-dim" />
          <input
            ref={inputRef}
            role="combobox"
            aria-label={C.input}
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={results.length > 0 ? optionId(selected) : undefined}
            placeholder={C.placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            className="h-14 min-w-0 flex-1 border-0 bg-transparent text-title text-ink outline-none focus-visible:outline-none"
          />
          <kbd className="rounded border border-line bg-sunken px-1.5 py-0.5 font-sans text-caption text-dim">
            Esc
          </kbd>
        </div>
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={C.results}
          className="min-h-0 flex-1 overflow-y-auto p-2"
        >
          {results.map((c, i) => {
            // Results come in group order: a heading starts each group.
            const heading = results[i - 1]?.group !== c.group ? C.groups[c.group] : null;
            const Icon = pageIcon(c);
            const isActive = i === selected;
            return (
              <li key={c.id} role="presentation">
                {heading ? (
                  <div
                    role="presentation"
                    className="px-3 pt-3 pb-1.5 text-caption font-medium tracking-wide text-dim uppercase first:pt-1"
                  >
                    {heading}
                  </div>
                ) : null}
                <div
                  role="option"
                  id={optionId(i)}
                  aria-selected={isActive}
                  data-index={i}
                  data-command={c.id}
                  onMouseMove={() => {
                    if (!isActive) setActive(i);
                  }}
                  onClick={() => run(c)}
                  className={`flex cursor-pointer items-center gap-3 rounded-control px-3 py-2 ${
                    isActive ? 'bg-accent-soft text-ink' : 'text-ink'
                  }`}
                >
                  <span
                    className={`flex size-8 shrink-0 items-center justify-center rounded-control border ${
                      isActive
                        ? 'border-accent/30 bg-panel text-accent'
                        : 'border-line bg-sunken text-dim'
                    }`}
                  >
                    <Icon size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate font-medium ${c.group === 'tickets' ? 'font-mono text-caption' : ''}`}
                    >
                      {c.label}
                    </span>
                    {c.hint ? (
                      <span className="block truncate text-caption text-dim">{c.hint}</span>
                    ) : null}
                  </span>
                  {isActive ? <ArrowRightIcon size={16} className="shrink-0 text-accent" /> : null}
                </div>
              </li>
            );
          })}
        </ul>
        {results.length === 0 ? (
          <p role="status" className="px-6 pb-8 text-center text-dim">
            {C.none}
          </p>
        ) : null}
        <div className="flex items-center justify-between gap-3 border-t border-line bg-sunken/60 px-4 py-2 text-caption text-dim">
          <span>{C.hint}</span>
          {current !== null && board.data === undefined && board.error === null ? (
            <span>{C.loadingTickets}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
