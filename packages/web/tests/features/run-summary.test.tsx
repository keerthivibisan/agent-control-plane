// The app's own comments on a ticket (ADR-0024 §3, v0.3.0 S-B): the run summary card and the line
// after a merge, next to the owner's, the lead's and the reviewer's comments, which are unchanged.
// Synthetic data only.
import { fireEvent, screen, within } from '@testing-library/react';
import { TicketDetailDtoSchema, type TicketCommentDto } from '@acp/core/api';
import { describe, expect, it } from 'vitest';
import { Timeline } from '../../src/features/ticket/Conversation';
import { ticketDetail, ticketDto } from '../fixtures/board';
import { runSummary } from '../fixtures/control';
import { fakeServer, renderWithApi } from '../helpers';

const SUMMARY = [
  'Run summary',
  '',
  'What the lead says:',
  'The login form now checks the email.',
  'Nothing else changed.',
  '',
  'Changes:',
  '- Frontend helper: 3 files, +40 −2; checks passed; merged',
  '- API helper: no changes',
  '',
  'Something the web does not know yet',
].join('\n');

/** The S-C layout, as the server writes it (synthetic). */
const HUMAN_NOTE =
  'Explored the settings code and found the theme is set in theme-store.ts.\nAdded a dark mode switch on the Settings page. Tested it with three unit tests; all checks pass.';
const HUMAN_DETAILS = [
  '- Plan v1 was approved with 1 step: Helpers.',
  '- Merged 1 change from Helpers: 2 files, 18 lines added; the check passed.',
  '- The ticket branch acp/WEB-12 (from main) has 1 change merged and is waiting for your merge.',
  '- Budget tokens used: 12,400 by the lead and 48,000 by 1 helper.',
];
const HUMAN = [
  'Run summary',
  '',
  'From the lead:',
  HUMAN_NOTE,
  '',
  'Details:',
  ...HUMAN_DETAILS,
].join('\n');
const NO_NOTE = [
  'Run summary',
  '',
  'The run was stopped before the work was handed over.',
  '',
  'Details:',
  '- No helpers were started.',
  '- Budget tokens used: 900 by the lead.',
].join('\n');

function comment(over: Partial<TicketCommentDto> & { id: string }): TicketCommentDto {
  return {
    ticketId: 't-1',
    runId: 'run-2',
    planId: null,
    author: 'owner',
    body: 'A comment',
    createdAt: '2026-10-21T09:00:00.000Z',
    ...over,
  };
}

function renderComments(comments: TicketCommentDto[]) {
  const base = ticketDetail(ticketDto({ id: 't-1', key: 'WEB-12' }));
  const detail = TicketDetailDtoSchema.parse({
    ...base,
    runs: [
      runSummary({ id: 'run-2', ticketId: 't-1' }),
      runSummary({ id: 'run-1', ticketId: 't-1' }),
    ],
    comments,
  });
  renderWithApi(
    <Timeline detail={detail} shownRunId="run-2" onShowRun={() => {}} />,
    fakeServer({}),
  );
  return screen.getByTestId('comments');
}

const byAuthor = (list: HTMLElement, author: string) =>
  [...list.querySelectorAll(`li[data-author="${author}"]`)] as HTMLElement[];

