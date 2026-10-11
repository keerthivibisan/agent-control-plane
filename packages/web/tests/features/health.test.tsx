import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DataHealthPage } from '../../src/features/health/DataHealthPage';
import { summarizeHealth } from '../../src/features/health/health-summary';
import { capabilities, diagnostics, T1 } from '../fixtures/dto';
import { fakeServer, renderWithApi } from '../helpers';

const source = (sourcePath: string, parseErrors = 0) => ({
  sourcePath,
  byteOffset: 10,
  sizeBytes: 10,
  parseErrors,
  updatedAt: T1,
});

const healthy = diagnostics({
  sources: [source('projects/-repo/a.jsonl'), source('projects/-repo/b.jsonl')],
  adapters: [
    {
      provider: 'claude-code',
      fileIssues: [],
      ignoredRecords: [{ recordType: 'file-history-snapshot', count: 12601 }],
      parseErrors: 0,
    },
  ],
  ingestion: {
    pipeline: { eventsInvalid: 0, batchesFailed: 0 },
    scheduler: { polls: 17, pollErrors: 0, lastPollAt: T1 },
  },
});

const troubled = diagnostics({
  sources: [source('projects/-repo/a.jsonl', 2)],
  unrecognized: [{ providerVersion: '2.1.0', recordType: 'mystery-type', count: 2 }],
  adapters: [
    {
      provider: 'claude-code',
      fileIssues: [{ path: 'projects/-repo/big.jsonl', reason: 'size-cap', detail: 'EFBIG' }],
      ignoredRecords: [
        { recordType: 'file-history-snapshot', count: 12601 },
        { recordType: 'queue-operation', count: 3 },
      ],
      parseErrors: 1,
    },
  ],
  edgeConflictCount: 4,
  ingestion: {
    pipeline: { eventsInvalid: 4, batchesFailed: 2 },
    scheduler: { polls: 17, pollErrors: 1, lastPollAt: T1 },
  },
});

