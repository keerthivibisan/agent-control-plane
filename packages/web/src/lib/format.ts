import type { SessionSummaryDto } from '@acp/core/api';

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

/** What to call a session: its title, else its subagent type, else an explicit "untitled". */
export function sessionLabel(s: Pick<SessionSummaryDto, 'title' | 'agentType'>): string {
  return s.title ?? s.agentType ?? 'untitled session';
}

/** Last path segment, used to suggest a project name for a discovered root. */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? path;
}
