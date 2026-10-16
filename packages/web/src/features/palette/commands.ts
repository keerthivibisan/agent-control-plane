import type { ProjectPageDef } from '../../app/project-pages';
import { HARNESS_PAGE_COPY, PALETTE_COPY, SHELL_COPY } from '../../lib/copy';
import { href } from '../../lib/router';

/**
 * The ⌘K palette's entries (docs/redesign/README.md §5): jump to a project, a page of the current
 * project or a ticket by key, and two actions. Pure, so filtering and ordering are unit-tested.
 */
export type CommandGroup = 'actions' | 'pages' | 'projects' | 'tickets';

export type CommandAction =
  | { kind: 'go'; hash: string }
  | { kind: 'new-ticket'; projectId: string }
  // Redesign R-E: "Run checks" on the main branch, then open the Harness page with the result.
  | { kind: 'run-checks'; projectId: string };

export interface Command {
  id: string;
  group: CommandGroup;
  label: string;
  /** Second line: a folder, a ticket title, the project a page belongs to. */
  hint?: string;
  /** Extra words that match the query (never shown). */
  keywords?: string;
  action: CommandAction;
}

export const GROUP_ORDER: readonly CommandGroup[] = ['actions', 'pages', 'projects', 'tickets'];

/** With an empty query only the newest tickets are listed; typing searches all of them. */
const TICKETS_WHEN_EMPTY = 6;

export interface CommandInput {
  projects: readonly { id: string; name: string; rootPath: string }[];
  /** The project the shell is showing (or last showed); null when there is none. */
  current: { id: string; name: string } | null;
  pages: readonly ProjectPageDef[];
  tickets: readonly { id: string; projectId: string; key: string; title: string }[];
}

export function buildCommands({ projects, current, pages, tickets }: CommandInput): Command[] {
  const out: Command[] = [];
  if (current !== null) {
    out.push({
      id: 'action:new-ticket',
      group: 'actions',
      label: PALETTE_COPY.newTicket,
      hint: current.name,
      keywords: 'create add ticket task',
      action: { kind: 'new-ticket', projectId: current.id },
    });
  }
  // Redesign R-E: only where the Harness page exists to show the results.
  if (current !== null && pages.some((p) => p.id === 'harness' && p.available)) {
    out.push({
      id: 'action:run-checks',
      group: 'actions',
      label: HARNESS_PAGE_COPY.palette.runChecks,
      hint: current.name,
      keywords: HARNESS_PAGE_COPY.palette.keywords,
      action: { kind: 'run-checks', projectId: current.id },
    });
  }
  out.push({
    id: 'action:new-project',
    group: 'actions',
    label: PALETTE_COPY.newProject,
    keywords: 'create add project folder repository',
    action: { kind: 'go', hash: href.newProject() },
  });
  if (current !== null) {
    for (const p of pages) {
      if (!p.available) continue;
      out.push({
        id: `page:${p.id}`,
        group: 'pages',
        label: p.label,
        hint: current.name,
        action: { kind: 'go', hash: href.projectPage(current.id, p.id) },
      });
    }
  }
  out.push(
    {
      id: 'page:all-projects',
      group: 'pages',
      label: SHELL_COPY.nav.allProjects,
      keywords: 'home overview',
      action: { kind: 'go', hash: href.projects() },
    },
    {
      id: 'page:health',
      group: 'pages',
      label: SHELL_COPY.nav.health,
      keywords: 'diagnostics',
      action: { kind: 'go', hash: href.health() },
    },
    {
      id: 'page:connection',
      group: 'pages',
      label: SHELL_COPY.health.connection,
      hint: SHELL_COPY.nav.health,
      keywords: 'setup hooks register folder',
      action: { kind: 'go', hash: href.setup() },
    },
  );
  for (const p of projects) {
    out.push({
      id: `project:${p.id}`,
      group: 'projects',
      label: p.name,
      hint: p.rootPath,
      action: { kind: 'go', hash: href.project(p.id) },
    });
  }
  for (const t of tickets) {
    out.push({
      id: `ticket:${t.id}`,
      group: 'tickets',
      label: t.key,
      hint: t.title,
      action: { kind: 'go', hash: href.ticket(t) },
    });
  }
  return out;
}

/** 3: the ticket key or label is the query; 2: it starts with it; 1: every word is somewhere. */
function score(c: Command, query: string): number {
  const label = c.label.toLowerCase();
  if (label === query) return 3;
  if (label.startsWith(query)) return 2;
  const haystack = `${label} ${c.hint ?? ''} ${c.keywords ?? ''}`.toLowerCase();
  return query.split(/\s+/).every((w) => haystack.includes(w)) ? 1 : 0;
}

/**
 * The entries to show, in group order (best match first within a group). An empty query lists
 * everything except older tickets.
 */
export function filterCommands(commands: readonly Command[], rawQuery: string): Command[] {
  const query = rawQuery.trim().toLowerCase();
  const scored =
    query === ''
      ? commands.map((c, i) => ({ c, s: 0, i }))
      : commands.map((c, i) => ({ c, s: score(c, query), i })).filter((x) => x.s > 0);
  const out: Command[] = [];
  for (const group of GROUP_ORDER) {
    const inGroup = scored
      .filter((x) => x.c.group === group)
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map((x) => x.c);
    out.push(
      ...(query === '' && group === 'tickets' ? inGroup.slice(0, TICKETS_WHEN_EMPTY) : inGroup),
    );
  }
  return out;
}
