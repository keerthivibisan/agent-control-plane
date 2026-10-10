import { formatTime } from '../lib/format';

/** A timestamp in local time, with the exact ISO value on hover. `null` renders `fallback`. */
export function Time({ iso, fallback = '—' }: { iso: string | null; fallback?: string }) {
  if (iso === null) return <span className="text-dim italic">{fallback}</span>;
  return (
    <time dateTime={iso} title={iso} className="font-mono whitespace-nowrap tabular-nums">
      {formatTime(iso)}
    </time>
  );
}
