import { z } from 'zod';

/**
 * Where a value came from (ADR-0007).
 * - `observed`: read directly from a provider record.
 * - `derived`: computed deterministically from observed values.
 * - `estimated`: inferred from incomplete data, or a provider-reported estimate (e.g. cost).
 * - `unavailable`: the source does not expose it. Never represented as 0.
 */
export const ProvenanceSchema = z.enum(['observed', 'derived', 'estimated', 'unavailable']);
export type Provenance = z.infer<typeof ProvenanceSchema>;

export type Available<T> = {
  provenance: 'observed' | 'derived' | 'estimated';
  value: T;
};
export type Unavailable = {
  provenance: 'unavailable';
  value: null;
  reason?: string;
};
/** A value annotated with its provenance. Unavailable values carry `null`, never a default. */
export type Sourced<T> = Available<T> | Unavailable;

export function sourcedSchema<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('provenance', [
    z.object({ provenance: z.literal('observed'), value }),
    z.object({ provenance: z.literal('derived'), value }),
    z.object({ provenance: z.literal('estimated'), value }),
    z.object({
      provenance: z.literal('unavailable'),
      value: z.null(),
      reason: z.string().min(1).optional(),
    }),
  ]);
}

export function unavailable(reason?: string): Unavailable {
  return reason === undefined
    ? { provenance: 'unavailable', value: null }
    : { provenance: 'unavailable', value: null, reason };
}
