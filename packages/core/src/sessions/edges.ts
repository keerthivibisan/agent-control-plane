import type { ProviderId } from '../domain/provider.js';
import { compareStrings, timestampMs } from '../usage/ordering.js';
import type { SessionEdge, SessionEdgeEvidence, SessionKey } from './session.js';
import { sessionKeysEqual, sessionKeyToString } from './session-key.js';

/** Tool names whose `tool.called` can spawn a subagent (docs/provider-adapters.md §5). */
export const SUBAGENT_SPAWN_TOOL_NAMES: readonly string[] = Object.freeze(['Agent', 'Task']);

/** What a subagent `.meta.json` (and optional hooks) say about one subagent. */
export interface SubagentMetaEvidence {
  provider: ProviderId;
  /** Session directory the meta file lives under (`<S>/subagents/`). */
  providerSessionId: string;
  agentId: string;
  /** `meta.toolUseId`: the tool call that spawned the subagent, when reported. */
  spawnToolUseId: string | null;
  spawnDepth: number | null;
  /** A SubagentStart/SubagentStop hook named this agent within the same session. */
  hookObserved?: boolean;
}

/** A `tool.called` event seen in some session's transcript. */
export interface ToolCallSighting {
  session: SessionKey;
  toolUseId: string;
  toolName: string;
}

/**
 * The `subagent` edge for one subagent (docs/provider-adapters.md §5), or null when the parent is
 * unknown. Only evidence creates an edge; there is no fallback to the root session.
 *
 * - No meta file: null. A subagent transcript alone proves nothing about its parent.
 * - Depth 1 (or unreported): parent is the top-level session `(S, null)`, evidence
 *   `subagent-metadata`, plus `spawn-tool-use` when the root transcript holds the spawning call.
 * - Depth > 1: parent is the one session in `S` whose transcript holds the spawning call. No match,
 *   or calls in several sessions, gives null (parent unknown).
 *
 * Tool calls are matched only within the same provider session `S`, because forks copy history
 * (including Agent tool calls) into other sessions' files.
 */
export function deriveSubagentEdge(
  meta: SubagentMetaEvidence | null,
  toolCalls: readonly ToolCallSighting[],
): SessionEdge | null {
  if (meta === null) return null;
  const child: SessionKey = {
    provider: meta.provider,
    providerSessionId: meta.providerSessionId,
    providerAgentId: meta.agentId,
  };
  const root: SessionKey = { ...child, providerAgentId: null };

  const callers = new Map<string, SessionKey>();
  if (meta.spawnToolUseId !== null) {
    for (const call of toolCalls) {
      if (
        call.toolUseId === meta.spawnToolUseId &&
        SUBAGENT_SPAWN_TOOL_NAMES.includes(call.toolName) &&
        call.session.provider === meta.provider &&
        call.session.providerSessionId === meta.providerSessionId &&
        !sessionKeysEqual(call.session, child)
      ) {
        callers.set(sessionKeyToString(call.session), call.session);
      }
    }
  }

  const evidence: SessionEdgeEvidence[] = ['subagent-metadata'];
  let parent: SessionKey;
  if (meta.spawnDepth !== null && meta.spawnDepth > 1) {
    const [only, ...rest] = [...callers.values()];
    if (only === undefined || rest.length > 0) return null;
    parent = only;
    evidence.push('spawn-tool-use');
  } else {
    parent = root;
    if (callers.has(sessionKeyToString(root))) evidence.push('spawn-tool-use');
  }
  if (meta.hookObserved === true) evidence.push('subagent-hook');

  return { kind: 'subagent', parent: { ...parent }, child, provenance: 'observed', evidence };
}

/** A message id seen in a session's transcript. `UsageObservation` satisfies this shape. */
export interface MessageSighting {
  messageId: string;
  session: SessionKey;
  occurredAt: string | null;
}

