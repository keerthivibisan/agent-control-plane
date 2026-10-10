import type { CapabilitiesDto } from '@acp/core/api';
import { DEMO_BANNER } from '../lib/copy';
import { SparkIcon } from './icons';

/**
 * Slim, friendly banner while the server runs in demo mode (ADR-0007). Demo data lives in a
 * separate database and must never be mistaken for real activity, so it shows on every page.
 */
export function DemoBanner({ mode }: { mode: CapabilitiesDto['mode'] | undefined }) {
  if (mode !== 'demo') return null;
  return (
    <div
      role="status"
      data-testid="demo-banner"
      className="sticky top-0 z-20 flex items-center justify-center gap-2 border-b border-accent/20 bg-accent-soft px-4 py-1.5 text-center text-caption text-ink"
    >
      <SparkIcon size={14} className="shrink-0 text-accent" />
      <span>
        <strong className="font-semibold">{DEMO_BANNER.title}.</strong>{' '}
        <span className="text-dim">{DEMO_BANNER.text}</span>
      </span>
    </div>
  );
}
