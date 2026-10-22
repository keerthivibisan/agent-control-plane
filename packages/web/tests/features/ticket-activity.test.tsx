// The ticket page's Comments and Conversation tabs and attachments (v0.3.0 C-B, ADR-0026): which
// comment goes where, the lead's ticket summary, attachments (checks, upload, delete), safe
// formatting, the Conversation timeline with its filters and links, and Files changed after a
// merge. Server answers are mocked from synthetic fixtures (C-A builds the routes in parallel).
import {
  AttachmentDtoSchema,
  TicketActivityDtoSchema,
  TicketCommentDtoSchema,
  TicketCommentRequestSchema,
  TicketDetailDtoSchema,
  type TicketCommentDto,
} from '@acp/core/api';
import { fireEvent, render as rtl, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ACTIVITY_COMMENTS,
  ACTIVITY_ITEMS,
  ACTIVITY_PATH,
  ATTACHMENTS_PATH,
  COMMENT_ATTACHMENTS,
  TICKET_ATTACHMENTS,
  attachment,
  withActivity,
} from '../../e2e/activity-fixtures';
import {
  CSRF,
  L_API,
  LOOP_BRANCH_PATH,
  LOOP_RUN_ID,
  LOOP_TICKET_ID,
  LOOP_TICKET_PATH,
  PROJECT_ID,
  loopDoneScenario,
  loopReviewScenario,
  ticketBranchReview,
  type LoopScenario,
} from '../../e2e/review-loop-fixtures';
import { activityFromDetail, actorFilters } from '../../src/features/activity/activity-from-detail';
import {
  commentKind,
  commentsTabCount,
  commentsTabParts,
} from '../../src/features/activity/comment-kind';
import { RichText, safeHref } from '../../src/features/activity/RichText';
import {
  MAX_ATTACHMENTS_PER_COMMENT,
  attachmentType,
  checkFile,
  formatBytes,
} from '../../src/features/attachments/limits';
import { isGoneError, mergedFilesState } from '../../src/features/ticket/merged-files';
import { TicketPage } from '../../src/features/ticket/TicketPage';
import { ApiError, createApiClient, uploadAttachment, type FetchLike } from '../../src/lib/api';
import { fakeServer, jsonResponse, renderWithApi, type RouteTable } from '../helpers';

// The live graph (Agents) is React Flow, which measures the DOM; jsdom has no layout.
beforeAll(() => {
  if (typeof globalThis.DOMMatrixReadOnly === 'undefined') {
    class Matrix {
      m22 = 1;
    }
    Object.assign(globalThis, { DOMMatrixReadOnly: Matrix });
  }
});

const TICKET_HASH = `#/p/${PROJECT_ID}/tickets/${LOOP_TICKET_ID}`;

