/**
 * @acp/orchestrator — the Phase 3 engine (docs/orchestration-lifecycle.md §0, ADR-0012..0015),
 * extended for Phase 4 (ADR-0016, ADR-0013 amendment): plan-first ticket runs, per-run limits,
 * depth 2 and the project allowlist.
 * Pure functions over plain data: the server persists the returned state, then carries out the
 * returned effects in order. The model plans; this package decides (ADR-0013).
 */
export * from './errors.js';
export * from './transitions.js';
export * from './budget.js';
export * from './policy.js';
export * from './limits.js';
export * from './tree.js';
export * from './allowlist.js';
export {
  LEAD_ROLE,
  approvedPlan,
  decidePlan,
  pendingPlan,
  plannedHelpers,
  ticketLeadPrompt,
} from './plan.js';
export type { PlanDecision } from './plan.js';
export type * from './state.js';
export { SUMMARY_MAX_CHARS, cleanSummary, formatTokens } from './draft.js';
export {
  agentEvent,
  cancelRun,
  completeCancellation,
  createRun,
  decideApproval,
  expireApprovals,
  isApprovalOverdue,
  isRunPastDeadline,
  ownerChat,
  recordReview,
  recoverAfterRestart,
  requestPermission,
  requestReview,
  stopAgent,
  timeOutRun,
} from './commands.js';
export type {
  ApprovalDecisionOptions,
  CreateRunInput,
  RequestPermissionOptions,
} from './commands.js';
export { CHILD_MANAGEMENT_TOOLS, leadToolCall } from './lead-tools.js';
export type { LeadToolCall } from './lead-tools.js';
