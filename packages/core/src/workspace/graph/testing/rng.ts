/**
 * A tiny seeded pseudo-random generator (mulberry32) for the graph generators. Deterministic for a
 * seed, so a failing property test prints a seed that reproduces it. Not for anything secret.
 */
export interface GraphRng {
  readonly seed: number;
  /** A float in [0, 1). */
  next(): number;
  /** An integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** True with probability `p` (default one half). */
  bool(p?: number): boolean;
  /** One item; the list must not be empty. */
  pick<T>(items: readonly T[]): T;
}

export function createGraphRng(seed: number): GraphRng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (maxExclusive: number): number => Math.floor(next() * maxExclusive);
  return {
    seed,
    next,
    int,
    bool: (p = 0.5) => next() < p,
    pick<T>(items: readonly T[]): T {
      const item = items[int(items.length)];
      if (item === undefined) throw new Error('GraphRng.pick: empty list');
      return item;
    },
  };
}
