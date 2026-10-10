import { z } from 'zod';
import { ProviderIdSchema } from '../domain/provider.js';

/**
 * Identity of a provider session (ADR-0008).
 * A Claude Code subagent shares its parent's `sessionId` and is distinguished by `agentId`,
 * so a subagent is its own Session with `providerAgentId` set. Top-level sessions use `null`.
 */
export const SessionKeySchema = z.object({
  provider: ProviderIdSchema,
  providerSessionId: z.string().min(1),
  providerAgentId: z.string().min(1).nullable(),
});
export type SessionKey = z.infer<typeof SessionKeySchema>;

/**
 * Evidence-derived session status. There is deliberately no `completed`:
 * observation mode only knows a session `ended` when the provider says so (e.g. a SessionEnd hook).
 * - `active`: evidence of activity within the active window.
 * - `idle`: recent evidence, but outside the active window.
 * - `stale`: no evidence within the stale threshold and no observed end. NOT a completion.
 * - `ended`: the provider reported the session ended.
 * - `unknown`: not enough evidence to classify.
 */
export const SessionStatusSchema = z.enum(['active', 'idle', 'stale', 'ended', 'unknown']);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

/**
 * - `subagent`: the parent spawned the child as a subagent.
 * - `continuation`: the child is a fork/branch of the parent that copied its message history.
 */
export const SessionEdgeKindSchema = z.enum(['subagent', 'continuation']);
export type SessionEdgeKind = z.infer<typeof SessionEdgeKindSchema>;

/**
 * Evidence that justifies an edge. An edge without evidence must not exist; an unknown parent
 * stays unknown (no edges from timing or directory similarity).
 * - `subagent-metadata`: subagent `.meta.json` stored under the parent session directory.
 * - `spawn-tool-use`: the metadata `toolUseId` matches an Agent tool call in the parent transcript.
 * - `subagent-hook`: SubagentStart/SubagentStop hook payload naming the agent within the session.
 * - `shared-message-history`: the child file contains message ids first seen in the parent.
 */
export const SessionEdgeEvidenceSchema = z.enum([
  'subagent-metadata',
  'spawn-tool-use',
  'subagent-hook',
  'shared-message-history',
]);
export type SessionEdgeEvidence = z.infer<typeof SessionEdgeEvidenceSchema>;

export const SessionEdgeSchema = z
  .object({
    kind: SessionEdgeKindSchema,
    parent: SessionKeySchema,
    child: SessionKeySchema,
    provenance: z.enum(['observed', 'derived']),
    evidence: z.array(SessionEdgeEvidenceSchema).min(1),
  })
  .refine((e) => e.kind !== 'subagent' || e.evidence.some((x) => x !== 'shared-message-history'), {
    message: 'subagent edges require subagent metadata, spawn tool-use, or hook evidence',
  })
  .refine((e) => e.kind !== 'continuation' || e.evidence.includes('shared-message-history'), {
    message: 'continuation edges require shared-message-history evidence',
  });
export type SessionEdge = z.infer<typeof SessionEdgeSchema>;
