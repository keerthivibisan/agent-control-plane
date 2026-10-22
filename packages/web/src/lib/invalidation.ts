import type { StreamNoticeDto } from '@acp/core/api';
import { API_BASE } from './constants';

const codeHostPattern = new RegExp(`^${API_BASE}/projects/[^/?]+/code-host$`);

/**
 * Which cached API paths a stream notice makes stale. Notices carry ids only (no data), so the UI
 * refetches over REST.
 *
 * - `projects-changed`: association can move sessions between projects, so everything but health.
 * - `events-ingested`: every aggregate view (overview, lists, usage, trees, details, because a
 *   child's usage changes its ancestors' aggregate) plus the event pages of the named sessions only.
 * - Never a project's code host status (ADR-0025): it asks the GitHub CLI, so it is read when a
 *   screen that shows it opens and on the owner's "Check again", not on every notice.
 */
export function affectedBy(notice: StreamNoticeDto): (key: string) => boolean {
  const health = `${API_BASE}/health`;
  if (notice.kind === 'projects-changed') {
    return (key) => key !== health && !codeHostPattern.test(key);
  }

  const sessionEventPrefixes = notice.sessionIds.map(
    (id) => `${API_BASE}/sessions/${encodeURIComponent(id)}/events`,
  );
  const eventsPagePattern = new RegExp(`^${API_BASE}/sessions/[^/?]+/events(\\?|$)`);
  return (key) => {
    if (key === health || codeHostPattern.test(key)) return false;
    const eventsPage = eventsPagePattern.test(key);
    if (eventsPage) return sessionEventPrefixes.some((p) => key === p || key.startsWith(`${p}?`));
    return true;
  };
}
