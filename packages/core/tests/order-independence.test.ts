import { describe, expect, it } from 'vitest';
import type {
  SessionEdge,
  SessionKey,
  SubagentMetaEvidence,
  ToolCallSighting,
  UsageObservation,
} from '../src/index.js';
import {
  aggregateUsage,
  buildUsageRecord,
  deriveContinuationEdges,
  deriveSubagentEdge,
  directUsageBySession,
  groupObservationsByMessage,
  sessionKeyToString,
  SYNTHETIC_MODEL,
  usageMessageKey,
} from '../src/index.js';
import { at, key } from './helpers/builders.js';

/**
 * usage-accounting §7 scenario 5 (A8): selection, attribution, edges, and aggregates depend only on
 * the set of observations, never on the order they were ingested. Synthetic data, seeded PRNG.
 */

/** mulberry32: tiny deterministic PRNG, good enough for shuffling test data. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}

const pick = <T>(items: readonly T[], random: () => number): T =>
  items[Math.floor(random() * items.length)] as T;

const ROOT = key('sess-root');
const SUB1 = key('sess-root', 'a1');
const SUB2 = key('sess-root', 'a2');
const NESTED = key('sess-root', 'a3');
const FORK = key('sess-fork');
const FORK_SUB = key('sess-fork', 'b1');
const ORIGINS = [ROOT, SUB1, SUB2, NESTED, FORK, FORK_SUB];

interface Dataset {
  observations: UsageObservation[];
  metas: SubagentMetaEvidence[];
  toolCalls: ToolCallSighting[];
}

/** A random dataset with duplicates, growing output, nulls, conflicts, synthetic lines, and forks. */
function generate(random: () => number): Dataset {
  const drafts: Omit<UsageObservation, 'eventId'>[] = [];
  const maybe = (p: number) => random() < p;
  const count = (): number | null => (maybe(0.1) ? null : Math.floor(random() * 1000));

  for (let m = 0; m < 40; m++) {
    const session = pick(ORIGINS, random);
    const second = Math.floor(random() * 30);
    const occurredAt = maybe(0.1) ? null : at(second);
    const model = maybe(0.05) ? SYNTHETIC_MODEL : pick(['model-a', 'model-b'], random);
    const base = { input: count(), cacheCreation: count(), cacheRead: count() };
    let output = Math.floor(random() * 50);
    const lines = 1 + Math.floor(random() * 4);
    const messageId = `msg_${m}`;
    for (let line = 0; line < lines; line++) {
      output += Math.floor(random() * 200);
      drafts.push({
        messageId,
        session,
        // Streaming lines share the message's timestamp or carry a slightly later one.
        occurredAt: occurredAt === null || maybe(0.5) ? occurredAt : at(second + line),
        requestId: `req_${m}`,
        model,
        tokens: {
          ...base,
          // Rarely a line disagrees on cache reads (a conflict) or lacks output.
          cacheRead: maybe(0.05) ? count() : base.cacheRead,
          output: maybe(0.1) ? null : output,
        },
      });
    }
    // Forks copy top-level history; the copy may carry the same or a later timestamp.
    if (session === ROOT && maybe(0.6)) {
      drafts.push({
        messageId,
        session: FORK,
        occurredAt: maybe(0.5) ? occurredAt : at(second + 40),
        requestId: `req_${m}`,
        model,
        tokens: { ...base, output },
      });
    }
  }
  const observations = drafts.map((d, i) => ({ ...d, eventId: i + 1 }));

  const metas: SubagentMetaEvidence[] = [
    { ...metaFor(SUB1), spawnToolUseId: 'toolu_1', spawnDepth: 1 },
    { ...metaFor(SUB2), spawnToolUseId: 'toolu_2', spawnDepth: 1 },
    { ...metaFor(NESTED), spawnToolUseId: 'toolu_3', spawnDepth: 2 },
    { ...metaFor(FORK_SUB), spawnToolUseId: 'toolu_4', spawnDepth: 1 },
  ];
  const toolCalls: ToolCallSighting[] = [
    { session: ROOT, toolUseId: 'toolu_1', toolName: 'Agent' },
    { session: ROOT, toolUseId: 'toolu_2', toolName: 'Agent' },
    { session: SUB1, toolUseId: 'toolu_3', toolName: 'Agent' },
    { session: FORK, toolUseId: 'toolu_4', toolName: 'Agent' },
    // A fork copy of the root's spawning call must not matter.
    { session: FORK, toolUseId: 'toolu_1', toolName: 'Agent' },
  ];
  return { observations, metas, toolCalls };
}

function metaFor(k: SessionKey): Omit<SubagentMetaEvidence, 'spawnToolUseId' | 'spawnDepth'> {
  return {
    provider: k.provider,
    providerSessionId: k.providerSessionId,
    agentId: k.providerAgentId ?? '',
  };
}

/** Runs the whole projection and returns a canonical, order-free snapshot of the result. */
function project(observations: readonly UsageObservation[], data: Dataset, random: () => number) {
  const records = [...groupObservationsByMessage(observations).values()]
    .map((group) => buildUsageRecord(group))
    .filter((r) => r !== null)
    .sort((a, b) => (usageMessageKey(a) < usageMessageKey(b) ? -1 : 1));

  const subagentEdges = shuffle(data.metas, random)
    .map((m) => deriveSubagentEdge(m, shuffle(data.toolCalls, random)))
    .filter((e): e is SessionEdge => e !== null);
  const continuationEdges = deriveContinuationEdges(observations);
  const edges = shuffle([...subagentEdges, ...continuationEdges], random);

  const direct = directUsageBySession(records);
  const aggregates = ORIGINS.map((k) => [sessionKeyToString(k), aggregateUsage(k, direct, edges)]);
  const byKey = (e: SessionEdge) => sessionKeyToString(e.child) + e.kind;

  return {
    records,
    direct: [...direct.entries()].sort(([a], [b]) => (a < b ? -1 : 1)),
    aggregates,
    edges: [...subagentEdges, ...continuationEdges].sort((a, b) => (byKey(a) < byKey(b) ? -1 : 1)),
  };
}

describe('order independence (usage-accounting §7 scenario 5, A8)', () => {
  const seeds = Array.from({ length: 25 }, (_, i) => 1_000 + i * 7_919);

  it.each(seeds)('seed %i: shuffled observations give identical results', (seed) => {
    const random = prng(seed);
    const data = generate(random);
    const baseline = project(data.observations, data, random);

    // The dataset is not degenerate: it exercises dedup, forks, and subagent aggregation.
    expect(baseline.records.length).toBeGreaterThan(10);
    expect(baseline.edges.some((e) => e.kind === 'subagent')).toBe(true);

    for (let round = 0; round < 10; round++) {
      const shuffled = shuffle(data.observations, random);
      expect(project(shuffled, data, random)).toEqual(baseline);
    }
  });

  it('the generated datasets exercise both ambiguous and clear attribution (A9)', () => {
    // Fork copies sometimes keep the original timestamp (ambiguous) and sometimes carry a later one.
    // Records compared above include `attributionAmbiguous`, so the flag is order-independent too.
    const flags = seeds.flatMap((seed) => {
      const random = prng(seed);
      const data = generate(random);
      return project(data.observations, data, random).records.map((r) => r.attributionAmbiguous);
    });
    expect(flags).toContain(true);
    expect(flags).toContain(false);
  });

  it('never double-counts a message across sessions', () => {
    const random = prng(42);
    const data = generate(random);
    const { records } = project(data.observations, data, random);
    const ids = records.map((r) => r.messageId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
