/*
 * Synthetic, test-only responses for GitHub and branching (G-B, ADR-0025): a project's code host
 * status, a ticket branch named by GitHub flow, and the pull request raised for it (open, merged
 * or closed). Built on the review loop's fixtures, as plain JSON, so the vitest suite (which
 * parses each with its @acp/core/api schema) and the Playwright spec (github.spec.ts,
 * page.route) share them. The repository, numbers and URLs are invented. Never import this from
 * src/.
 */

import {
  LOOP_BRANCH_PATH,
  LOOP_RUN_PATH,
  LOOP_TICKET_ID,
  LOOP_TICKET_PATH,
  PROJECT_ID,
  loopDoneScenario,
  loopReviewScenario,
  type LoopScenario,
} from './review-loop-fixtures.js';

type Json = Record<string, unknown>;

export const GH_REPO = 'acme/web-app';
export const GH_BRANCH = 'feature/WEB-21-saved-searches';
export const GH_PR_NUMBER = 42;
export const GH_PR_URL = `https://github.com/${GH_REPO}/pull/${GH_PR_NUMBER}`;
export const CODE_HOST_PATH = `/api/projects/${PROJECT_ID}/code-host`;
export const PROJECT_SETUP_PATH = `/api/projects/${PROJECT_ID}/setup`;
export const PR_PATH = `/api/tickets/${LOOP_TICKET_ID}/branch/pull-request`;
export const PR_REFRESH_PATH = `${PR_PATH}/refresh`;

const T = (min: number) => new Date(Date.UTC(2026, 9, 17, 9, min)).toISOString();

export type CodeHostKind = 'ready' | 'no-remote' | 'no-cli' | 'not-logged-in';

/** `GET /api/projects/:id/code-host` for each case the owner can be in. */
export function codeHost(kind: CodeHostKind): Json {
  const github = kind !== 'no-remote';
  const installed = kind !== 'no-cli';
  return {
    provider: github ? 'github' : null,
    repo: github ? GH_REPO : null,
    defaultBranch: kind === 'ready' ? 'main' : null,
    cli: {
      name: 'gh',
      installed,
      loggedIn: installed ? kind !== 'not-logged-in' : null,
    },
    problem:
      kind === 'ready'
        ? null
        : kind === 'no-remote'
          ? 'No GitHub remote named origin.'
          : kind === 'no-cli'
            ? 'Install the GitHub CLI (gh).'
            : 'Run gh auth login.',
  };
}

export function pullRequest(state: 'open' | 'merged' | 'closed', over: Json = {}): Json {
  return {
    provider: 'github',
    number: GH_PR_NUMBER,
    url: GH_PR_URL,
    state,
    baseBranch: 'main',
    headBranch: GH_BRANCH,
    checkedAt: T(55),
    ...over,
  };
}

/** The scenario with its ticket branch (in the ticket, the run and the combined change) edited. */
function editBranch(sc: LoopScenario, edit: (branch: Json) => Json): LoopScenario {
  const detail = sc.routes[LOOP_TICKET_PATH] as Json;
  const run = detail['currentRun'] as Json;
  const nextRun = { ...run, ticketBranch: edit(run['ticketBranch'] as Json) };
  const routes: LoopScenario['routes'] = {
    ...sc.routes,
    [LOOP_TICKET_PATH]: { ...detail, currentRun: nextRun },
    [LOOP_RUN_PATH]: nextRun,
  };
  const review = sc.routes[LOOP_BRANCH_PATH] as Json | undefined;
  if (review !== undefined) {
    routes[LOOP_BRANCH_PATH] = {
      ...review,
      ticketBranch: edit(review['ticketBranch'] as Json),
    };
  }
  return { routes };
}

/**
 * Ready for the owner's final step on a GitHub flow branch: no pull request yet (`pr` null), or
 * the one raised (open, or closed without merging).
 */
export function ghReviewScenario(pr: Json | null = null, host: CodeHostKind = 'ready') {
  const sc = editBranch(loopReviewScenario(), (b) => ({
    ...b,
    branch: GH_BRANCH,
    ...(pr !== null && { pullRequest: pr }),
  }));
  sc.routes[CODE_HOST_PATH] = codeHost(host);
  return sc;
}

