export { createClaudeCodeAdapter } from './adapter.js';
export type { ClaudeCodeAdapter, ClaudeCodeAdapterOptions } from './adapter.js';
export { hookSettingsSnippet, HookPayloadError, SNIPPET_HOOKS, SUBSCRIBED_HOOKS } from './hooks.js';
export type { HookSnippetOptions } from './hooks.js';
export { CLAUDE_CODE_LIMITATIONS } from './capabilities.js';
export {
  createManagedClaudeCode,
  LEAD_MCP_SERVER_NAME,
  ManagedAgentEndedError,
  ManagedFollowUpSendError,
  MAX_SUMMARY_LENGTH,
  READ_ONLY_TOOLS,
  summarizeToolUse,
} from './managed/index.js';
export type { ManagedClaudeCodeOptions, ManagedQuery, ManagedQueryFn } from './managed/index.js';
export { DEFAULT_MAX_FILE_BYTES } from './allowlist.js';
export type {
  ClaudeCodeDiagnostics,
  FileIssue,
  FileIssueReason,
  VersionRecordCounts,
} from './diagnostics.js';
