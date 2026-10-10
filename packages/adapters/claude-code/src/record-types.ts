/**
 * Record types whose envelope fields (`cwd`, `version`, `timestamp`, `gitBranch`, `entrypoint`)
 * the adapter reads. Every other record type is only identified by its `type`; none of its other
 * fields are read. That keeps types such as `bridge-session` and `artifact-autoreact-ledger`,
 * which carry account and organization ids, untouched (docs/provider-adapters.md §4.4).
 */
export const ENVELOPE_RECORD_TYPES: ReadonlySet<string> = new Set(['user', 'assistant', 'system']);

/** Record types with dedicated normalizers (§4.4). Everything else becomes `record.unrecognized`. */
export const TITLE_RECORD_TYPES: ReadonlySet<string> = new Set(['custom-title', 'ai-title']);
export const COST_STATE_RECORD_TYPE = 'cost-state';

/**
 * Known record types that carry nothing the control plane uses: no usage, no session lifecycle,
 * no relationships (ADR-0011; justification per type in docs/provider-adapters.md §4.4). They
 * emit no event and are counted in `diagnostics().ignoredRecords` instead of being reported as
 * `record.unrecognized`. Names use the `recordType` form, so a system subtype is
 * `system:<subtype>`. Like unrecognized records, none of their fields are read; for `system`
 * records only the envelope is. Types whose meaning is uncertain are deliberately not listed.
 */
export const IGNORED_RECORD_TYPES: ReadonlySet<string> = new Set([
  'attachment',
  'last-prompt',
  'queue-operation',
  'file-history-snapshot',
  'file-history-delta',
  'artifact-comment-monitor',
  'artifact-autoreact-ledger',
  'system:stop_hook_summary',
]);
