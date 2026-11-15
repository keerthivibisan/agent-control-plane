/*
 * ADR-0037 (AR-4): the server serves every workflow graph as version 3. The fixtures keep their
 * graphs as version 2 JSON (shorter to read), and the DTOs carry them as the server does: migrated
 * with core's lossless `migrateWorkflowV2`. A graph already at version 3 is kept. Never import this
 * from src/.
 */
import { WorkflowGraphSchema, WorkflowGraphV3Schema, migrateWorkflowV2 } from '@acp/core';

type Json = Record<string, unknown>;

/** A fixture graph as the server sends it (version 3). */
export function asServerGraph(graph: unknown): Json {
  const version = (graph as { version?: unknown } | null)?.version;
  if (version === 3) return WorkflowGraphV3Schema.parse(graph);
  return migrateWorkflowV2(WorkflowGraphSchema.parse(graph));
}
