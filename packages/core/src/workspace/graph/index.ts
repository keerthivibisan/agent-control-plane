// Workflow graph logic (ADR-0023, docs/workflow-graph/README.md): pure functions over the
// contract in `../workflow-graph.ts`, shared by the editor, the server and the engine.
export { canConnect, type ConnectIssueCode, type ConnectResult } from './connect.js';
export {
  RESERVED_HELPER_LABELS,
  isGraphRunnable,
  isReservedHelperLabel,
  validateWorkflowGraph,
  type ValidateGraphContext,
} from './validate.js';
export { WorkflowGraphInvalidError, compileWorkflow } from './compile.js';
export { migrateWorkflowV1 } from './migrate.js';
export { graphRunDefaults, type GraphRunDefaults } from './run-defaults.js';
export {
  WORKFLOW_TEMPLATES,
  workflowTemplate,
  type WorkflowTemplateInfo,
  type WorkflowTemplateOptions,
} from './templates.js';

// Test support (README "Graph correctness", layers 3 and 4): pure and seeded, shared with the
// engine's simulator tests (WG-B). Never used to build a project's workflow.
export { createGraphRng, type GraphRng } from './testing/rng.js';
export {
  GENERATED_HELPER_NAMES,
  LEGAL_GRAPH_MOVES,
  generateValidGraph,
  type GenerateGraphOptions,
} from './testing/generate.js';
export { GRAPH_MUTATIONS, type GraphMutation } from './testing/mutations.js';
export { enumerateSmallGraphs, type EnumeratedGraph } from './testing/enumerate.js';
