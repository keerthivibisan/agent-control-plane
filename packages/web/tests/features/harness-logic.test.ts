import { describe, expect, it } from 'vitest';
import {
  canRunChecks,
  groupMainRuns,
  offerBuild,
  pickHarnessTicket,
  runErrorText,
  summarize,
} from '../../src/features/harness/logic';
import { MainCheckRuns } from '../../src/features/harness/main-check-runs';
import { ApiError, createApiClient } from '../../src/lib/api';
import { formatSeconds, HARNESS_PAGE_COPY } from '../../src/lib/copy';
import { card, CSRF } from '../fixtures/board';
import { checkRun, checkRuns, harnessTicket, PROJECT_ID } from '../fixtures/project-setup';
import { fakeServer, jsonResponse } from '../helpers';

const CHECKS = `/api/projects/${PROJECT_ID}/harness/checks`;

describe('harness page logic', () => {
  it('runs checks only with a readable manifest', () => {
    expect(canRunChecks('ready')).toBe(true);
    expect(canRunChecks('partial')).toBe(true);
    expect(canRunChecks('invalid')).toBe(false);
    expect(canRunChecks('none')).toBe(false);
  });

  it('picks the newest harness ticket that was not cancelled', () => {
    const old = card({
      id: 't-1',
      key: 'WEB-1',
      stage: 'DONE',
      type: 'harness',
      createdAt: '2026-10-10T09:00:00.000Z',
    });
    const newer = card({
      id: 't-5',
      key: 'WEB-5',
      stage: 'PLANNING',
      type: 'harness',
      createdAt: '2026-10-12T09:00:00.000Z',
    });
    const cancelled = card({
      id: 't-7',
      key: 'WEB-7',
      stage: 'CANCELLED',
      type: 'harness',
      createdAt: '2026-10-14T09:00:00.000Z',
    });
    const feature = card({ id: 't-8', key: 'WEB-8', stage: 'READY' });
    expect(pickHarnessTicket([old, cancelled, newer, feature], null)?.id).toBe('t-5');
    expect(pickHarnessTicket([cancelled, feature], null)).toBeNull();
    expect(pickHarnessTicket(undefined, null)).toBeNull();
    // A ticket just created here shows before the list is refetched, unless the list is newer.
    const created = harnessTicket();
    expect(pickHarnessTicket([feature], created)?.id).toBe(created.id);
    expect(
      pickHarnessTicket([newer], { ...created, createdAt: '2026-10-01T00:00:00.000Z' })?.id,
    ).toBe('t-5');
  });

  it('offers "Build the harness" only without a harness and without an open harness ticket', () => {
    expect(offerBuild('none', null)).toBe(true);
    expect(offerBuild('none', { stage: 'PLANNING' })).toBe(false);
    expect(offerBuild('none', { stage: 'IN_REVIEW' })).toBe(false);
    // Done but still no harness (its changes were discarded): a new ticket may be made.
    expect(offerBuild('none', { stage: 'DONE' })).toBe(true);
    expect(offerBuild('invalid', null)).toBe(false);
    expect(offerBuild('ready', null)).toBe(false);
  });

  it('summarizes a run: passed of total, and the required checks that did not pass', () => {
    expect(summarize(checkRuns())).toEqual({ total: 2, passed: 1, requiredFailed: [] });
    const runs = [
      checkRun({ checkId: 'test', name: 'Unit tests', status: 'timed-out', exitCode: null }),
      checkRun({ checkId: 'build', name: 'Build', status: 'skipped' }),
      checkRun({ checkId: 'lint', name: 'Lint', required: false, status: 'failed' }),
    ];
    expect(summarize(runs)).toEqual({
      total: 3,
      passed: 0,
      requiredFailed: ['Unit tests', 'Build'],
    });
  });

  it('explains known refusals in words and falls back to the generic line', () => {
    const err = (code: string | null) =>
      new ApiError({ kind: 'http', path: CHECKS, status: 409, code, message: 'x' });
    expect(runErrorText(err('checks_running'))).toContain('already running');
    expect(runErrorText(err('no_commits'))).toContain('no commits');
    expect(runErrorText(err('something_else'))).toBe(HARNESS_PAGE_COPY.runs.failed);
    expect(runErrorText(err(null))).toBe(HARNESS_PAGE_COPY.runs.failed);
  });

  it('formats time limits in seconds and minutes', () => {
    expect(formatSeconds(45)).toBe('45 s');
    expect(formatSeconds(600)).toBe('10 min');
    expect(formatSeconds(90)).toBe('1 min 30 s');
  });
});

