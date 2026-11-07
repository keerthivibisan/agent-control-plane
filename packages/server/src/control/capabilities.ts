import type {
  ManagedAgentSpec,
  ManagedCapabilities,
  ManagedFailureCode,
  ManagedProviderId,
} from '@acp/core';

/**
 * ADR-0031 §5 and owner decision 3 (CX-4): what the server does with a spec its provider's adapter
 * cannot honour. A missing capability that would weaken a guarantee refuses the agent (it ends with
 * `failure` and never runs); one that only leaves out help (project skills) is stripped, and the
 * owner is told. Pure, so every rule is unit-tested.
 */

/** The owner-facing name of a managed provider (app copy, never from a provider). */
export const MANAGED_PROVIDER_NAMES: Readonly<Record<ManagedProviderId, string>> = Object.freeze({
  'claude-code': 'Claude',
  codex: 'Codex',
});

/**
 * CX-3: Codex's sandbox cannot deny reads, so Full auto's `denyRead` (ADR-0022) cannot be enforced
 * there. ADR-0031 §5: refused rather than run weaker, whatever the adapter's capabilities say.
 */
export const CODEX_FULL_AUTO_LINE =
  'Full auto is not available on Codex yet: its sandbox cannot block reads of private files.';

export interface CapabilityRefusal {
  failure: ManagedFailureCode;
  /** One owner-facing sentence (app data only: provider and agent file names), for the ticket. */
  line: string;
  /** A fixed code for logs and diagnostics. */
  code: 'full-auto' | 'profile-tools' | 'lead-tools' | 'follow-up';
}

/**
 * Why this spec cannot run on this provider, or null when it can. Checked in this order:
 * - Full auto or its tightened sandbox (`fullAuto`, `sandbox`) on Codex, or on an adapter without
 *   `fullAuto`: `sandbox-unavailable`;
 * - an agent file whose `tools` narrow the role, on an adapter without `profileTools`: dropping the
 *   narrowing would widen the agent's tools, so `provider-unavailable`;
 * - control-plane tools or a follow-up turn the adapter cannot give: `provider-unavailable`.
 */
export function capabilityRefusal(
  spec: ManagedAgentSpec,
  capabilities: ManagedCapabilities,
  provider: ManagedProviderId,
): CapabilityRefusal | null {
  const name = MANAGED_PROVIDER_NAMES[provider];
  if (spec.fullAuto !== undefined || spec.sandbox !== undefined) {
    if (provider === 'codex') {
      return { failure: 'sandbox-unavailable', line: CODEX_FULL_AUTO_LINE, code: 'full-auto' };
    }
    if (!capabilities.fullAuto) {
      return {
        failure: 'sandbox-unavailable',
        line: `Full auto is not available on ${name} yet.`,
        code: 'full-auto',
      };
    }
  }
  if (spec.profile !== undefined && spec.profile.tools !== null && !capabilities.profileTools) {
    return {
      failure: 'provider-unavailable',
      line: `its agent file "${spec.profile.name}" limits the agent's tools, which ${name} cannot apply yet, so it would run with more tools than the file allows.`,
      code: 'profile-tools',
    };
  }
  if (spec.leadTools !== undefined && !capabilities.leadTools) {
    return {
      failure: 'provider-unavailable',
      line: `${name} cannot give this agent the control-plane tools its role needs.`,
      code: 'lead-tools',
    };
  }
  if (spec.followUp !== undefined && !capabilities.followUp) {
    return {
      failure: 'provider-unavailable',
      line: `${name} cannot continue an ended session yet.`,
      code: 'follow-up',
    };
  }
  return null;
}

/** True when the spec's project skills must be left out: the adapter cannot load them. */
export function dropsSkills(spec: ManagedAgentSpec, capabilities: ManagedCapabilities): boolean {
  return spec.skillPlugin !== undefined && !capabilities.skills;
}

/** The ticket line when a block's project skills were left out (`dropsSkills`). */
export function skillsIgnoredLine(role: string, provider: ManagedProviderId): string {
  return `${role} runs on ${MANAGED_PROVIDER_NAMES[provider]}, which cannot load project skills yet, so its block's skills were not loaded.`;
}
