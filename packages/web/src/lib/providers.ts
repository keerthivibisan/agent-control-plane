import { DEFAULT_MANAGED_PROVIDER, type ManagedProviderId } from '@acp/core';

/**
 * ADR-0031: the model names the model field suggests for each provider. Suggestions only: the
 * field stays free text, and the provider decides what a name means.
 */
export const MODEL_SUGGESTIONS: Readonly<Record<ManagedProviderId, readonly string[]>> = {
  'claude-code': ['sonnet', 'opus', 'haiku', 'inherit'],
  codex: ['gpt-6.1-sol', 'gpt-6-astra'],
};

/** The provider a block's agents run on: its own, else the project's default, else Claude Code. */
export function effectiveProvider(
  own: ManagedProviderId | undefined,
  projectDefault: ManagedProviderId | null | undefined,
): ManagedProviderId {
  return own ?? projectDefault ?? DEFAULT_MANAGED_PROVIDER;
}
