import { useEffect } from 'react';

/**
 * `#/control/new`: the Phase 3 "start a run" page, kept for runs without a ticket (and the P3-F
 * end-to-end flow) now that `#/control` opens the board. Run ids are UUIDs, never "new".
 */
export const LEGACY_START_RUN = 'new';

/**
 * Replaces the current hash without a new history entry, so Back doesn't bounce into the
 * redirect again, and tells the router (which listens for `hashchange`).
 */
export function RedirectTo({ hash }: { hash: string }) {
  useEffect(() => {
    window.history.replaceState(window.history.state, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }, [hash]);
  return null;
}
