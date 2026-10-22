import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { replaceHash } from '../../lib/router';

/*
 * The ticket page's tabs, GitHub's pull request tabs: Comments, Agents, Files changed, Checks and
 * Conversation (v0.3.0 D-B; C-B, ADR-0026: Comments is the home and first, Conversation the
 * timeline of what happened, last). The open tab is the address's `tab` query
 * (`#/p/:id/tickets/:id?tab=agents`), so a link, a reload or a shared address opens the same tab.
 * Comments is the default and leaves the query out. The router's ticket route ignores the query,
 * so a tab change never remounts the page.
 */

export const TICKET_TABS = ['comments', 'agents', 'files', 'checks', 'conversation'] as const;
export type TicketTab = (typeof TICKET_TABS)[number];

export const DEFAULT_TICKET_TAB: TicketTab = 'comments';

/**
 * Words the query accepts for each tab: the tab ids, and the names of what used to be sections of
 * the single page (its comments, its plan, its changes), so older links land on the tab that holds
 * them. `plan` opens Comments, where the plan under review is; `workflow` opens Agents, where the
 * live workflow is.
 */
const ALIASES: Readonly<Record<string, TicketTab>> = {
  comments: 'comments',
  plan: 'comments',
  conversation: 'conversation',
  activity: 'conversation',
  timeline: 'conversation',
  agents: 'agents',
  workflow: 'agents',
  files: 'files',
  changes: 'files',
  'files-changed': 'files',
  checks: 'checks',
};

function split(hash: string): { path: string; params: URLSearchParams } {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const i = raw.indexOf('?');
  return i === -1
    ? { path: raw, params: new URLSearchParams() }
    : { path: raw.slice(0, i), params: new URLSearchParams(raw.slice(i + 1)) };
}

/** The tab an address asks for, or the default when it names none (or one that isn't a tab). */
export function tabFromHash(hash: string): TicketTab {
  const asked = split(hash).params.get('tab');
  return (asked !== null ? ALIASES[asked.toLowerCase()] : undefined) ?? DEFAULT_TICKET_TAB;
}

/**
 * The same address with `tab` set (the default removes it); other query parameters stay, except
 * `change`, which belongs to Files changed and is dropped when another tab opens.
 */
export function hashWithTab(hash: string, tab: TicketTab): string {
  const { path, params } = split(hash);
  if (tab === DEFAULT_TICKET_TAB) params.delete('tab');
  else params.set('tab', tab);
  if (tab !== 'files') params.delete('change');
  const qs = params.toString();
  return `#${path}${qs ? `?${qs}` : ''}`;
}

/**
 * The ticket page's other address parameters (v0.3.0 C-D): `run`, the run on screen when it is
 * not the latest, and `change`, the helper's change Files changed shows ("Changes from"; absent
 * is all changes).
 */
export type TicketParam = 'run' | 'change';

/** A parameter's value in an address, or null when it is absent or empty. */
export function paramFromHash(hash: string, name: TicketParam): string | null {
  const value = split(hash).params.get(name);
  return value === null || value === '' ? null : value;
}

/** The same address with each named parameter set, or removed when its value is null. */
export function hashWithParams(
  hash: string,
  updates: Partial<Record<TicketParam, string | null>>,
): string {
  const { path, params } = split(hash);
  for (const [name, value] of Object.entries(updates)) {
    if (value === null || value === undefined) params.delete(name);
    else params.set(name, value);
  }
  const qs = params.toString();
  return `#${path}${qs ? `?${qs}` : ''}`;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

const getHash = () => window.location.hash;

/**
 * The open tab and a setter. Choosing a tab replaces the address instead of adding a history
 * entry: the arrow keys select tabs as they move, and Back should leave the ticket, not replay
 * every tab looked at.
 */
export function useTicketTab(): [TicketTab, (tab: TicketTab) => void] {
  const hash = useSyncExternalStore(subscribe, getHash, () => '');
  const tab = tabFromHash(hash);
  const set = useCallback((next: TicketTab) => {
    if (tabFromHash(window.location.hash) === next) return;
    replaceHash(hashWithTab(window.location.hash, next));
  }, []);
  return [tab, set];
}

/**
 * The page's `run` and `change` parameters and a setter that replaces the address (like the tabs:
 * Back leaves the ticket instead of replaying every choice).
 */
export function useTicketParams(): [
  { run: string | null; change: string | null },
  (updates: Partial<Record<TicketParam, string | null>>) => void,
] {
  const hash = useSyncExternalStore(subscribe, getHash, () => '');
  const run = paramFromHash(hash, 'run');
  const change = paramFromHash(hash, 'change');
  const set = useCallback((updates: Partial<Record<TicketParam, string | null>>) => {
    const next = hashWithParams(window.location.hash, updates);
    if (next !== window.location.hash) replaceHash(next);
  }, []);
  return [useMemo(() => ({ run, change }), [run, change]), set];
}
