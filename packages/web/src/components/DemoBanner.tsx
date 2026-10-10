import type { CapabilitiesDto } from '@acp/core/api';

/**
 * Persistent banner while the server runs in demo mode (ADR-0007). Demo data lives in a separate
 * database and must never be mistaken for real activity.
 */
export function DemoBanner({ mode }: { mode: CapabilitiesDto['mode'] | undefined }) {
  if (mode !== 'demo') return null;
  return (
    <div
      role="status"
      data-testid="demo-banner"
      className="sticky top-0 z-20 border-b border-fuchsia-700 bg-fuchsia-600 px-4 py-1 text-center text-xs font-semibold tracking-wide text-white"
    >
      DEMO DATA — synthetic sessions from the demo adapter (separate database). Nothing shown here
      is real Claude Code activity.
    </div>
  );
}