describe('Data health (#/health)', () => {
  it('leads with "All good" when nothing went wrong', async () => {
    renderWithApi(<DataHealthPage />, fakeServer({ '/api/diagnostics/ingestion': healthy }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Data health' })).toBeTruthy();
    const summary = await screen.findByTestId('health-summary');
    expect(summary.getAttribute('data-state')).toBe('good');
    expect(summary.textContent).toContain('All good: 2 files read, no problems.');
    expect(screen.getByText('Every file was readable.')).toBeTruthy();
    expect(screen.getByText('No damaged lines.')).toBeTruthy();
    expect(screen.getByText('Every record was of a known kind.')).toBeTruthy();
  });

  it('lists what needs attention, in plain words', async () => {
    renderWithApi(<DataHealthPage />, fakeServer({ '/api/diagnostics/ingestion': troubled }));
    const summary = await screen.findByTestId('health-summary');
    expect(summary.getAttribute('data-state')).toBe('attention');
    expect(summary.textContent).toContain('6 things need a look');
    const problems = within(summary).getByTestId('health-problems');
    const text = (k: string) => problems.querySelector(`[data-problem="${k}"]`)?.textContent;
    expect(text('fileIssues')).toBe('1 file could not be read');
    // 2 per file (stored) and 1 since start (adapter): the larger, never the sum.
    expect(text('parseErrors')).toBe('2 lines could not be read');
    expect(text('unknownRecords')).toBe('2 records of an unknown kind');
    expect(text('pollErrors')).toBe('1 check for new activity failed');
    expect(text('failedBatches')).toBe('2 batches of updates were not saved');
    expect(text('invalidEvents')).toBe('4 updates were rejected as invalid');
    // Conflicts are resolved by rule and skipped records are by design: not problems.
    expect(problems.textContent).not.toMatch(/conflict|skipped/i);
  });

  it('explains file problems, and keeps known skipped records apart from unknown ones', async () => {
    renderWithApi(<DataHealthPage />, fakeServer({ '/api/diagnostics/ingestion': troubled }));
    const files = await screen.findByTestId('file-issues');
    expect(files.textContent).toContain('Too large to read, so it was skipped.');
    expect(files.textContent).toContain('projects/-repo/big.jsonl');

    const skipped = screen.getByRole('region', { name: 'Known, skipped on purpose' });
    const ignored = within(skipped).getByTestId('ignored-records');
    expect(ignored.textContent).toContain('file-history-snapshot');
    expect(ignored.textContent).toContain('12,601 records');
    expect(ignored.textContent).toContain('3 records');
    expect(ignored.textContent).not.toContain('mystery-type');

    const unknown = screen.getByRole('region', { name: 'Unknown records' });
    const list = within(unknown).getByTestId('unrecognized-records');
    expect(list.textContent).toContain('mystery-type');
    expect(list.textContent).toContain('Claude Code 2.1.0');
    expect(list.textContent).not.toContain('file-history-snapshot');

    const parse = screen.getByRole('region', { name: 'Lines that could not be read' });
    expect(parse.textContent).toContain('Claude Code: 1 line skipped since the app started');
    expect(parse.textContent).toContain('projects/-repo/a.jsonl');
  });

  it('shows the reading counters with a relative time, "Not yet" before the first check', async () => {
    renderWithApi(<DataHealthPage />, fakeServer({ '/api/diagnostics/ingestion': troubled }));
    const counters = await screen.findByTestId('ingestion-counters');
    const value = (label: string) =>
      within(counters).getByText(label).closest('div')?.querySelector('dd');
    expect(value('Checks for new activity')?.textContent).toBe('17');
    expect(value('Failed checks')?.textContent).toBe('1');
    expect(value('Updates not saved')?.textContent).toBe('2');
    expect(value('Updates rejected as invalid')?.textContent).toBe('4');
    expect(value('Conflicting parent information')?.textContent).toBe('4');
    expect(value('Last check')?.querySelector('time')).toBeTruthy();
  });

  it('says it is getting ready before the first check, without inventing a time', async () => {
    renderWithApi(<DataHealthPage />, fakeServer({ '/api/diagnostics/ingestion': diagnostics() }));
    const summary = await screen.findByTestId('health-summary');
    expect(summary.getAttribute('data-state')).toBe('first-read');
    const counters = screen.getByTestId('ingestion-counters');
    expect(
      within(counters).getByText('Last check').closest('div')?.querySelector('dd')?.textContent,
    ).toBe('Not yet');
  });

  it('describes capabilities in plain words, with limitations collapsed', async () => {
    renderWithApi(
      <DataHealthPage />,
      fakeServer({
        '/api/diagnostics/ingestion': healthy,
        '/api/capabilities': capabilities(),
      }),
    );
    const card = await screen.findByRole('region', { name: 'What this app can see' });
    await within(card).findByText('Claude Code');
    expect(card.textContent).toContain('Which session started which helper agent');
    expect(card.textContent).toContain('Hooks received: No');
    expect(card.textContent).toContain('Claude Code versions seen: 2.1.0');
    const limits = within(card).getByTestId('limitations');
    expect(limits.textContent).toContain('cumulative snapshot scope unknown');
    expect(limits.closest('details')?.hasAttribute('open')).toBe(false);
  });

  it('keeps raw counters under Technical details', async () => {
    renderWithApi(<DataHealthPage />, fakeServer({ '/api/diagnostics/ingestion': troubled }));
    const raw = await screen.findByTestId('health-raw');
    expect(raw.hasAttribute('open')).toBe(false);
    expect(raw.textContent).toContain('ingestion.pipeline.batchesFailed');
    expect(raw.textContent).toContain('size-cap (EFBIG)');
  });
});

describe('summarizeHealth', () => {
  it('ignores skipped records and conflicts and takes the larger damaged-line count', () => {
    const s = summarizeHealth(
      diagnostics({
        sources: [source('a', 1)],
        edgeConflictCount: 3,
        usageConflictCount: 3,
        adapters: [
          {
            provider: 'claude-code',
            fileIssues: [],
            ignoredRecords: [{ recordType: 'x', count: 9 }],
            parseErrors: 5,
          },
        ],
      }),
    );
    expect(s.state).toBe('attention');
    expect(s.problems).toEqual([
      { key: 'parseErrors', count: 5, text: '5 lines could not be read' },
    ]);
  });
});
