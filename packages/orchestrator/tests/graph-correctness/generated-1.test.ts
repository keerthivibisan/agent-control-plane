import { describe, it } from 'vitest';
import { expectClean, generatedShard } from './small-graphs.js';

/**
 * Layer 2 over generated valid graphs (seeds 101–200): every behaviour
 * explored, node by node, with no invariant violation or deadlock. On failure the report prints
 * the seed, the graph and the choices. Synthetic data only.
 */
describe('layer 2: generated graphs (seeds 101-200)', () => {
  it('explores every behaviour without a violation', () => {
    expectClean(generatedShard(101, 200));
  }, 120_000);
});
