export { createClaudeCodeAdapter } from './adapter.js';
export type { ClaudeCodeAdapter, ClaudeCodeAdapterOptions } from './adapter.js';
export { hookSettingsSnippet, HookPayloadError, SUBSCRIBED_HOOKS } from './hooks.js';
export type { HookSnippetOptions } from './hooks.js';
export { CLAUDE_CODE_LIMITATIONS } from './capabilities.js';
export { DEFAULT_MAX_FILE_BYTES } from './allowlist.js';
export type {
  ClaudeCodeDiagnostics,
  FileIssue,
  FileIssueReason,
  VersionRecordCounts,
} from './diagnostics.js';
