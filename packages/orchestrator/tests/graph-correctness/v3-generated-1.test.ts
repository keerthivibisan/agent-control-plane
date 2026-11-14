import { describe, it } from 'vitest';
import { expectGeneratedV3Clean } from './v3-generated.js';

/** ADR-0037 (AR-3): seeded random version 3 graphs, shard 2/2 (seeds 20 to 39). */
describe('layer 2: generated version 3 graphs (shard 2/2)', () => {
  it('every explored behaviour keeps the invariants and ends', () => {
    expectGeneratedV3Clean(20, 39);
  }, 300_000);
});
