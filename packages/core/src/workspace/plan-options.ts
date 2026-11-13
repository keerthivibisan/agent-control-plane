import { z } from 'zod';
import { IsoTimestampSchema } from '../domain/time.js';
import { MAX_NODE_LABEL, WorkflowNodeIdSchema } from './workflow-graph.js';
import { TicketPlanSchema } from './workspace.js';

/**
 * ADR-0037 §4: one planner's plan in a run with two or more planners (a plan option). Every
 * planner submits one; the owner approves one, which becomes the run's plan (a `TicketPlan`
 * version, `planId`) exactly as a single planner's plan does; the others are kept as `not-chosen`.
 * A request for changes supersedes every waiting option and each planner submits again.
 *
 * - `optionIndex`: 1, 2, ... per run, in the order the options were submitted;
 * - `nodeId` and `label`: the planner's node in the run's graph and its label (owner text);
 * - `planId`: the plan the chosen option became; null for every other option.
 */
export const TicketPlanOptionStatusSchema = z.enum([
  'proposed',
  'chosen',
  'not-chosen',
  'superseded',
]);
export type TicketPlanOptionStatus = z.infer<typeof TicketPlanOptionStatusSchema>;

export const TicketPlanOptionSchema = z.object({
  id: z.string().min(1),
  ticketId: z.string().min(1),
  runId: z.string().min(1),
  optionIndex: z.number().int().positive(),
  /** The planner agent run that submitted it. */
  agentRunId: z.string().min(1),
  nodeId: WorkflowNodeIdSchema,
  label: z.string().trim().min(1).max(MAX_NODE_LABEL),
  summary: TicketPlanSchema.shape.summary,
  /** With each step's resolved helper node when the graph has named helpers (ADR-0023 §7). */
  steps: TicketPlanSchema.shape.steps,
  plannedHelpers: TicketPlanSchema.shape.plannedHelpers,
  status: TicketPlanOptionStatusSchema,
  planId: z.string().min(1).nullable(),
  createdAt: IsoTimestampSchema,
  decidedAt: IsoTimestampSchema.nullable(),
});
export type TicketPlanOption = z.infer<typeof TicketPlanOptionSchema>;
