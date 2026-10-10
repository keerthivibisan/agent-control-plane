import type { ProviderCapabilities } from '@acp/core';

/**
 * Known gaps, shown verbatim in the UI (provider-adapters §8). Each line is a fact about what the
 * adapter cannot see or has not verified; none describes planned behavior as working.
 */
export const CLAUDE_CODE_LIMITATIONS: readonly string[] = Object.freeze([
  'The transcript format is internal to Claude Code and not a stable API. Only allowlisted record types are read; known record types that carry nothing the control plane uses are counted as ignored, and unrecognized records are counted per runtime version; neither is interpreted.',
  'Hooks are opt-in. Without them a session never reaches "ended" and becomes "stale" instead. Hook payload field names were checked against one Claude Code version (2.1.296, non-interactive runs); Notification payloads (notification_type) were not observed. SessionStart is not delivered to http hooks in that version, so the settings snippet omits it and session start comes from transcripts.',
  'Hook deliveries with an identical body and no tool_use_id share one key and are stored once. Bodies carry a per-prompt prompt_id, so Stops of different turns are distinct, but a repeated identical delivery within one prompt (for example the same Notification twice) is stored once.',
  'The scope of cumulative cost-state snapshots (main thread only, or including subagents and auxiliary calls) is unknown, and their per-model field names are unverified. Snapshots are shown, never summed.',
  'Cost is a provider-reported client-side estimate, not billing data.',
  'Auxiliary and background model calls (for example title generation) are not written to transcripts, so their usage is invisible and totals can undercount.',
  'Subagent nesting deeper than one level has not been observed in real data. A nested subagent whose spawning tool call is not found has an unknown parent, and a subagent transcript without a meta file has an unknown parent.',
  'Forked sessions copy history with its original timestamps, so attribution of copied messages is ambiguous (counted once, flagged).',
  'Session title field names (customTitle, aiTitle) are unverified; titles are redacted and capped at 200 characters.',
  'Claude Code deletes or sets aside old transcripts (retention). History that is gone before it is read cannot be recovered.',
  'Files larger than the size cap (default 512 MiB) are skipped and reported in diagnostics.',
]);

export function buildCapabilities(providerVersionsSeen: string[]): ProviderCapabilities {
  return {
    provider: 'claude-code',
    observation: {
      transcripts: true,
      lifecycleHooks: true,
      subagentRelationships: true,
      perTurnUsage: true,
      cumulativeSnapshots: true,
    },
    managedExecution: false,
    providerVersionsSeen,
    limitations: [...CLAUDE_CODE_LIMITATIONS],
  };
}