describe('main-branch history grouped into runs (GET …/harness/checks)', () => {
  const at = (iso: string, checkId: string, durationMs = 1_000) =>
    checkRun({ id: `${checkId}@${iso}`, checkId, name: checkId, startedAt: iso, durationMs });

  it('puts checks that follow each other into one run, newest run first', () => {
    // Newest first, as the route answers.
    const rows = [
      at('2026-10-16T10:00:05.000Z', 'lint'),
      at('2026-10-16T10:00:00.000Z', 'test', 5_000),
      at('2026-10-16T09:00:03.000Z', 'lint'),
      at('2026-10-16T09:00:00.000Z', 'test', 3_000),
    ];
    const runs = groupMainRuns(rows);
    expect(runs.map((r) => r.results.map((c) => c.checkId))).toEqual([
      ['test', 'lint'],
      ['test', 'lint'],
    ]);
    expect(runs[0]?.startedAt).toBe('2026-10-16T10:00:00.000Z');
    expect(runs[0]?.id).toBe('test@2026-10-16T10:00:00.000Z');
  });

  it('starts a new run when a check repeats, even right after the last one', () => {
    const runs = groupMainRuns([
      at('2026-10-16T10:00:02.000Z', 'test'),
      at('2026-10-16T10:00:00.000Z', 'test', 2_000),
    ]);
    expect(runs).toHaveLength(2);
  });

  it('starts a new run after a pause longer than a minute, and keeps an empty history empty', () => {
    const runs = groupMainRuns([
      at('2026-10-16T10:05:00.000Z', 'lint'),
      at('2026-10-16T10:00:00.000Z', 'test'),
    ]);
    expect(runs.map((r) => r.results.length)).toEqual([1, 1]);
    expect(groupMainRuns([])).toEqual([]);
  });
});

describe('main-branch check runs (this app session)', () => {
  const now = () => new Date('2026-10-16T10:00:00.000Z');

  it('keeps every attempt, newest first, and never starts a second one while one runs', async () => {
    let release: (r: Response) => void = () => {};
    const server = fakeServer({
      '/api/control/token': { token: CSRF },
      [`POST ${CHECKS}`]: () => jsonResponse(200, checkRuns()),
    });
    const fetch: typeof server.fetch = (input, init) =>
      init?.method === 'POST'
        ? new Promise<Response>((resolve) => {
            release = resolve;
          }).then(() => server.fetch(input, init))
        : server.fetch(input, init);
    const invalidated: string[] = [];
    const runs = new MainCheckRuns(
      createApiClient(fetch),
      (match) => {
        for (const k of [`/api/projects/${PROJECT_ID}/harness`, '/api/sessions']) {
          if (match(k)) invalidated.push(k);
        }
      },
      now,
    );
    let changes = 0;
    runs.subscribe(() => changes++);
    const first = runs.start(PROJECT_ID);
    expect(runs.running(PROJECT_ID)).toBe(true);
    expect(runs.attempts(PROJECT_ID)[0]?.startedAt).toBe('2026-10-16T10:00:00.000Z');
    await runs.start(PROJECT_ID); // ignored: one is running
    expect(runs.attempts(PROJECT_ID)).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 0));
    release(new Response());
    await first;
    expect(runs.running(PROJECT_ID)).toBe(false);
    expect(runs.attempts(PROJECT_ID)[0]?.results).toHaveLength(2);
    expect(changes).toBe(2);
    // The harness status is refetched afterwards; unrelated views are not.
    expect(invalidated).toEqual([`/api/projects/${PROJECT_ID}/harness`]);
    expect(runs.attempts('p-other')).toEqual([]);
  });

  it('keeps a refusal on the attempt instead of throwing', async () => {
    const server = fakeServer({
      '/api/control/token': { token: CSRF },
      [`POST ${CHECKS}`]: () =>
        jsonResponse(409, {
          error: { code: 'checks_running', message: 'already running', requestId: 'r1' },
        }),
    });
    const runs = new MainCheckRuns(createApiClient(server.fetch), () => {}, now);
    await runs.start(PROJECT_ID);
    const [attempt] = runs.attempts(PROJECT_ID);
    expect(attempt?.state).toBe('failed');
    expect(attempt?.error?.code).toBe('checks_running');
    expect(server.calls.find((c) => c.method === 'POST')?.body).toEqual({});
  });
});
