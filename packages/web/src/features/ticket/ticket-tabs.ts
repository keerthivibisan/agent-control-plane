import { useCallback, useSyncExternalStore } from 'react';
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

/** The same address with `tab` set (the default removes it); other query parameters stay. */
export function hashWithTab(hash: string, tab: TicketTab): string {
  const { path, params } = split(hash);
  if (tab === DEFAULT_TICKET_TAB) params.delete('tab');
  else params.set('tab', tab);
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
