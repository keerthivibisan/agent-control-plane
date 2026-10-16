import type { SessionSummaryDto } from '@acp/core/api';
import { Tooltip } from '../../components/Tooltip';

/** The API's page-size cap; one page of running sessions is enough to count them per project. */
export const RUNNING_LIMIT = 200;

/**
 * Running sessions per project, or `null` when the count isn't known: still loading, failed, or
 * more than one page (a partial count would understate it).
 */
export function runningByProject(
  page: { items: readonly SessionSummaryDto[]; page: { nextCursor: string | null } } | undefined,
): ReadonlyMap<string, number> | null {
  if (page === undefined || page.page.nextCursor !== null) return null;
  const counts = new Map<string, number>();
  for (const s of page.items) {
    if (s.projectId !== null) counts.set(s.projectId, (counts.get(s.projectId) ?? 0) + 1);
  }
  return counts;
}

/** A long folder path, cut at the end of the line with the full path in a tooltip. */
export function FolderPath({ path }: { path: string }) {
  return (
    <Tooltip content={path} className="block min-w-0">
      <span className="block truncate font-mono text-caption text-dim" dir="ltr">
        {path}
      </span>
    </Tooltip>
  );
}
