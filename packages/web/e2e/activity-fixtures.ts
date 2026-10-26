/*
 * Synthetic Comments, Conversation and attachment data for the ticket page (v0.3.0 C-B,
 * ADR-0026), on top of the review-loop ticket WEB-21 (review-loop-fixtures.ts). Every name, text
 * and hash here is made up. Shared by the unit tests and ticket-activity.spec.ts, which answer the
 * routes from these (the server side, C-A, is built in parallel).
 */
import {
  L_API,
  L_LEAD,
  L_UI,
  LOOP_RUN_ID,
  LOOP_TICKET_ID,
  LOOP_TICKET_PATH,
  type LoopScenario,
} from './review-loop-fixtures.js';

type Json = Record<string, unknown>;

const T = (min: number) => new Date(Date.UTC(2026, 9, 17, 9, min)).toISOString();

export const ACTIVITY_PATH = `${LOOP_TICKET_PATH}/activity`;
export const ATTACHMENTS_PATH = `${LOOP_TICKET_PATH}/attachments`;

const sha = (c: string) => c.repeat(64).slice(0, 64);

export function attachment(over: Json & { id: string; name: string; mimeType: string }): Json {
  return {
    ticketId: LOOP_TICKET_ID,
    commentId: null,
    sizeBytes: 2048,
    sha256: sha('a'),
    createdAt: T(3),
    contentUrl: `/api/attachments/${over.id}/content`,
    ...over,
  };
}

/** On the ticket itself: a screenshot and a log. */
export const TICKET_ATTACHMENTS: Json[] = [
  attachment({ id: 'att-shot', name: 'search-mock.png', mimeType: 'image/png', sizeBytes: 48_213 }),
  attachment({
    id: 'att-log',
    name: 'slow-query.log',
    mimeType: 'text/plain',
    sizeBytes: 1_530,
    sha256: sha('b'),
  }),
];

/** On the owner's comment `c-owner-1`. */
export const COMMENT_ATTACHMENTS: Json[] = [
  attachment({
    id: 'att-csv',
    name: 'queries.csv',
    mimeType: 'text/csv',
    sizeBytes: 12_400,
    sha256: sha('c'),
    commentId: 'c-owner-1',
    createdAt: T(4),
  }),
];

function comment(over: Json & { id: string }): Json {
  return {
    ticketId: LOOP_TICKET_ID,
    runId: LOOP_RUN_ID,
    planId: null,
    author: 'owner',
    body: 'A comment',
    createdAt: T(5),
    ...over,
  };
}

/** People's comments and the lead's ticket summary (twice: the newer one is "updated"). */
export const ACTIVITY_COMMENTS: Json[] = [
  comment({
    id: 'c-owner-1',
    runId: null,
    kind: 'comment',
    body: 'Here are the slow queries from last week:\n\n- `GET /api/search?q=a`\n- `GET /api/search?q=` (empty)\n\nSee https://example.com/search-notes for the notes. <b>not bold</b>',
    createdAt: T(4),
    attachments: COMMENT_ATTACHMENTS,
  }),
  comment({
    id: 'c-sum-1',
    author: 'lead',
    kind: 'ticket-summary',
    body: 'Planned the search in two steps: an API and a search box.',
    createdAt: T(10),
  }),
  comment({
    id: 'c-sum-2',
    author: 'lead',
    kind: 'ticket-summary',
    body: 'Built the search API with a capped page size and tests; the search box was dropped after review because it re-rendered the list on every key press.',
    createdAt: T(37),
  }),
  comment({
    id: 'c-note-api',
    author: 'lead',
    kind: 'agent-note',
    agentRunId: L_API,
    body: 'Added GET /api/search with a page size capped at 100. Checked it with two unit tests.',
    createdAt: T(19),
  }),
];

function item(over: Json & { id: string; type: string; title: string }): Json {
  return {
    at: T(2),
    runId: LOOP_RUN_ID,
    actor: { kind: 'app', label: 'Agent Control Plane', agentRunId: null },
    body: null,
    link: null,
    ...over,
  };
}

const LEAD = { kind: 'lead', label: 'Lead', agentRunId: L_LEAD };
const API = { kind: 'worker', label: 'API builder', agentRunId: L_API };
const UI = { kind: 'worker', label: 'Search UI', agentRunId: L_UI };
const REVIEWER = { kind: 'reviewer', label: 'Reviewer', agentRunId: null };

/** The server's timeline of WEB-21's run, oldest first. */
export const ACTIVITY_ITEMS: Json[] = [
  item({ id: 'a-run', type: 'run-started', title: 'Run 1 started', at: T(2) }),
  item({
    id: 'a-api-start',
    type: 'agent-started',
    title: 'API builder started',
    actor: API,
    at: T(12),
  }),
  item({
    id: 'a-ui-start',
    type: 'agent-started',
    title: 'Search UI started',
    actor: UI,
    at: T(13),
  }),
  item({
    id: 'a-api-note',
    type: 'agent-note',
    title: 'API builder reported what it did',
    actor: API,
    body: 'Added GET /api/search with a page size capped at 100. Checked it with two unit tests.',
    link: { kind: 'change', agentRunId: L_API },
    at: T(19),
  }),
  item({
    id: 'a-review',
    type: 'review',
    title: 'Reviewer findings on API builder',
    actor: REVIEWER,
    body: 'GET /api/search has no upper limit on the page size. Cap pageSize at 100.',
    link: { kind: 'change', agentRunId: L_API },
    at: T(21),
  }),
  item({
    id: 'a-rework',
    type: 'note',
    title: 'Lead asked API builder for rework',
    actor: LEAD,
    body: 'Cap the page size and add a test for the cap.',
    at: T(22),
  }),
  item({
    id: 'a-discard',
    type: 'decision',
    title: 'Lead discarded the Search UI change',
    actor: LEAD,
    body: 'It changed a file the API builder owns.',
    at: T(26),
  }),
  item({ id: 'a-ui-end', type: 'agent-ended', title: 'Search UI ended', actor: UI, at: T(41) }),
  item({
    id: 'a-facts',
    type: 'run-facts',
    title: 'Run facts',
    body: 'Run summary\n\nThe run handed over the ticket branch.\n\nDetails:\n- Merged 1 change from API builder: 3 files.\n- Discarded 1 change from Search UI.',
    link: { kind: 'files' },
    at: T(42),
  }),
  item({
    id: 'a-pr',
    type: 'pull-request',
    title: 'Pushed acp/WEB-21 and opened pull request #7 into main',
    body: 'Pushed acp/WEB-21 and opened pull request #7 into main.',
    link: { kind: 'pull-request', url: 'https://github.com/example/app/pull/7' },
    at: T(44),
  }),
];

/** The review-loop scenario with the comments, attachments and activity above. */
export function withActivity(sc: LoopScenario, items: Json[] = ACTIVITY_ITEMS): LoopScenario {
  const detail = sc.routes[LOOP_TICKET_PATH] as Json;
  return {
    routes: {
      ...sc.routes,
      [LOOP_TICKET_PATH]: {
        ...detail,
        comments: [...(detail['comments'] as Json[]), ...ACTIVITY_COMMENTS],
      },
      [ATTACHMENTS_PATH]: [...TICKET_ATTACHMENTS, ...COMMENT_ATTACHMENTS],
      [ACTIVITY_PATH]: { ticketId: LOOP_TICKET_ID, items },
    },
  };
}