interface Seen {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

/** The page on a tab, against fixture routes; every request is recorded with its headers. */
function renderPage(sc: LoopScenario, tab?: 'conversation' | 'files', routes: RouteTable = {}) {
  window.location.hash = tab ? `${TICKET_HASH}?tab=${tab}` : TICKET_HASH;
  const s = fakeServer({ '/api/control/token': { token: CSRF }, ...sc.routes, ...routes });
  const seen: Seen[] = [];
  const fetch: FetchLike = (input, init) => {
    seen.push({
      method: init?.method ?? 'GET',
      path: input,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body,
    });
    return s.fetch(input, init);
  };
  renderWithApi(<TicketPage id={LOOP_TICKET_ID} />, { ...s, fetch });
  return { seen, mutations: () => seen.filter((r) => r.method !== 'GET') };
}

function c(over: Partial<TicketCommentDto> & { id: string }): TicketCommentDto {
  return {
    ticketId: 't-1',
    runId: null,
    planId: null,
    author: 'owner',
    body: 'Text',
    createdAt: '2026-10-22T09:00:00.000Z',
    ...over,
  };
}

describe('the fixtures', () => {
  it('match the API contract', () => {
    for (const a of [...TICKET_ATTACHMENTS, ...COMMENT_ATTACHMENTS]) {
      expect(() => AttachmentDtoSchema.parse(a)).not.toThrow();
    }
    for (const cm of ACTIVITY_COMMENTS)
      expect(() => TicketCommentDtoSchema.parse(cm)).not.toThrow();
    expect(() =>
      TicketActivityDtoSchema.parse({ ticketId: LOOP_TICKET_ID, items: ACTIVITY_ITEMS }),
    ).not.toThrow();
    expect(() =>
      TicketDetailDtoSchema.parse(withActivity(loopReviewScenario()).routes[LOOP_TICKET_PATH]),
    ).not.toThrow();
  });
});

describe('which tab a comment is on (ADR-0026 §1)', () => {
  it('uses the stored kind, and derives it for comments from before 0.3.0', () => {
    expect(commentKind(c({ id: '1', kind: 'agent-note', author: 'lead' }))).toBe('agent-note');
    expect(commentKind(c({ id: '2', author: 'owner' }))).toBe('comment');
    expect(commentKind(c({ id: '3', author: 'reviewer' }))).toBe('review');
    expect(commentKind(c({ id: '4', author: 'lead' }))).toBe('note');
    expect(commentKind(c({ id: '5', author: 'app', body: 'Run summary\n\nDone.' }))).toBe(
      'run-facts',
    );
    expect(
      commentKind(c({ id: '6', author: 'app', body: 'Merged acp/WEB-1 into main at 1a2b3c4' })),
    ).toBe('system');
  });

  it('keeps people’s comments and the newest ticket summary; earlier summaries fold under it', () => {
    const parts = commentsTabParts([
      c({ id: 'o2', createdAt: '2026-10-22T09:05:00.000Z' }),
      c({
        id: 's1',
        author: 'lead',
        kind: 'ticket-summary',
        createdAt: '2026-10-22T09:01:00.000Z',
      }),
      c({ id: 'r', author: 'reviewer' }),
      c({
        id: 's2',
        author: 'lead',
        kind: 'ticket-summary',
        createdAt: '2026-10-22T09:09:00.000Z',
      }),
      c({ id: 'o1', createdAt: '2026-10-22T09:02:00.000Z' }),
      c({ id: 'n', author: 'lead', kind: 'agent-note' }),
    ]);
    expect(parts.summary?.id).toBe('s2');
    expect(parts.earlierSummaries.map((x) => x.id)).toEqual(['s1']);
    expect(parts.comments.map((x) => x.id)).toEqual(['o1', 'o2']);
    expect(commentsTabCount([c({ id: 'a' }), c({ id: 'b', author: 'reviewer' })])).toBe(1);
  });
});

describe('the timeline from the ticket’s records (a server without /activity)', () => {
  it('lists runs, plans and every non-Comments comment oldest first, naming each actor', () => {
    const detail = TicketDetailDtoSchema.parse(
      withActivity(loopReviewScenario()).routes[LOOP_TICKET_PATH],
    );
    const items = activityFromDetail(detail);
    expect(items.map((i) => i.type)).toEqual([
      'run-started',
      'agent-note',
      'review',
      'review',
      'review',
    ]);
    // The note names its agent from the run on screen.
    expect(items[1]?.actor).toEqual({ kind: 'worker', label: 'API builder', agentRunId: L_API });
    // No owner comment and no ticket summary: those are on Comments.
    expect(items.some((i) => i.actor.kind === 'owner')).toBe(false);
    expect(actorFilters(items).map((f) => [f.label, f.count])).toEqual([
      ['Agent Control Plane', 1],
      ['API builder', 1],
      ['Reviewer', 3],
    ]);
  });
});

describe('safe formatting', () => {
  it('formats lists, code and links, and shows HTML as text', () => {
    rtl(
      <RichText
        text={
          'First line\nsecond line\n\n- one\n- `two`\n\n```\nconst a = 1;\n```\n\nSee [docs](https://example.com/d) and <img src=x onerror=alert(1)> [bad](javascript:alert(1)).'
        }
        testId="rt"
      />,
    );
    const rt = screen.getByTestId('rt');
    expect(rt.querySelector('img')).toBeNull();
    expect(rt.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(rt.querySelectorAll('li')).toHaveLength(2);
    expect(rt.querySelector('li code')?.textContent).toBe('two');
    expect(rt.querySelector('pre code')?.textContent).toBe('const a = 1;');
    expect(rt.querySelector('p')?.querySelector('br')).not.toBeNull();
    const links = [...rt.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://example.com/d']);
    expect(links[0]?.getAttribute('rel')).toBe('noopener noreferrer nofollow');
    expect(rt.textContent).toContain('bad');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('mailto:a@example.com')).toBe('mailto:a@example.com');
  });
});

describe('attachment checks in the browser (ADR-0026 §4)', () => {
  const file = (name: string, type: string, size = 100) => ({ name, type, size });

  it('takes the allowed types, by type or by extension; never HTML or SVG', () => {
    expect(attachmentType(file('a.png', 'image/png'))).toBe('image/png');
    expect(attachmentType(file('notes.md', ''))).toBe('text/markdown');
    expect(attachmentType(file('build.log', ''))).toBe('text/plain');
    expect(attachmentType(file('a.zip', 'application/x-zip-compressed'))).toBe('application/zip');
    expect(attachmentType(file('logo.svg', 'image/svg+xml'))).toBeNull();
    expect(attachmentType(file('page.html', 'text/html'))).toBeNull();
    expect(attachmentType(file('page.png', 'text/html'))).toBeNull();
    expect(attachmentType(file('run.sh', ''))).toBeNull();
  });

  it('refuses a large, empty or badly named file, and a full ticket or comment', () => {
    expect(checkFile(file('a.png', 'image/png', 10 * 1024 * 1024 + 1), { onTicket: 0 })).toEqual({
      ok: false,
      why: { kind: 'tooBig' },
    });
    expect(checkFile(file('a.png', 'image/png', 0), { onTicket: 0 })).toMatchObject({ ok: false });
    expect(checkFile(file('.env', 'text/plain'), { onTicket: 0 })).toMatchObject({
      ok: false,
      why: { kind: 'name' },
    });
    expect(checkFile(file('a.png', 'image/png'), { onTicket: 50 })).toMatchObject({
      why: { kind: 'tooMany' },
    });
    expect(
      checkFile(file('a.png', 'image/png'), {
        onTicket: 3,
        onComment: MAX_ATTACHMENTS_PER_COMMENT,
      }),
    ).toMatchObject({ why: { kind: 'perComment' } });
    expect(checkFile(file('a.png', 'image/png'), { onTicket: 49, onComment: 9 })).toEqual({
      ok: true,
      mimeType: 'image/png',
    });
    expect(formatBytes(820)).toBe('820 B');
    expect(formatBytes(48_213)).toBe('47 KB');
    expect(formatBytes(3.4 * 1024 * 1024)).toBe('3.4 MB');
  });

  it('allows as many per comment as the comment request does', () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `a-${i}`);
    const ok = TicketCommentRequestSchema.safeParse({
      body: 'x',
      attachmentIds: ids(MAX_ATTACHMENTS_PER_COMMENT),
    });
    const over = TicketCommentRequestSchema.safeParse({
      body: 'x',
      attachmentIds: ids(MAX_ATTACHMENTS_PER_COMMENT + 1),
    });
    expect(ok.success).toBe(true);
    expect(over.success).toBe(false);
  });
});

