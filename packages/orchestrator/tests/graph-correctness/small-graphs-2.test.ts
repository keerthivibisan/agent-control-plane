import { describe, it } from 'vitest';
import { expectClean, smallGraphShard } from './small-graphs.js';

/**
 * Layer 4, shard 3 of 4: every small graph the validator accepts runs with no invariant
 * violation or deadlock in any explored behaviour (soundness); every graph it rejects is refused
 * by compile (completeness). A flagged accepted graph is a validator gap. Synthetic data only.
 */
describe('layer 4: small graphs (shard 3/4)', () => {
  it('accepted graphs are sound, rejected graphs never compile', () => {
    expectClean(smallGraphShard(2, 4));
  }, 120_000);
});
