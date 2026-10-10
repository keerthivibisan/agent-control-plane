import { z } from 'zod';

/**
 * Providers the domain model knows about.
 * - `claude-code`: implemented in Phase 1 (observation mode only).
 * - `codex`: reserved for Phase 5; no adapter exists yet.
 * - `demo`: deterministic fixture adapter. Demo data is never mixed with live data (ADR-0007).
 */
export const ProviderIdSchema = z.enum(['claude-code', 'codex', 'demo']);
export type ProviderId = z.infer<typeof ProviderIdSchema>;
