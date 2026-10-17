import type { EngineAgent, EngineEffect, RunState } from '../../src/index.js';

/**
 * A normalized, deterministic trace of one simulated run (README "Graph correctness", layer 5).
 * Ids become stable symbols (`L` the lead, `P` the planner, `W1`… helpers, `CR1`… change
 * reviewers, `FR1`… final reviewers, `T1`… testers, `A1`… approvals, `plan1`…), long texts become
 * a short prefix plus a hash, and timestamps are dropped. Two engines that behave the same on the
 * same script give the same trace. Synthetic data only.
 */

/** FNV-1a, 32 bits, hex: enough to tell two prompts apart in a snapshot. */
export function textHash(text: string, seed = 0x811c9dc5): string {
  let h = seed;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** A whole trace's digest: two differently seeded hashes and its length. */
export function traceDigest(trace: string): string {
  return `${textHash(trace)}${textHash(trace, 0x01234567)}/${trace.length}`;
}

const LONG_TEXT_KEYS = new Set(['prompt', 'text', 'body', 'value']);
const ID_KEYS = new Set([
  'agentRunId',
  'approvalId',
  'planId',
  'reviewerAgentRunId',
  'reviewsAgentRunId',
  'changeOf',
]);
const DROPPED_KEYS = new Set([
  'createdAt',
  'updatedAt',
  'endedAt',
  'requestedAt',
  'decidedAt',
  'readyAt',
]);

export class IdNames {
  private readonly names = new Map<string, string>();
  private readonly counters = new Map<string, number>();

  constructor(runId: string, leadId: string) {
    this.names.set(runId, 'RUN');
    this.names.set(leadId, 'L');
  }

  private next(prefix: string): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}${n}`;
  }

  /** Names every agent, approval and plan of the state not named yet, in creation order. */
  learn(state: RunState): void {
    for (const a of state.agents) {
      if (this.names.has(a.id)) continue;
      this.names.set(a.id, this.next(agentPrefix(a)));
    }
    for (const p of state.approvals) {
      if (!this.names.has(p.id)) this.names.set(p.id, this.next('A'));
    }
    for (const p of state.plans ?? []) {
      if (!this.names.has(p.id)) this.names.set(p.id, this.next('plan'));
    }
  }

  name(id: string): string {
    return this.names.get(id) ?? `?${id}`;
  }

  /** Every known id inside free text replaced by its symbol (longest first, whole ids only). */
  text(text: string): string {
    const ids = [...this.names.keys()].sort((a, b) => b.length - a.length);
    let out = text;
    for (const id of ids) {
      const name = this.names.get(id) ?? id;
      out = out.replace(new RegExp(`(?<![\\w-])${escapeRegExp(id)}(?![\\w-])`, 'g'), name);
    }
    return out;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function agentPrefix(a: EngineAgent): string {
  switch (a.kind) {
    case 'lead':
      return 'L';
    case 'planner':
      return 'P';
    case 'worker':
      return 'W';
    case 'tester':
      return 'T';
    case 'reviewer':
      return a.reviewsAgentRunId !== undefined ? 'CR' : 'FR';
  }
}

/** A long text as `"first 40 characters…"#hash/len`, ids already replaced. */
export function shortText(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= 48) return JSON.stringify(flat);
  return `${JSON.stringify(`${flat.slice(0, 40)}…`)}#${textHash(text)}/${text.length}`;
}

function value(names: IdNames, key: string, v: unknown): string {
  if (typeof v === 'string') {
    if (ID_KEYS.has(key)) return names.name(v);
    const text = names.text(v);
    return LONG_TEXT_KEYS.has(key) ? shortText(text) : JSON.stringify(text);
  }
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  return names.text(JSON.stringify(v));
}

/** One effect as one line: its type, then its other fields sorted by name. */
export function effectLine(names: IdNames, effect: EngineEffect): string {
  const entries = Object.entries(effect)
    .filter(([k]) => k !== 'type' && !DROPPED_KEYS.has(k))
    .sort(([a], [b]) => a.localeCompare(b));
  return [effect.type, ...entries.map(([k, v]) => `${k}=${value(names, k, v)}`)].join(' ');
}

function changeWords(a: EngineAgent): string {
  const c = a.change;
  if (c === undefined) return '';
  return ` change=${c.state}/r${c.round}${c.verdict !== null ? `/${c.verdict}` : ''}${c.checks !== null ? `/checks:${c.checks}` : ''}`;
}

/** What changed between two states: run status, each agent's status, review and change. */
export function stateDiff(names: IdNames, before: RunState | null, after: RunState): string[] {
  const lines: string[] = [];
  if (before?.run.status !== after.run.status) lines.push(`run ${after.run.status}`);
  for (const a of after.agents) {
    const prev = before?.agents.find((x) => x.id === a.id);
    const now = `${a.status}${a.review !== null ? ` review=${a.review}` : ''}${changeWords(a)}`;
    const was =
      prev === undefined
        ? null
        : `${prev.status}${prev.review !== null ? ` review=${prev.review}` : ''}${changeWords(prev)}`;
    if (was === now) continue;
    const head =
      prev === undefined
        ? `+${names.name(a.id)} ${a.kind} role=${JSON.stringify(a.role)} stage=${a.stage ?? '-'}`
        : names.name(a.id);
    lines.push(`${head} ${now}`);
  }
  for (const p of after.plans ?? []) {
    const prev = before?.plans?.find((x) => x.id === p.id);
    if (prev?.status === p.status) continue;
    lines.push(
      `${names.name(p.id)} ${p.status}${p.decidedBy !== undefined ? ` by=${p.decidedBy}` : ''}`,
    );
  }
  if (before?.integration?.handedOver !== after.integration?.handedOver) {
    lines.push(`handedOver=${String(after.integration?.handedOver ?? false)}`);
  }
  if ((before?.stagesHeld ?? false) !== (after.stagesHeld ?? false)) {
    lines.push(`stagesHeld=${String(after.stagesHeld ?? false)}`);
  }
  return lines;
}

/** The final state of every agent, one line each. */
export function finalLines(names: IdNames, state: RunState): string[] {
  return [
    `final run=${state.run.status}`,
    ...state.agents.map(
      (a) =>
        `  ${names.name(a.id)} ${a.kind} stage=${a.stage ?? '-'} ${a.status}${a.review !== null ? ` review=${a.review}` : ''}${changeWords(a)}`,
    ),
  ];
}
