import { href, NEW_RUN, type LegacyRoute, type Route } from '../lib/router';

/**
 * Where each pre-redesign address goes now (docs/redesign/README.md §3). Pure, so every rule has a
 * unit test; src/app/Redirect.tsx fetches what a rule needs and replaces the address.
 */
export type RedirectPlan =
  | { kind: 'go'; hash: string }
  /** `#/tickets/:id`: the new address needs the ticket's project. */
  | { kind: 'ticket'; ticketId: string }
  /** `#/control/:runId`: the run's ticket, or its run page when it has none. */
  | { kind: 'run'; runId: string };

export interface RedirectContext {
  /** The remembered project, if it still exists. */
  lastProject: string | null;
  /** The first registered project, if any. */
  firstProject: string | null;
}

function withoutProject(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of params) if (k !== 'projectId') out[k] = v;
  return out;
}

export function planRedirect(legacy: LegacyRoute, ctx: RedirectContext): RedirectPlan {
  const go = (hash: string): RedirectPlan => ({ kind: 'go', hash });
  // Pages that used to work without a project open the last one, else the first one.
  const fallback = ctx.lastProject ?? ctx.firstProject;
  switch (legacy.kind) {
    case 'home':
      // The front door: the last project's board, or All projects (no guessing a project).
      return go(ctx.lastProject === null ? href.projects() : href.board(ctx.lastProject));
    case 'board': {
      const id = legacy.projectId ?? fallback;
      return go(id === null ? href.projects() : href.board(id));
    }
    case 'ticket':
      return { kind: 'ticket', ticketId: legacy.ticketId };
    case 'project':
      return go(href.project(legacy.projectId));
    case 'project-settings':
      return go(href.projectSettings(legacy.projectId));
    case 'usage':
    case 'sessions': {
      const id = legacy.params.get('projectId')?.trim() || fallback;
      if (!id) return go(href.projects());
      const page = legacy.kind === 'usage' ? 'tokens' : 'sessions';
      return go(href.projectPage(id, page, withoutProject(legacy.params)));
    }
    case 'setup':
      return go(href.setup());
    case 'control':
      if (legacy.runId === null)
        return go(fallback === null ? href.projects() : href.board(fallback));
      if (legacy.runId === NEW_RUN) {
        return go(
          fallback === null ? href.projects() : href.run({ projectId: fallback, id: NEW_RUN }),
        );
      }
      return { kind: 'run', runId: legacy.runId };
  }
}

/**
 * A run opens on its ticket (`RunSummaryDto.ticketId`, decision D); a Phase 3 run without a
 * ticket opens on its run page.
 */
export function runTarget(run: { id: string; projectId: string; ticketId: string | null }): string {
  return run.ticketId === null
    ? href.run(run)
    : href.ticket({ id: run.ticketId, projectId: run.projectId });
}

/**
 * D-A's review pages (`…/tickets/:id/files`, `…/tickets/:id/changes/:agentRunId`) are the
 * ticket's Files changed tab since C-D: the same selection, and the same run when one was named.
 */
export function reviewTarget(route: Extract<Route, { name: 'review' }>): string {
  const ticket = { projectId: route.projectId, ticketId: route.ticketId, runId: route.runId };
  return route.agentRunId === null
    ? href.ticketFiles(ticket)
    : href.ticketChange({ ...ticket, agentRunId: route.agentRunId });
}
