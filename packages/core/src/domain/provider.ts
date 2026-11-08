import { z } from 'zod';

/**
 * Providers the domain model knows about.
 * - `claude-code`: implemented in Phase 1 (observation mode only).
 * - `codex`: reserved for Phase 5; no adapter exists yet.
 * - `demo`: deterministic fixture adapter. Demo data is never mixed with live data (ADR-0007).
 */
export const ProviderIdSchema = z.enum(['claude-code', 'codex', 'demo']);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

/**
 * Providers that can run managed agents (ADR-0031): the providers with a `ManagedExecutionAdapter`.
 * A workflow node or a project picks one; `demo` never runs managed agents.
 */
export const ManagedProviderIdSchema = z.enum(['claude-code', 'codex']);
export type ManagedProviderId = z.infer<typeof ManagedProviderIdSchema>;
export const MANAGED_PROVIDERS = ManagedProviderIdSchema.options;

/** The provider of a node and a project that choose none: every graph before ADR-0031. */
export const DEFAULT_MANAGED_PROVIDER: ManagedProviderId = 'claude-code';