/**
 * `continuation` edges from shared message history (docs/provider-adapters.md §5): session B's file
 * holds message ids that session A saw **strictly earlier**, because a fork copies its parent's
 * history.
 *
 * A message's origin is the one session whose earliest sighting is strictly earlier than every
 * other session's. Fork copies keep the original line's timestamp, so for real forks the earliest
 * time is usually tied: the direction is then unknown and the message is no evidence at all
 * (usage-accounting §5.2, tie amendment). A null `occurredAt` never counts as earlier or later.
 *
 * For child B, the inherited messages are those whose origin is another provider session. The
 * parent is the single candidate that holds *all* of them, each sighted strictly earlier than in B:
 * in a chain Z → A → B, B inherits from both Z and A, but only A holds both sets. No such candidate,
 * or more than one, gives no edge (parent unknown).
 *
 * Sessions sharing a provider session id (a top-level session and its subagents) never form
 * continuation edges. Edges that would form a cycle are dropped. Output is sorted by child key and
 * does not depend on input order.
 */
export function deriveContinuationEdges(sightings: readonly MessageSighting[]): SessionEdge[] {
  const keys = new Map<string, SessionKey>();
  const messagesBySession = new Map<string, Set<string>>();
  /** message key -> session key -> earliest sighting (ms), null when no sighting had a time. */
  const earliest = new Map<string, Map<string, number | null>>();

  for (const s of sightings) {
    const sk = sessionKeyToString(s.session);
    keys.set(sk, s.session);
    const mk = JSON.stringify([s.session.provider, s.messageId]);
    const messages = messagesBySession.get(sk);
    if (messages === undefined) messagesBySession.set(sk, new Set([mk]));
    else messages.add(mk);

    let bySession = earliest.get(mk);
    if (bySession === undefined) {
      bySession = new Map();
      earliest.set(mk, bySession);
    }
    const ms = timestampMs(s.occurredAt);
    const current = bySession.get(sk);
    if (current === undefined) bySession.set(sk, ms);
    else if (ms !== null && (current === null || ms < current)) bySession.set(sk, ms);
  }

  const originOf = (mk: string): string | undefined => {
    let origin: string | undefined;
    let best = Infinity;
    let tied = false;
    for (const [sk, ms] of earliest.get(mk) ?? []) {
      if (ms === null) continue;
      if (ms < best) {
        best = ms;
        origin = sk;
        tied = false;
      } else if (ms === best) {
        tied = true;
      }
    }
    return tied ? undefined : origin;
  };
  const strictlyEarlier = (mk: string, parentKey: string, childKey: string): boolean => {
    const bySession = earliest.get(mk);
    const p = bySession?.get(parentKey);
    const c = bySession?.get(childKey);
    return p !== undefined && p !== null && c !== undefined && c !== null && p < c;
  };

  const parentOf = new Map<string, string>();
  for (const [childKey, messages] of messagesBySession) {
    const child = keys.get(childKey);
    if (child === undefined) continue;
    const inherited: string[] = [];
    const candidates = new Set<string>();
    for (const mk of messages) {
      const origin = originOf(mk);
      if (origin === undefined || origin === childKey) continue;
      if (keys.get(origin)?.providerSessionId === child.providerSessionId) continue;
      inherited.push(mk);
      candidates.add(origin);
    }
    const parents = [...candidates].filter((c) =>
      inherited.every((mk) => strictlyEarlier(mk, c, childKey)),
    );
    const [only, ...rest] = parents;
    if (only !== undefined && rest.length === 0) parentOf.set(childKey, only);
  }

  const edges: SessionEdge[] = [];
  for (const childKey of [...parentOf.keys()].sort(compareStrings)) {
    if (isOnCycle(childKey, parentOf)) continue;
    const parentKey = parentOf.get(childKey);
    const parent = parentKey === undefined ? undefined : keys.get(parentKey);
    const child = keys.get(childKey);
    if (parent === undefined || child === undefined) continue;
    edges.push({
      kind: 'continuation',
      parent: { ...parent },
      child: { ...child },
      provenance: 'derived',
      evidence: ['shared-message-history'],
    });
  }
  return edges;
}

/** Whether following parent links from `start` returns to `start`. */
function isOnCycle(start: string, parentOf: ReadonlyMap<string, string>): boolean {
  const seen = new Set<string>();
  let current = parentOf.get(start);
  while (current !== undefined) {
    if (current === start) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    current = parentOf.get(current);
  }
  return false;
}
