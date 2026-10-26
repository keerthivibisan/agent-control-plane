const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

/** Formats an available count. Callers handle `null` (unavailable) themselves; it is never 0. */
export function formatCount(n: number, mode: 'full' | 'compact' = 'full'): string {
  return mode === 'compact' ? compact.format(n) : integer.format(n);
}

export function formatUsd(n: number): string {
  return usd.format(n);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local wall-clock time, `YYYY-MM-DD HH:MM:SS`. The ISO value goes in the element's title. */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

const exact = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
});

/** Exact local time for tooltips: "Oct 10, 2026, 8:05:00 AM". */
export function formatExactTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : exact.format(d);
}

const dateOnly = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const dateWithYear = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

/**
 * Relative time in words: "just now", "3 min ago", "5 h ago", "yesterday", "4 days ago", then a
 * date. Future times (clock skew) read "just now" rather than a negative age. `now` is injected so
 * callers and tests control the clock.
 */
export function formatRelative(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const s = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.floor(h / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return d.getFullYear() === now.getFullYear() ? dateOnly.format(d) : dateWithYear.format(d);
}

export function formatDuration(ms: number): string {
  if (ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function shortId(id: string): string {
  return id.length > 10 ? id.slice(0, 8) : id;
}

/** Display form of an id for the ShortId component: always at most 8 characters. */
export function idPrefix(id: string): string {
  return id.slice(0, 8);
}

/** Last path segment, used to suggest a project name for a discovered root. */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? path;
}
