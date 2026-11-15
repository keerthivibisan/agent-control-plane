// Workflow graph logic (ADR-0023, docs/history/workflow-graph/README.md): pure functions over the
// contract in `../workflow-graph.ts`, shared by the editor, the server and the engine.
export { canConnect, type ConnectIssueCode, type ConnectResult } from './connect.js';
export {
  CHECK_FAILURE_ROUTE_NAMES,
  CHECK_PLACE_NAMES,
  checkBlockOf,
  defaultFailureRoute,
  isCheckBlockAt,
  type CheckBlockConfig,
} from './check-blocks.js';
export {
  NO_CHECKS_MESSAGE,
  RESERVED_HELPER_LABELS,
  isGraphRunnable,
  isReservedHelperLabel,
  validateWorkflowGraph,
  type ValidateGraphContext,
} from './validate.js';
export { WorkflowGraphInvalidError, compileWorkflowV2 } from './compile.js';
export { migrateWorkflowV1 } from './migrate.js';
export { graphRunDefaults, type GraphRunDefaults } from './run-defaults.js';
export {
  WORKFLOW_TEMPLATES,
  workflowTemplate,
  type WorkflowTemplateInfo,
  type WorkflowTemplateOptions,
} from './templates.js';

// Version 3 (ADR-0037): roles from arrows. The unversioned names above are version 2's, kept
// for the editor and the API until AR-4 and AR-5 move them; `compileWorkflow` takes both versions.
export {
  ROLE_CLAIM_NAMES,
  claimOf,
  deriveRoles,
  type DerivedRole,
  type GraphAgentRole,
  type RoleClaim,
  type RoleResult,
} from './v3/roles.js';
export { canConnectV3 } from './v3/connect.js';
export { validateWorkflowGraphV3 } from './v3/validate.js';
export { compileWorkflow, compileWorkflowV3 } from './v3/compile.js';
export { arrowNoteReceiver, isArrowNoteType } from './v3/arrow-notes.js';
export {
  downgradeWorkflowV3,
  migrateWorkflowV1ToV3,
  migrateWorkflowV2,
  storedWorkflowGraphV3,
  toWorkflowGraphV3,
  type DowngradeResult,
} from './v3/migrate.js';
export { workflowTemplateV3 } from './v3/templates.js';
// ADR-0038 §4–§5: failure routing (When arrows, the Author block) and the workflow in words.
export {
  FAILURE_EVENT_NAMES,
  FAILURE_SOURCE_EVENTS,
  FAILURE_SOURCE_NAMES,
  derivedFailureRoutes,
  failureSourceKind,
  isWhenTarget,
  whenFailureRoutes,
  type DerivedRouteOptions,
  type FailureSourceKind,
} from './v3/failure-routes.js';
export {
  WORKFLOW_WORDS_NOTE,
  describeWorkflow,
  inlineLabel,
  quoteInline,
  renderWorkflowDescription,
  type DescribeWorkflowOptions,
  type WorkflowFailureRouting,
  type WorkflowSentence,
  type WorkflowSentenceSection,
} from './v3/describe.js';
export { graphRunDefaultsV3 } from './v3/run-defaults.js';

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
export { withoutCheckBlocks } from './testing/graph-ops.js';
export {
  GRAPH_MUTATIONS_V3,
  LEGAL_GRAPH_MOVES_V3,
  enumerateSmallGraphsV3,
  generateValidGraphV3,
  type GenerateGraphV3Options,
  type GraphMutationV3,
} from './testing/v3.js';