describe('ticket comments by the app', () => {
  it('shows a run summary as its own card, with headings, lists and the rest as written', () => {
    const list = renderComments([comment({ id: 'c-app', author: 'app', body: SUMMARY })]);
    const card = within(list).getByTestId('run-summary');
    expect(card.getAttribute('aria-label')).toBe('Run summary, Run 2');
    expect(within(card).getByRole('heading', { name: 'Run summary', level: 4 })).toBeTruthy();
    expect(within(card).getByTestId('comment-author').textContent).toBe('Agent Control Plane');
    expect(within(card).getByText('Run 2')).toBeTruthy();
    const headings = within(card)
      .getAllByRole('heading', { level: 5 })
      .map((h) => h.textContent);
    expect(headings).toEqual(['What the lead says', 'Changes']);
    const items = within(card)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(items).toEqual([
      'Frontend helper: 3 files, +40 −2; checks passed; merged',
      'API helper: no changes',
    ]);
    // Line breaks kept inside a paragraph; unknown text shown as is.
    const body = within(card).getByTestId('run-summary-body');
    const paragraphs = [...body.querySelectorAll('p')].map((p) => p.textContent);
    expect(paragraphs).toEqual([
      'The login form now checks the email.\nNothing else changed.',
      'Something the web does not know yet',
    ]);
    expect(body.querySelector('p')?.className).toContain('whitespace-pre-wrap');
    // The title line is the card's heading, not repeated in the body.
    expect(body.textContent).not.toContain('Run summary');
  });

  it('shows the lead’s note as the comment, with the details folded away (S-C)', () => {
    const list = renderComments([comment({ id: 'c-app', author: 'app', body: HUMAN })]);
    const card = within(list).getByTestId('run-summary');
    expect(card.getAttribute('data-layout')).toBe('comment');
    expect(card.getAttribute('aria-label')).toBe('Lead · Run summary, Run 2');
    expect(
      within(card).getByRole('heading', { name: 'Lead · Run summary', level: 4 }),
    ).toBeTruthy();
    expect(within(card).getByTestId('comment-author').textContent).toBe('Agent Control Plane');
    // The note is the comment's text, line breaks kept; the markers are not shown.
    const text = within(card).getByTestId('run-summary-text');
    expect(text.textContent).toBe(HUMAN_NOTE);
    expect(text.className).toContain('whitespace-pre-wrap');
    const body = within(card).getByTestId('run-summary-body');
    expect(body.textContent).not.toContain('From the lead');
    expect(body.textContent).not.toContain('Run summary');
    // The details are collapsed behind a "Details" disclosure, a native one the keyboard opens.
    const details = within(card).getByTestId<HTMLDetailsElement>('run-summary-details');
    expect(details.tagName).toBe('DETAILS');
    expect(details.open).toBe(false);
    const summary = within(details).getByText('Details');
    expect(summary.tagName).toBe('SUMMARY');
    fireEvent.click(summary);
    expect(details.open).toBe(true);
    // Opened, the facts read as today's sections: one list of short sentences.
    expect(
      within(details)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(HUMAN_DETAILS.map((l) => l.slice(2)));
  });

  it('shows the app’s one sentence as “Run summary” when the lead left no note', () => {
    const list = renderComments([comment({ id: 'c-app', author: 'app', body: NO_NOTE })]);
    const card = within(list).getByTestId('run-summary');
    expect(card.getAttribute('aria-label')).toBe('Run summary, Run 2');
    expect(within(card).getByRole('heading', { name: 'Run summary', level: 4 })).toBeTruthy();
    expect(within(card).queryByText(/^Lead/)).toBeNull();
    expect(within(card).getByTestId('run-summary-text').textContent).toBe(
      'The run was stopped before the work was handed over.',
    );
    const details = within(card).getByTestId<HTMLDetailsElement>('run-summary-details');
    expect(details.open).toBe(false);
    expect(within(details).getAllByRole('listitem')).toHaveLength(2);
  });

  it('says “updated” on a later handover’s summary', () => {
    const list = renderComments([
      comment({
        id: 'c-app',
        author: 'app',
        body: HUMAN.replace(/^Run summary/, 'Run summary (updated)'),
      }),
    ]);
    const card = within(list).getByTestId('run-summary');
    expect(
      within(card).getByRole('heading', { name: 'Lead · Run summary (updated)', level: 4 }),
    ).toBeTruthy();
    expect(within(card).getByTestId('run-summary-body').textContent).not.toContain('updated');
  });

  it('shows an older summary (no Details line) as before', () => {
    const list = renderComments([comment({ id: 'c-app', author: 'app', body: SUMMARY })]);
    const card = within(list).getByTestId('run-summary');
    expect(card.getAttribute('data-layout')).toBe('sections');
    expect(within(card).queryByTestId('run-summary-details')).toBeNull();
    expect(within(card).queryByTestId('run-summary-text')).toBeNull();
  });

  it('shows the merge note as a small line, not a card', () => {
    const list = renderComments([
      comment({ id: 'c-merge', author: 'app', body: 'Merged acp/WEB-12 into main at 1a2b3c4' }),
    ]);
    expect(within(list).queryByTestId('run-summary')).toBeNull();
    const line = within(list).getByTestId('merge-line');
    expect(line.textContent).toContain('Merged acp/WEB-12 into main at 1a2b3c4');
    expect([...line.querySelectorAll('code')].map((c) => c.textContent)).toEqual([
      'acp/WEB-12',
      'main',
      '1a2b3c4',
    ]);
    // Screen readers hear who wrote it.
    expect(line.textContent).toContain('Agent Control Plane');
  });

  it('shows the tip checks after the commit in the merge note', () => {
    const list = renderComments([
      comment({
        id: 'c-merge',
        author: 'app',
        body: 'Merged acp/WEB-12 into main at 1a2b3c4; checks passed on the tip (2).',
      }),
    ]);
    const line = within(list).getByTestId('merge-line');
    expect([...line.querySelectorAll('code')].map((c) => c.textContent)).toEqual([
      'acp/WEB-12',
      'main',
      '1a2b3c4',
    ]);
    expect(within(line).getByTestId('merge-detail').textContent).toBe(
      '; checks passed on the tip (2)',
    );
    expect(line.textContent).toContain('1a2b3c4; checks passed on the tip (2)');
  });

  it('shows a pull request merged on GitHub as a small line: the number as text, the commit as code', () => {
    const list = renderComments([
      comment({
        id: 'c-pr-merged',
        author: 'app',
        body: 'Merged via pull request #12 into develop at abc1234; checks passed on the tip (2).',
      }),
    ]);
    expect(within(list).queryByTestId('run-summary')).toBeNull();
    const line = within(list).getByTestId('merge-line');
    expect(line.getAttribute('data-kind')).toBe('pr-merged');
    expect(line.textContent).toContain(
      'Merged via pull request #12 into develop at abc1234; checks passed on the tip (2)',
    );
    expect([...line.querySelectorAll('code')].map((c) => c.textContent)).toEqual([
      'develop',
      'abc1234',
    ]);
    expect(within(line).getByTestId('merge-detail').textContent).toBe(
      '; checks passed on the tip (2)',
    );
    expect(within(line).queryByRole('link')).toBeNull();
  });

  it('shows the push to a pull request as a small line, opened or already open', () => {
    const list = renderComments([
      comment({
        id: 'c-pr-opened',
        author: 'app',
        body: 'Pushed feature/WEB-12 and opened pull request #12 into develop.',
      }),
      comment({
        id: 'c-pr-again',
        author: 'app',
        body: 'Pushed feature/WEB-12; pull request #12 into develop was already open.',
      }),
    ]);
    expect(within(list).queryByTestId('run-summary')).toBeNull();
    const [opened, again] = within(list).getAllByTestId('merge-line');
    expect(opened?.getAttribute('data-kind')).toBe('pr-pushed');
    expect(opened?.textContent).toContain(
      'Pushed feature/WEB-12 and opened pull request #12 into develop',
    );
    expect(again?.textContent).toContain(
      'Pushed feature/WEB-12; pull request #12 into develop was already open',
    );
    for (const line of [opened, again]) {
      expect([...(line?.querySelectorAll('code') ?? [])].map((c) => c.textContent)).toEqual([
        'feature/WEB-12',
        'develop',
      ]);
      expect(line?.textContent).toContain('Agent Control Plane');
    }
  });

  it('shows a summary without a run, and a summary of plain text, as a card too', () => {
    const list = renderComments([
      comment({ id: 'c-1', author: 'app', runId: null, body: 'Stopped before the handover.' }),
    ]);
    const card = within(list).getByTestId('run-summary');
    expect(card.getAttribute('aria-label')).toBe('Run summary');
    expect(within(card).getByText('Stopped before the handover.')).toBeTruthy();
  });

  it('leaves the owner’s, the lead’s and the reviewer’s comments as they were', () => {
    const list = renderComments([
      comment({
        id: 'c-o',
        author: 'owner',
        body: 'Please add tests',
        createdAt: '2026-10-21T08:00:00.000Z',
      }),
      comment({
        id: 'c-l',
        author: 'lead',
        body: 'Will do',
        createdAt: '2026-10-21T08:01:00.000Z',
      }),
      comment({
        id: 'c-r',
        author: 'reviewer',
        body: 'Two findings',
        createdAt: '2026-10-21T08:02:00.000Z',
      }),
      comment({ id: 'c-a', author: 'app', body: SUMMARY, createdAt: '2026-10-21T08:03:00.000Z' }),
    ]);
    const label = (author: string) =>
      within(byAuthor(list, author)[0] as HTMLElement).getByTestId('comment-author').textContent;
    expect(label('owner')).toBe('You');
    expect(label('lead')).toBe('Lead agent');
    expect(label('reviewer')).toBe('Reviewer');
    expect(label('app')).toBe('Agent Control Plane');
    for (const author of ['owner', 'lead', 'reviewer']) {
      const li = byAuthor(list, author)[0] as HTMLElement;
      expect(within(li).queryByTestId('run-summary')).toBeNull();
    }
    // Oldest first, the summary last.
    expect(
      [...list.querySelectorAll('li[data-author]')].map((li) => li.getAttribute('data-author')),
    ).toEqual(['owner', 'lead', 'reviewer', 'app']);
  });
});
