import { NOT_REPORTED } from '../lib/copy';
import { formatExactTime, formatRelative } from '../lib/format';
import { Tooltip } from './Tooltip';

const systemNow = () => new Date();

/**
 * A time as words ("3 min ago") with the exact local time in a hover/focus tooltip. `null` reads
 * `fallback` ("Not reported" by default), never a made-up time. The text is computed at render;
 * screens re-render on every live update, which keeps it fresh enough.
 */
export function RelativeTime({
  iso,
  fallback = NOT_REPORTED,
  now = systemNow,
}: {
  iso: string | null;
  fallback?: string;
  /** Injected clock (AGENTS.md §6), for tests. */
  now?: () => Date;
}) {
  if (iso === null) return <span className="text-unavailable">{fallback}</span>;
  return (
    <Tooltip content={formatExactTime(iso)}>
      <time dateTime={iso} className="whitespace-nowrap">
        {formatRelative(iso, now())}
      </time>
    </Tooltip>
  );
}
