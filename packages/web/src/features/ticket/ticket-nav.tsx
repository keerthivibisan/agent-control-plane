import { createContext, useContext } from 'react';
import type { TicketTab } from './ticket-tabs';

/**
 * Moving inside the ticket page (v0.3.0 D-B): open a tab and bring one of its parts into view, for
 * links that used to scroll within the single page ("1 finding from the reviewer in the comments
 * below") and the header's shortcuts (what waits for you, the final step). Null outside the
 * ticket page, where such a link scrolls as before.
 */
export interface TicketNav {
  goTo: (tab: TicketTab, targetId?: string) => void;
}

const TicketNavContext = createContext<TicketNav | null>(null);

export const TicketNavProvider = TicketNavContext.Provider;

export function useTicketNav(): TicketNav | null {
  return useContext(TicketNavContext);
}
