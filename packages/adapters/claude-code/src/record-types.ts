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
