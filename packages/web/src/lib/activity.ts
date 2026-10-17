import { controlToolLabel } from '@acp/core';

/**
 * An agent's "Latest" line in plain words (ADR-0021 fix 4): a control-plane tool the server still
 * reports by its raw name ("Used tool: mcp__acp__agent_status") reads as core's label ("Checked a
 * helper's status"). Anything else, including a line the server already words, stays as sent.
 */
export function activityText(latest: string): string {
  const m = /^(?:Used tool: )?(?:mcp__acp__)?([a-z_]+)$/.exec(latest.trim());
  if (m === null) return latest;
  // A bare word ("Edit", "thinking") is not a control tool unless core names it.
  const name = m[1] ?? '';
  const raw = latest.trim();
  const looksLikeTool = raw.startsWith('Used tool: ') || raw.startsWith('mcp__acp__');
  if (!looksLikeTool) return latest;
  return controlToolLabel(name) ?? latest;
}
