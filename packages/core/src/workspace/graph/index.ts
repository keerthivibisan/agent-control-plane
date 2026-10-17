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
export {
  WORKFLOW_TEMPLATES,
  workflowTemplate,
  type WorkflowTemplateInfo,
  type WorkflowTemplateOptions,
} from './templates.js';
