import type { TokensRangeQuery } from '../../lib/api';
import type { DatePreset, TokensBreakdownWord } from '../../lib/copy';
import { href } from '../../lib/router';

/**
 * The Tokens page's state lives in the hash (`#/p/:id/tokens?range=7d&by=model`), so a view is
 * linkable. A preset is stored by name, not as dates, so a bookmarked "Last 7 days" still means
 * the last 7 days tomorrow; a custom range stores its `from`/`to` UTC days (both inclusive).
 */
export interface TokensParams {
  preset: DatePreset;
  /** Date-only UTC days, inclusive of both. */
  from?: string | undefined;
  to?: string | undefined;
  by: TokensBreakdownWord;
}

const BREAKDOWNS: readonly TokensBreakdownWord[] = ['session', 'ticket', 'role', 'model'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

const validDate = (v: string | null) =>
  v !== null && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00.000Z`)) ? v : undefined;
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The inclusive UTC days a preset covers, ending today (UTC). */
export function presetDays(preset: '7d' | '30d', now: Date): { from: string; to: string } {
  const days = preset === '7d' ? 7 : 30;
  const today = Date.parse(`${utcDay(now.getTime())}T00:00:00.000Z`);
  return { from: utcDay(today - (days - 1) * DAY_MS), to: utcDay(today) };
}

export function readTokensParams(search: URLSearchParams, now: Date): TokensParams {
  const byParam = search.get('by');
  const by = BREAKDOWNS.find((b) => b === byParam) ?? 'session';
  const range = search.get('range');
  if (range === '7d' || range === '30d') return { preset: range, by, ...presetDays(range, now) };
  const from = validDate(search.get('from'));
  const to = validDate(search.get('to'));
  if (range === 'custom' || from !== undefined || to !== undefined) {
    return { preset: 'custom', from, to, by };
  }
  return { preset: 'all', by };
}

/** The address of a Tokens view. Presets are stored by name; custom ranges by their days. */
export function tokensHref(projectId: string, p: TokensParams): string {
  const custom = p.preset === 'custom';
  return href.projectPage(projectId, 'tokens', {
    range: p.preset === 'all' || (custom && (p.from || p.to)) ? undefined : p.preset,
    from: custom ? p.from : undefined,
    to: custom ? p.to : undefined,
    by: p.by === 'session' ? undefined : p.by,
  });
}

/**
 * The API range for the chosen days: `from` is the start of the first day and `to` the start of
 * the day after the last (the server's `to` is exclusive). A custom range with its days the wrong
 * way round is swapped, so it never asks for an empty, invalid range.
 */
export function toRangeQuery(p: Pick<TokensParams, 'from' | 'to'>): TokensRangeQuery {
  let { from, to } = p;
  if (from !== undefined && to !== undefined && from > to) [from, to] = [to, from];
  return {
    from: from === undefined ? undefined : `${from}T00:00:00.000Z`,
    to:
      to === undefined
        ? undefined
        : new Date(Date.parse(`${to}T00:00:00.000Z`) + DAY_MS).toISOString(),
  };
}
