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
import { Dialog } from '../../components/Dialog';
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
 * The ⌘K command palette (DESIGN.md, "Command palette"): the shared modal `Dialog` with one search
 * field (`role="combobox"`) over a listbox of results. Keyboard first: ↑/↓ move, Enter opens, Esc
 * closes, Tab stays in the field, and focus returns to whatever opened it (the Dialog does that
 * just after it closes). Tickets come from the current project's board (the existing
 * `GET /api/board`).
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
  const board = useApiQuery(
    current === null ? null : boardPaths.board(current.id),
    boardSchemas.board,
  );

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

  // Escape is the Dialog's (Radix closes it and calls onClose).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab') {
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
    <Dialog title={C.title} onClose={onClose} testId="command-palette" wide>
      {/* Edge to edge under the title: the field, the results and the key hints. */}
      <div onKeyDown={onKeyDown} className="-mx-5 -mt-2 -mb-5 flex flex-col">
        <div className="flex items-center gap-2.5 border-y border-line px-5">
          <SearchIcon size={16} className="shrink-0 text-dim" />
          <input
            ref={inputRef}
            data-autofocus
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
            className="h-12 min-w-0 flex-1 border-0 bg-transparent text-title text-ink outline-none placeholder:text-dim/80 focus-visible:outline-none"
          />
          <kbd className="rounded-[4px] border border-line bg-sunken px-1.5 font-sans text-micro leading-5 text-dim">
            Esc
          </kbd>
        </div>
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={C.results}
          className="max-h-[min(26rem,56vh)] min-h-0 overflow-y-auto p-1.5 empty:hidden"
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
                    className="px-2.5 pt-3 pb-1 text-caption font-medium text-dim first:pt-1.5"
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
                  className={`flex cursor-pointer items-center gap-3 rounded-control px-2.5 py-1.5 text-ink ${
                    isActive ? 'bg-hover' : ''
                  }`}
                >
                  <span
                    className={`flex size-7 shrink-0 items-center justify-center rounded-control border transition-colors ${
                      isActive
                        ? 'border-accent/30 bg-accent-soft text-accent'
                        : 'border-line bg-panel text-dim'
                    }`}
                  >
                    <Icon size={15} />
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
                  {isActive ? <ArrowRightIcon size={15} className="shrink-0 text-accent" /> : null}
                </div>
              </li>
            );
          })}
        </ul>
        {results.length === 0 ? (
          <p role="status" className="px-6 py-10 text-center text-dim">
            {C.none}
          </p>
        ) : null}
        <div className="flex items-center justify-between gap-3 rounded-b-card border-t border-line bg-sunken/60 px-5 py-2 text-caption text-dim">
          <span>{C.hint}</span>
          {current !== null && board.data === undefined && board.error === null ? (
            <span>{C.loadingTickets}</span>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
