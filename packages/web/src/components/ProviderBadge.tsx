import type { ManagedProviderId } from '@acp/core';
import { PROVIDER_COPY } from '../lib/copy';

/*
 * Outlined like the cards' other chips (GitHub's labels). Claude Code, the default, stays neutral;
 * Codex takes the accent so a block on the other provider stands out. The word is always there,
 * so colour is never the only signal.
 */
const TONE: Record<ManagedProviderId, string> = {
  'claude-code': 'border-line-strong text-dim',
  codex: 'border-accent/50 text-accent',
};

/** A small provider chip: "Claude" or "Codex" (ADR-0031). */
export function ProviderBadge({
  provider,
  testId = 'provider-badge',
  className = '',
}: {
  provider: ManagedProviderId;
  testId?: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex h-4 shrink-0 items-center rounded-full border px-1.5 text-micro leading-none font-medium whitespace-nowrap ${TONE[provider]} ${className}`}
      title={PROVIDER_COPY.chipTip(PROVIDER_COPY.name[provider])}
      data-testid={testId}
      data-provider={provider}
    >
      {PROVIDER_COPY.chip[provider]}
    </span>
  );
}