/** Merged on GitHub: the ticket is done, the branch reads merged, with no local merge commit. */
export function ghMergedScenario(): LoopScenario {
  const sc = editBranch(loopDoneScenario(), (b) => ({
    ...b,
    branch: GH_BRANCH,
    mergedCommit: null,
    pullRequest: pullRequest('merged', { checkedAt: T(58) }),
  }));
  sc.routes[CODE_HOST_PATH] = codeHost('ready');
  return sc;
}

/** A commit the app pushed before the ticket branch moved on (G-D, Push new commits). */
export const GH_PUSHED_EARLIER = 'b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d6e7f80';

/** The ticket branch's tip in the review scenarios, as the app last pushed it when up to date. */
export function ghHeadCommit(sc: LoopScenario): string {
  const detail = sc.routes[LOOP_TICKET_PATH] as Json;
  const run = detail['currentRun'] as Json;
  return (run['ticketBranch'] as Json)['headCommit'] as string;
}

/**
 * An open pull request (G-D): up to date with the ticket branch (`pushedCommit` is its tip), or
 * behind it (`behind`: pushed at an earlier commit, so Push new commits is offered).
 */
export function ghOpenScenario(behind: boolean, over: Json = {}): LoopScenario {
  const head = ghHeadCommit(ghReviewScenario());
  return ghReviewScenario(
    pullRequest('open', { pushedCommit: behind ? GH_PUSHED_EARLIER : head, ...over }),
  );
}

/** The `app` one-line notes about the pull request (G-D), as the server writes them. */
export const GH_APP_LINES = {
  opened: `Pushed ${GH_BRANCH} and opened pull request #${GH_PR_NUMBER} into main.`,
  again: `Pushed ${GH_BRANCH}; pull request #${GH_PR_NUMBER} into main was already open.`,
  merged: `Merged via pull request #${GH_PR_NUMBER} into main at 9c8b7a6; checks passed on the tip (2).`,
} as const;

/** The scenario with the app's pull request lines added to the ticket's comments. */
export function withPullRequestLines(sc: LoopScenario): LoopScenario {
  const detail = sc.routes[LOOP_TICKET_PATH] as Json;
  const line = (id: string, body: string, min: number): Json => ({
    id,
    ticketId: LOOP_TICKET_ID,
    runId: (detail['currentRun'] as Json)['id'],
    planId: null,
    author: 'app',
    body,
    createdAt: T(min),
  });
  const comments = [
    ...(detail['comments'] as Json[]),
    line('c-app-pr-opened', GH_APP_LINES.opened, 50),
    line('c-app-pr-again', GH_APP_LINES.again, 54),
    line('c-app-pr-merged', GH_APP_LINES.merged, 58),
  ];
  return { routes: { ...sc.routes, [LOOP_TICKET_PATH]: { ...detail, comments } } };
}

/** `POST /api/projects/:id/tickets`'s answer for a created ticket (Backlog), with what was sent. */
export function createdTicket(body: Json): Json {
  return {
    id: 't-30',
    projectId: PROJECT_ID,
    key: 'WEB-30',
    title: body['title'],
    description: body['description'] ?? '',
    type: body['type'] ?? 'feature',
    priority: body['priority'] ?? 'medium',
    labels: body['labels'] ?? [],
    status: 'BACKLOG',
    currentRunId: null,
    createdAt: T(60),
    updatedAt: T(60),
    ...(body['branch'] !== undefined && { branch: body['branch'] }),
    stage: 'BACKLOG',
  };
}

/** A project setup with GitHub flow (for the settings page and the ticket fields). */
export function githubFlowStrategy(): Json {
  return {
    preset: 'github-flow',
    baseBranch: 'main',
    defaultTargetBranch: 'main',
    ticketBranchTemplate: '{type}/{key}-{slug}',
    typeWords: { feature: 'feature', bug: 'fix', chore: 'chore', harness: 'chore' },
  };
}