describe('the upload request', () => {
  it('sends the bytes as they are, with the type, the encoded name and the CSRF header', async () => {
    const seen: { path: string; init: RequestInit | undefined }[] = [];
    const answer = attachment({ id: 'att-new', name: 'a b.md', mimeType: 'text/markdown' });
    let tokens = 0;
    const fetch: FetchLike = (path, init) => {
      seen.push({ path, init });
      if (path === '/api/control/token') {
        tokens += 1;
        return Promise.resolve(jsonResponse(200, { token: `${CSRF.slice(0, -1)}${tokens}` }));
      }
      // The first upload meets a restarted server: a 403 asks for a fresh token.
      if (seen.filter((r) => r.path.includes('/attachments')).length === 1) {
        return Promise.resolve(
          jsonResponse(403, { error: { code: 'csrf', message: 'stale', requestId: 'r' } }),
        );
      }
      return Promise.resolve(jsonResponse(201, answer));
    };
    const blob = new Blob(['# Notes'], { type: 'text/markdown' });
    const out = await uploadAttachment(
      createApiClient(fetch),
      LOOP_TICKET_ID,
      { data: blob, name: 'a b.md', mimeType: 'text/markdown' },
      'c-1',
    );
    expect(out.id).toBe('att-new');
    const posts = seen.filter((r) => r.init?.method === 'POST');
    expect(posts).toHaveLength(2);
    const last = posts[1];
    expect(last?.path).toBe(`${ATTACHMENTS_PATH}?commentId=c-1`);
    expect(last?.init?.body).toBe(blob);
    expect(last?.init?.headers).toMatchObject({
      'content-type': 'text/markdown',
      'X-Attachment-Name': 'a%20b.md',
      'X-ACP-CSRF': `${CSRF.slice(0, -1)}2`,
    });
  });
});

