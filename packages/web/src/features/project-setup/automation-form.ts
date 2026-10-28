import { ProjectAutomationSchema, type ProjectAutomation } from '@acp/core';
import { UpdateProjectSetupRequestSchema, type ProjectAgentSetupDto } from '@acp/core/api';
import type { UpdateProjectSetupRequest } from '../../lib/api';

/**
 * ADR-0030: the project's automation policy as an editable draft. Lists are text the owner types
 * (patterns one per line, ids and targets comma separated); `toPolicy` validates with core's
 * schema, so the form can never save what the server would refuse.
 */
export interface AutomationDraft {
  conflictMode: ProjectAutomation['conflictResolution']['mode'];
  maxAttempts: number;
  verificationMode: ProjectAutomation['verification']['mode'];
  skipScopes: string;
  alwaysRun: string;
  allowUnverified: boolean;
  onMissing: ProjectAutomation['verification']['onMissingChecks'];
  deliveryMode: ProjectAutomation['delivery']['mode'];
  targets: string;
}

export function draftFromPolicy(p: ProjectAutomation): AutomationDraft {
  return {
    conflictMode: p.conflictResolution.mode,
    maxAttempts: p.conflictResolution.maxAttempts,
    verificationMode: p.verification.mode,
    skipScopes: p.verification.skipScopes.join('\n'),
    alwaysRun: p.verification.alwaysRunChecks.join(', '),
    allowUnverified: p.verification.allowUnverifiedDelivery,
    onMissing: p.verification.onMissingChecks,
    deliveryMode: p.delivery.mode,
    targets: p.delivery.allowedTargets.join(', '),
  };
}

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
const commas = (text: string) =>
  text
    .split(',')
    .map((l) => l.trim())
    .filter((l) => l !== '');

/** The policy the draft describes, or null when a value is invalid. */
export function toPolicy(d: AutomationDraft, base: ProjectAutomation): ProjectAutomation | null {
  const parsed = ProjectAutomationSchema.safeParse({
    conflictResolution: {
      mode: d.conflictMode,
      maxAttempts: d.maxAttempts,
      helper: base.conflictResolution.helper,
    },
    verification: {
      mode: d.verificationMode,
      skipScopes: lines(d.skipScopes),
      alwaysRunChecks: commas(d.alwaysRun),
      allowUnverifiedDelivery: d.allowUnverified,
      onMissingChecks: d.onMissing,
    },
    delivery: { mode: d.deliveryMode, allowedTargets: commas(d.targets) },
  });
  return parsed.success ? parsed.data : null;
}

/** The setup PUT that saves only the policy (every other field as stored). */
export function automationRequest(
  setup: ProjectAgentSetupDto,
  automation: ProjectAutomation | null,
): UpdateProjectSetupRequest | null {
  const parsed = UpdateProjectSetupRequestSchema.safeParse({
    projectKey: setup.projectKey,
    maxConcurrentHelpers: setup.maxConcurrentHelpers,
    maxDepth: setup.maxDepth,
    defaultBudgetTokensPerAgent: setup.defaultBudgetTokensPerAgent,
    model: setup.model,
    contextFiles: [...setup.contextFiles],
    automation,
  });
  return parsed.success ? parsed.data : null;
}
