import { TicketTotalsDtoSchema } from '@acp/core/api';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  LOOP_TICKET_ID,
  LOOP_TICKET_PATH,
  PROJECT_ID,
  loopReviewScenario,
} from '../../e2e/review-loop-fixtures';
import { RUNNING_NOW, TOTALS_PATH, ticketTotals } from '../../e2e/totals-fixtures';
import { TicketTotalsBadge } from '../../src/features/ticket/TicketTotalsBadge';
import { TicketPage } from '../../src/features/ticket/TicketPage';
import {
  badgeLabel,
  badgeTime,
  badgeTimeText,
  badgeTokensText,
  formatSpan,
  isPartial,
} from '../../src/features/ticket/ticket-totals';
import { TICKET_TOTALS_COPY } from '../../src/lib/copy';
import { fakeServer, renderWithApi } from '../helpers';

/*
 * v0.3.0 T-A: the ticket badge (time taken and tokens; no cost) at the right end of the ticket
 * header's state line, with its details in a popover.
 */

beforeAll(() => {
  if (typeof globalThis.DOMMatrixReadOnly === 'undefined') {
    class Matrix {
      m22 = 1;
    }
    Object.assign(globalThis, { DOMMatrixReadOnly: Matrix });
  }
  for (const prop of ['offsetWidth', 'offsetHeight'] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 800 });
  }
  Object.assign(SVGElement.prototype, {
    getBBox: () => ({ x: 0, y: 0, width: 0, height: 0 }),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const T = TICKET_TOTALS_COPY;
const parse = (kind: Parameters<typeof ticketTotals>[0]) =>
  TicketTotalsDtoSchema.parse(ticketTotals(kind));
const MIN = 60_000;

describe('ticket totals rules', () => {
  it('the fixtures match the contract', () => {
    for (const kind of ['done', 'running', 'none', 'unavailable', 'partial'] as const) {
      expect(TicketTotalsDtoSchema.safeParse(ticketTotals(kind)).success).toBe(true);
    }
  });

  it('formats a span short enough for a badge', () => {
    expect(formatSpan(-5)).toBe('0s');
    expect(formatSpan(45_400)).toBe('45s');
    expect(formatSpan(14 * MIN + 59_000)).toBe('14m');
    expect(formatSpan(72 * MIN)).toBe('1h 12m');
    expect(formatSpan(180 * MIN)).toBe('3h');
    expect(formatSpan(52 * 60 * MIN)).toBe('2d 4h');
    expect(formatSpan(48 * 60 * MIN)).toBe('2d');
  });

  it('took, running or open; hidden before the first run', () => {
    const done = parse('done');
    expect(badgeTime(done, Date.now())).toEqual({ kind: 'took', ms: 72 * MIN });
    expect(badgeTimeText({ kind: 'took', ms: 72 * MIN })).toBe('Took 1h 12m');
    expect(badgeTime(parse('none'), Date.now())).toBeNull();

    const running = parse('running');
    // At the server's answer: its elapsed time; later, this browser's clock moves it on.
    expect(badgeTime(running, RUNNING_NOW.getTime())).toEqual({ kind: 'running', ms: 14 * MIN });
    expect(badgeTime(running, RUNNING_NOW.getTime() + 6 * MIN)).toEqual({
      kind: 'running',
      ms: 20 * MIN,
    });
    // A browser clock behind the server's never makes it go back.
    expect(badgeTime(running, RUNNING_NOW.getTime() - 10 * MIN)?.ms).toBe(14 * MIN);

    const stopped = {
      ...running,
      runs: running.runs.map((r) => ({ ...r, endedAt: r.startedAt, durationMs: 0 })),
    };
    expect(
      badgeTimeText(badgeTime(stopped, RUNNING_NOW.getTime()) ?? { kind: 'open', ms: 0 }),
    ).toBe('Open for 14m');
  });

  it('tokens as the Tokens page counts them; unavailable stays unavailable, never 0', () => {
    expect(badgeTokensText(parse('done'))).toBe('1.2M tokens');
    expect(badgeTokensText(parse('unavailable'))).toBeNull();
    expect(badgeLabel({ kind: 'took', ms: 72 * MIN }, parse('done'))).toBe(
      'Took 1h 12m, 1,234,567 tokens used. Show details',
    );
    expect(badgeLabel({ kind: 'took', ms: 72 * MIN }, parse('unavailable'))).toBe(
      'Took 1h 12m, token usage unavailable. Show details',
    );
    expect(isPartial(parse('done'))).toBe(false);
    expect(isPartial(parse('partial'))).toBe(true);
  });
});

function renderBadge(kind: Parameters<typeof ticketTotals>[0], now = () => RUNNING_NOW) {
  const s = fakeServer({ [TOTALS_PATH]: ticketTotals(kind) });
  return renderWithApi(
    <div>
      <TicketTotalsBadge ticket={{ id: LOOP_TICKET_ID, projectId: PROJECT_ID }} now={now} />
    </div>,
    s,
  );
}

describe('the ticket badge', () => {
  it('done: the time it took and its tokens, one sentence for a screen reader, no cost', async () => {
    renderBadge('done');
    const badge = await screen.findByTestId('ticket-totals-badge');
    expect(within(badge).getByTestId('ticket-totals-time').textContent).toBe('Took 1h 12m');
    expect(within(badge).getByTestId('ticket-totals-tokens').textContent).toBe('1.2M tokens');
    expect(badge.getAttribute('aria-label')).toBe(
      'Took 1h 12m, 1,234,567 tokens used. Show details',
    );
    expect(badge.textContent).not.toMatch(/\$|cost/i);
  });

  it('opens the details: start, finish, each run, the token split and Open in Tokens', async () => {
    renderBadge('partial');
    fireEvent.click(await screen.findByTestId('ticket-totals-badge'));
    const details = await screen.findByTestId('ticket-totals-details');
    expect(details.getAttribute('role')).toBe('dialog');
    expect(within(details).getByTestId('totals-started').textContent).toMatch(/2026/);
    expect(within(details).getByTestId('totals-finished').textContent).toMatch(/2026/);
    expect(within(details).getByTestId('totals-elapsed').textContent).toBe('1h 12m');
    expect(within(details).getByTestId('totals-runs').textContent).toBe('Run 11h 12m');
    const split = within(details).getByTestId('totals-tokens');
    expect(within(split).getByText('34,567')).toBeTruthy();
    expect(within(split).getByText('200,000')).toBeTruthy();
    // Cache write was not reported by every record: a lower bound, said so.
    expect(within(split).getAllByText(T.partial)).toHaveLength(2);
    expect(within(details).getByTestId('totals-total').textContent).toContain('1,234,567');
    expect(within(details).getByTestId('totals-open-tokens').getAttribute('href')).toBe(
      `#/p/${PROJECT_ID}/tokens?by=ticket`,
    );
    expect(details.textContent).not.toMatch(/\$|USD/);
  });

  it('usage unavailable: a dash and the words, never 0', async () => {
    renderBadge('unavailable');
    const badge = await screen.findByTestId('ticket-totals-badge');
    expect(within(badge).getByTestId('ticket-totals-tokens').textContent).toBe(
      `${T.noTokens}usage unavailable`,
    );
    fireEvent.click(badge);
    const split = within(await screen.findByTestId('ticket-totals-details')).getByTestId(
      'totals-tokens',
    );
    expect(within(split).getAllByText('Not reported')).toHaveLength(5);
    expect(split.textContent).not.toContain('0');
  });

  it('running: moves on every 30 seconds with the clock; a live run reads running', async () => {
    let now = RUNNING_NOW.getTime();
    const ticks: (() => void)[] = [];
    const real = globalThis.setInterval;
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: () => void, ms?: number) => {
      if (ms === 30_000) {
        ticks.push(fn);
        return 0;
      }
      return real(fn, ms);
    }) as typeof setInterval);
    renderBadge('running', () => new Date(now));
    const badge = await screen.findByTestId('ticket-totals-badge');
    expect(badge.getAttribute('data-kind')).toBe('running');
    expect(within(badge).getByTestId('ticket-totals-time').textContent).toBe('Running 14m');
    expect(ticks.length).toBeGreaterThan(0);
    now += 2 * MIN;
    act(() => ticks.at(-1)?.());
    expect(within(badge).getByTestId('ticket-totals-time').textContent).toBe('Running 16m');
    fireEvent.click(badge);
    const details = await screen.findByTestId('ticket-totals-details');
    expect(within(details).getByTestId('totals-finished').textContent).toBe(T.notFinished);
    expect(within(details).getByTestId('totals-runs').textContent).toBe(`Run 1${T.live}`);
  });

  it('a finished ticket does not tick', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    renderBadge('done');
    await screen.findByTestId('ticket-totals-badge');
    expect(spy.mock.calls.some((c) => c[1] === 30_000)).toBe(false);
  });

  it('is hidden before the first run, and when the server can’t tell', async () => {
    const view = renderBadge('none');
    await act(() => new Promise((r) => setTimeout(r, 30)));
    expect(view.queryByTestId('ticket-totals')).toBeNull();
    view.unmount();
    renderWithApi(
      <TicketTotalsBadge ticket={{ id: LOOP_TICKET_ID, projectId: PROJECT_ID }} />,
      fakeServer({}),
    );
    await act(() => new Promise((r) => setTimeout(r, 30)));
    expect(screen.queryByTestId('ticket-totals')).toBeNull();
  });

  it('sits at the right end of the ticket header’s state line', async () => {
    const sc = loopReviewScenario();
    renderWithApi(
      <TicketPage id={LOOP_TICKET_ID} />,
      fakeServer({ ...sc.routes, [TOTALS_PATH]: ticketTotals('running') }),
    );
    const header = await screen.findByTestId('ticket-header');
    const badge = await within(header).findByTestId('ticket-totals');
    const line = within(header).getByTestId('ticket-stage').closest('div.flex-wrap');
    expect(line?.contains(badge)).toBe(true);
    expect(line?.lastElementChild).toBe(badge);
    expect(badge.className).toContain('ml-auto');
    expect(sc.routes[LOOP_TICKET_PATH]).toBeTruthy();
  });
});