describe('the Comments tab', () => {
  it('shows the key, the description, the ticket’s attachments, the summary and people’s comments', async () => {
    renderPage(withActivity(loopReviewScenario()));
    const thread = await screen.findByTestId('comments');
    expect(within(thread).getByTestId('ticket-key').textContent).toBe('WEB-21');
    // The ticket's own files: the image as a thumbnail that opens it, the log as a chip.
    const ticketFiles = await within(thread).findByTestId('ticket-attachments');
    const shot = within(ticketFiles).getByRole('link', { name: 'Open search-mock.png' });
    expect(shot.getAttribute('href')).toBe('/api/attachments/att-shot/content');
    expect(shot.getAttribute('target')).toBe('_blank');
    expect(within(shot).getByRole('img').getAttribute('alt')).toBe('search-mock.png');
    const log = within(ticketFiles).getByRole('link', { name: 'Download slow-query.log' });
    expect(log.getAttribute('download')).toBe('slow-query.log');
    expect(log.textContent).toContain('1.5 KB');
    // The comment's own file is with the comment, not the ticket.
    expect(within(ticketFiles).queryByText('queries.csv')).toBeNull();
    // The lead's summary: one card, the newest, marked updated, with the earlier one folded.
    const summary = within(thread).getByTestId('ticket-summary-comment');
    expect(within(summary).getByTestId('summary-body').textContent).toContain(
      'Built the search API',
    );
    expect(within(summary).getByTestId('summary-updated').textContent).toBe('Updated');
    expect(within(summary).getByTestId('earlier-summaries').textContent).toContain(
      'Planned the search in two steps',
    );
    // People's comments, formatted safely, with their files; no findings or agents' notes here.
    const comments = within(thread).getAllByTestId('comment');
    expect(comments).toHaveLength(1);
    const body = within(comments[0] as HTMLElement).getByTestId('comment-body');
    expect(body.querySelectorAll('li')).toHaveLength(2);
    expect(within(body).getByRole('link').getAttribute('href')).toBe(
      'https://example.com/search-notes',
    );
    expect(body.textContent).toContain('<b>not bold</b>');
    expect(
      within(comments[0] as HTMLElement).getByRole('link', { name: 'Download queries.csv' }),
    ).toBeTruthy();
    expect(thread.querySelector('[data-author="reviewer"]')).toBeNull();
    expect(thread.textContent).not.toContain('Checked it with two unit tests');
    // The count: one comment and the summary.
    expect(screen.getByTestId('tab-count-comments').textContent).toBe('2');
  });

  it('keeps what waits for you and the final step on the default tab', async () => {
    renderPage(withActivity(loopReviewScenario()));
    const tab = await screen.findByTestId('comments-tab');
    expect(within(tab).getByTestId('ticket-branch')).toBeTruthy();
    expect(screen.getByTestId('ticket-tab-comments').getAttribute('aria-selected')).toBe('true');
  });

  it('uploads a picked file at once and sends its id with the comment', async () => {
    const posted = TicketCommentDtoSchema.parse({ ...ACTIVITY_COMMENTS[0], id: 'c-new' });
    const uploaded = attachment({ id: 'att-up', name: 'notes.md', mimeType: 'text/markdown' });
    const page = renderPage(withActivity(loopReviewScenario()), undefined, {
      [`POST ${ATTACHMENTS_PATH}`]: () => jsonResponse(201, uploaded),
      [`POST ${LOOP_TICKET_PATH}/comments`]: () => jsonResponse(201, posted),
    });
    const form = await screen.findByTestId('comment-form');
    const input = within(form).getByTestId<HTMLInputElement>('attachment-input');
    const file = new File(['# Notes'], 'notes.md', { type: '' });
    fireEvent.change(input, { target: { files: [file] } });
    const row = await within(form).findByTestId('upload');
    await waitFor(() => expect(row.getAttribute('data-status')).toBe('done'));
    const upload = page.mutations().find((m) => m.path === ATTACHMENTS_PATH);
    expect(upload?.body).toBe(file);
    expect(upload?.headers).toMatchObject({
      'content-type': 'text/markdown',
      'X-Attachment-Name': 'notes.md',
      'X-ACP-CSRF': CSRF,
    });
    fireEvent.change(within(form).getByLabelText('Add a comment'), {
      target: { value: 'With notes' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Comment' }));
    await waitFor(() =>
      expect(page.mutations().some((m) => m.path.endsWith('/comments'))).toBe(true),
    );
    const sent = page.mutations().find((m) => m.path.endsWith('/comments'));
    expect(JSON.parse(String(sent?.body))).toEqual({
      body: 'With notes',
      attachmentIds: ['att-up'],
    });
    await waitFor(() => expect(within(form).queryByTestId('upload')).toBeNull());
  });

  it('refuses a file the server would refuse, without sending it', async () => {
    const page = renderPage(withActivity(loopReviewScenario()));
    const form = await screen.findByTestId('comment-form');
    const svg = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' });
    fireEvent.change(within(form).getByTestId('attachment-input'), { target: { files: [svg] } });
    const row = await within(form).findByTestId('upload');
    expect(row.getAttribute('data-status')).toBe('failed');
    expect(row.textContent).toContain('isn’t a type you can attach');
    expect(page.mutations()).toHaveLength(0);
  });

  it('deletes the owner’s attachment after a confirmation, with the CSRF header', async () => {
    const page = renderPage(withActivity(loopReviewScenario()), undefined, {
      'DELETE /api/attachments/att-log': () => new Response(null, { status: 204 }),
    });
    const files = await screen.findByTestId('ticket-attachments');
    fireEvent.click(within(files).getByRole('button', { name: 'Delete slow-query.log' }));
    expect(page.mutations()).toHaveLength(0);
    const confirm = within(files).getByRole('group', { name: /Delete slow-query.log\?/ });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(page.mutations()).toHaveLength(1));
    expect(page.mutations()[0]).toMatchObject({
      method: 'DELETE',
      path: '/api/attachments/att-log',
      headers: { 'X-ACP-CSRF': CSRF },
    });
  });
});

describe('the Conversation tab', () => {
  it('shows the server’s timeline: notes, findings, decisions, run facts and a pull request', async () => {
    renderPage(withActivity(loopReviewScenario()), 'conversation');
    const tab = await screen.findByTestId('activity');
    expect(await screen.findByTestId('tab-count-conversation')).toBeTruthy();
    expect(screen.getByTestId('tab-count-conversation').textContent).toBe(
      String(ACTIVITY_ITEMS.length),
    );
    const types = [...tab.querySelectorAll('li[data-type]')].map((li) =>
      li.getAttribute('data-type'),
    );
    expect(types).toEqual(ACTIVITY_ITEMS.map((i) => i['type']));
    // A helper's note, with a link to its change's review page.
    const note = tab.querySelector<HTMLElement>('li[data-type="agent-note"]');
    expect(note?.textContent).toContain('Checked it with two unit tests');
    expect(within(note as HTMLElement).getByTestId('comment-author').textContent).toBe(
      'API builder',
    );
    expect(
      within(note as HTMLElement)
        .getByTestId('activity-link')
        .getAttribute('href'),
    ).toBe(`#/p/${PROJECT_ID}/tickets/${LOOP_TICKET_ID}/changes/${L_API}?run=${LOOP_RUN_ID}`);
    // The run facts card (ADR-0024's facts moved here), linking to the ticket branch's files.
    const facts = tab.querySelector<HTMLElement>('li[data-type="run-facts"]');
    expect(within(facts as HTMLElement).getByTestId('run-summary')).toBeTruthy();
    // The pull request line links out to GitHub.
    const pr = tab.querySelector<HTMLElement>('li[data-type="pull-request"]');
    expect(within(pr as HTMLElement).getByTestId('merge-line')).toBeTruthy();
    const out = within(pr as HTMLElement).getByTestId('activity-link');
    expect(out.getAttribute('href')).toBe('https://github.com/example/app/pull/7');
    expect(out.getAttribute('rel')).toBe('noopener noreferrer');
    // The owner's comment is not repeated here.
    expect(tab.textContent).not.toContain('slow queries from last week');
  });

  it('filters by actor with pressed chips', async () => {
    renderPage(withActivity(loopReviewScenario()), 'conversation');
    const tab = await screen.findByTestId('activity');
    const group = within(tab).getByRole('group', { name: 'Show' });
    const everyone = within(group).getByRole('button', { name: /Everyone/ });
    expect(everyone.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(group).getByRole('button', { name: /^Lead/ }));
    expect(everyone.getAttribute('aria-pressed')).toBe('false');
    const shown = [...tab.querySelectorAll('li[data-type]')].map((li) =>
      li.getAttribute('data-type'),
    );
    expect(shown).toEqual(['note', 'decision']);
    fireEvent.click(everyone);
    expect(tab.querySelectorAll('li[data-type]')).toHaveLength(ACTIVITY_ITEMS.length);
  });

  it('reads the ticket’s own records on a server without the activity route', async () => {
    const sc = withActivity(loopReviewScenario());
    delete sc.routes[ACTIVITY_PATH];
    renderPage(sc, 'conversation');
    const tab = await screen.findByTestId('activity');
    expect(tab.querySelectorAll('li[data-author="reviewer"]')).toHaveLength(3);
    expect(within(tab).queryByText(/couldn’t be loaded/)).toBeNull();
  });

  it('says so when the activity fails, and still shows the ticket’s records', async () => {
    renderPage(withActivity(loopReviewScenario()), 'conversation', {
      [ACTIVITY_PATH]: () =>
        jsonResponse(500, { error: { code: 'internal', message: 'boom', requestId: 'r' } }),
    });
    const tab = await screen.findByTestId('activity');
    expect(within(tab).getByText('The conversation couldn’t be loaded.')).toBeTruthy();
    expect(tab.querySelectorAll('li[data-author="reviewer"]')).toHaveLength(3);
  });
});

describe('Files changed after a merge (ADR-0026 §5)', () => {
  it('shows the merged files read only, with no review links', async () => {
    // The server's answer for the merged branch: the files from the recorded commits.
    const run = (loopDoneScenario().routes[LOOP_TICKET_PATH] as Record<string, unknown>)[
      'currentRun'
    ] as Record<string, unknown>;
    renderPage(loopDoneScenario(), 'files', {
      [LOOP_BRANCH_PATH]: { ...ticketBranchReview(), ticketBranch: run['ticketBranch'] },
    });
    const files = await screen.findByTestId('merged-files');
    expect(within(files).getByText('3 changed files')).toBeTruthy();
    expect(within(files).getByTestId('branch-diff')).toBeTruthy();
    expect(screen.getByTestId('merged-read-only').textContent).toBe('Merged: read only');
    expect(screen.queryByTestId('review-all-files')).toBeNull();
    expect(screen.queryAllByTestId('change-files-link')).toHaveLength(0);
  });

  it('says the files are no longer available when the commits are gone', async () => {
    renderPage(loopDoneScenario(), 'files', {
      [LOOP_BRANCH_PATH]: () =>
        jsonResponse(410, {
          error: { code: 'commits_unavailable', message: 'gone', requestId: 'r' },
        }),
    });
    expect(await screen.findByTestId('merged-files-unavailable')).toBeTruthy();
    expect(screen.getByText('The files of this merge are no longer available')).toBeTruthy();
  });

  it('tells a refusal about missing commits from other errors', () => {
    const err = (status: number, code: string | null) =>
      new ApiError({ kind: 'http', path: '/x', status, code, message: 'm' });
    expect(isGoneError(err(410, null))).toBe(true);
    expect(isGoneError(err(409, 'ticket_branch_missing'))).toBe(true);
    expect(isGoneError(err(404, 'commits_unavailable'))).toBe(true);
    expect(isGoneError(err(404, 'not_found'))).toBe(false);
    expect(isGoneError(err(500, 'internal'))).toBe(false);
    expect(mergedFilesState({ data: undefined, error: null })).toEqual({ state: 'loading' });
  });
});
