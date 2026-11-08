import { z } from 'zod';
import { ManagedProviderIdSchema } from '../domain/provider.js';
import { IsoTimestampSchema } from '../domain/time.js';
import { MAX_AGENT_BYTES, MAX_SKILL_BYTES, SkillNameSchema } from '../workspace/workflow.js';
import { AgentEffortSchema } from '../workspace/workflow-graph.js';

/**
 * The project assistant's API (ADR-0035, docs/assistant/README.md): one chat session per project,
 * held in the server's memory only. Nothing here is stored: no chat text, no proposal, no session
 * row (ADR-0009; ADR-0015 does not apply). Routes live under `/api/projects/:projectId/assistant`.
 */

/** Approve: the owner applies each proposal. Auto: the app writes it at once (ADR-0035 §5). */
export const AssistantModeSchema = z.enum(['approve', 'auto']);
export type AssistantMode = z.infer<typeof AssistantModeSchema>;

/** Longest owner message, in characters. */
export const MAX_ASSISTANT_MESSAGE = 8000;
/** Soft cap of one session, in budget tokens (ADR-0014's measure); the session ends on reaching it. */
export const ASSISTANT_BUDGET_TOKENS = 300_000;
/** A session with no message and no agent event for this long ends. */
export const ASSISTANT_IDLE_MS = 30 * 60 * 1000;
/** Most bytes of one tool answer given to the assistant; longer answers are cut with a note. */
export const ASSISTANT_TOOL_ANSWER_BYTES = 8 * 1024;

/**
 * POST `…/assistant/session`: starts a chat, replacing the project's current one. Changing the
 * provider, model or effort starts a new chat (ADR-0035 §2). `model` null: `sonnet` for Claude
 * Code, the provider's default for Codex.
 */
export const AssistantStartRequestSchema = z.object({
  provider: ManagedProviderIdSchema.default('claude-code'),
  model: z.string().trim().min(1).max(100).nullable().default(null),
  effort: AgentEffortSchema.default('medium'),
  mode: AssistantModeSchema.default('approve'),
});
export type AssistantStartRequest = z.infer<typeof AssistantStartRequestSchema>;

/**
 * - `starting`: the agent is being launched;
 * - `ready`: waiting for the owner (no message sent yet, or the assistant's reply arrived);
 * - `working`: a message is being answered;
 * - `ended`: the owner ended it, it was replaced, it was idle or reached its budget;
 * - `failed`: the agent could not start or stopped with an error (`failure`).
 */
export const AssistantSessionStatusSchema = z.enum([
  'starting',
  'ready',
  'working',
  'ended',
  'failed',
]);
export type AssistantSessionStatus = z.infer<typeof AssistantSessionStatusSchema>;

const count = z.number().int().nonnegative();

export const AssistantSessionDtoSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  provider: ManagedProviderIdSchema,
  /** The model the agent runs: the request's, else the provider's default (null: Codex's own). */
  model: z.string().min(1).nullable(),
  effort: AgentEffortSchema,
  mode: AssistantModeSchema,
  status: AssistantSessionStatusSchema,
  /** A short owner-facing sentence when `status` is `failed`; null otherwise. */
  failure: z.string().min(1).max(300).nullable(),
  /** Budget tokens used so far and the session's soft cap (`ASSISTANT_BUDGET_TOKENS`). */
  budget: z.object({ used: count, limit: count }),
  startedAt: IsoTimestampSchema,
});
export type AssistantSessionDto = z.infer<typeof AssistantSessionDtoSchema>;

/** POST `…/assistant/session/messages`. */
export const AssistantMessageRequestSchema = z.object({
  text: z.string().trim().min(1).max(MAX_ASSISTANT_MESSAGE),
});
export type AssistantMessageRequest = z.infer<typeof AssistantMessageRequestSchema>;

/** POST `…/assistant/session/mode`: switches Approve and Auto without restarting the chat. */
export const AssistantModeRequestSchema = z.object({ mode: AssistantModeSchema });
export type AssistantModeRequest = z.infer<typeof AssistantModeRequestSchema>;

/**
 * - `pending`: shown to the owner, waiting for Apply or Discard (Approve mode);
 * - `applied`: the owner applied it and it was written;
 * - `discarded`: the owner discarded it;
 * - `written`: written at once (Auto mode);
 * - `failed`: the write was refused (`problem`).
 */
export const AssistantProposalStateSchema = z.enum([
  'pending',
  'applied',
  'discarded',
  'written',
  'failed',
]);
export type AssistantProposalState = z.infer<typeof AssistantProposalStateSchema>;

export const AssistantProposalKindSchema = z.enum(['skill', 'agent']);
export type AssistantProposalKind = z.infer<typeof AssistantProposalKindSchema>;

export const AssistantProposalDtoSchema = z.object({
  id: z.string().min(1),
  kind: AssistantProposalKindSchema,
  slug: SkillNameSchema,
  /** Exactly `.claude/skills/<slug>/SKILL.md` or `.claude/agents/<slug>.md` (ADR-0018). */
  path: z
    .string()
    .regex(
      /^\.claude\/(skills\/[a-z0-9][a-z0-9-]{0,63}\/SKILL|agents\/[a-z0-9][a-z0-9-]{0,63})\.md$/,
    ),
  /** The file as the app writes it, for the panel's preview. */
  content: z.string().min(1).max(Math.max(MAX_SKILL_BYTES, MAX_AGENT_BYTES)),
  /** True when it replaces an existing file; the panel shows it as a replacement. */
  replace: z.boolean(),
  state: AssistantProposalStateSchema,
  /** Why a write was refused, as a plain sentence; null otherwise. */
  problem: z.string().min(1).max(500).nullable(),
});
export type AssistantProposalDto = z.infer<typeof AssistantProposalDtoSchema>;

/** Why a session ended (`ended` event). */
export const AssistantEndReasonSchema = z.enum([
  'owner',
  'replaced',
  'idle',
  'budget',
  'finished',
  'failed',
  'server-stop',
]);
export type AssistantEndReason = z.infer<typeof AssistantEndReasonSchema>;

/**
 * One event of `GET …/assistant/stream` (server-sent events, unnamed `data:` frames with an `id:`,
 * as `/api/events/stream`). A fresh connection first gets `status` (null: no session) and every
 * pending proposal; a reconnect with `Last-Event-ID` inside the current session gets the events it
 * missed instead. No history outlives the session.
 * - `text`: one complete text block of the assistant's reply (`full`); the adapters emit whole
 *   blocks, never deltas, so the panel appends each as it comes;
 * - `activity`: a content-free line (e.g. "Read src/app.ts", "Checked the tickets");
 * - `proposal`: a new or changed proposal, with its content for the preview.
 */
export const AssistantStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('status'), session: AssistantSessionDtoSchema.nullable() }),
  z.object({ type: z.literal('text'), full: z.string().min(1) }),
  z.object({ type: z.literal('activity'), summary: z.string().min(1).max(300) }),
  z.object({ type: z.literal('proposal'), proposal: AssistantProposalDtoSchema }),
  z.object({ type: z.literal('error'), message: z.string().min(1).max(300) }),
  z.object({
    type: z.literal('ended'),
    reason: AssistantEndReasonSchema,
    message: z.string().min(1).max(300),
  }),
]);
export type AssistantStreamEvent = z.infer<typeof AssistantStreamEventSchema>;
