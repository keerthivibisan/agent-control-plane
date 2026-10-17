import { z } from 'zod';

/**
 * A workflow graph node or edge id (ADR-0023): lowercase letters, digits and dashes, starting with
 * a letter. Its own module so the orchestration contracts can use it without importing the graph.
 */
export const WorkflowNodeIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,39}$/, 'lowercase letters, digits and dashes (up to 40)');
export type WorkflowNodeId = z.infer<typeof WorkflowNodeIdSchema>;
