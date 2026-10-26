import type { ActivityItemDto, TicketCommentDto, TicketDetailDto } from '@acp/core/api';
import { parseMergeLine } from '../ticket/run-summary';
import { runNumber } from '../ticket/ticket-state';
import { commentKind, onCommentsTab } from './comment-kind';
import { ACTIVITY_COPY } from './copy';

const A = ACTIVITY_COPY;
const D = A.derived;

/*
 * The Conversation tab from the ticket's own records, for a server that doesn't answer
 * `GET /api/tickets/:id/activity` (one before 0.3.0): each run starting, each plan version, and
 * every comment that isn't on the Comments tab. It never adds what those records don't say: no
 * agent starts or ends, no decisions, and an agent's note names its agent only when the run on
 * screen lists it.
 */

type Actor = ActivityItemDto['actor'];

const APP: Actor = { kind: 'app', label: A.actor.app, agentRunId: null };

function actorOf(
  comment: TicketCommentDto,
  agents: readonly { id: string; kind: string; role: string }[],
): Actor {
  const kind = commentKind(comment);
  if (kind === 'agent-note') {
    const id = comment.agentRunId ?? null;
    const agent = id === null ? undefined : agents.find((a) => a.id === id);
    return {
      kind: agent?.kind === 'tester' ? 'tester' : 'worker',
      label: agent?.role ?? A.actor.agent,
      agentRunId: id,
    };
  }
  switch (comment.author) {
    case 'owner':
      return { kind: 'owner', label: A.actor.owner, agentRunId: null };
    case 'reviewer':
      return { kind: 'reviewer', label: A.actor.reviewer, agentRunId: null };
    case 'lead':
      return { kind: 'lead', label: A.actor.lead, agentRunId: null };
    case 'app':
      return APP;
  }
}

function itemOf(
  comment: TicketCommentDto,
  agents: readonly { id: string; kind: string; role: string }[],
): ActivityItemDto {
  const kind = commentKind(comment);
  const actor = actorOf(comment, agents);
  const base = {
    id: `comment-${comment.id}`,
    at: comment.createdAt,
    runId: comment.runId,
    actor,
    body: comment.body,
    link: null,
  };
  switch (kind) {
    case 'agent-note':
      return { ...base, type: 'agent-note', title: D.agentNote(actor.label) };
    case 'review':
      return { ...base, type: 'review', title: D.review };
    case 'run-facts':
      return { ...base, type: 'run-facts', title: D.runFacts };
    case 'system': {
      const note = parseMergeLine(comment.body);
      return {
        ...base,
        type: note?.kind === 'pr-pushed' ? 'pull-request' : 'merge',
        title: comment.body.trim().slice(0, 300) || D.system,
      };
    }
    // `note`; the Comments tab kinds never reach here.
    default:
      return { ...base, type: 'note', title: D.note };
  }
}

/** Same moment: the run first, then its plan, then what was said about it. */
const ORDER: Partial<Record<ActivityItemDto['type'], number>> = { 'run-started': 0, plan: 1 };

export function activityFromDetail(
  detail: Pick<TicketDetailDto, 'runs' | 'plans' | 'comments' | 'currentRun'>,
): ActivityItemDto[] {
  const agents = detail.currentRun?.agents ?? [];
  const items: ActivityItemDto[] = [
    ...detail.runs.map((run): ActivityItemDto => ({
      id: `run-${run.id}`,
      at: run.createdAt,
      runId: run.id,
      type: 'run-started',
      actor: APP,
      title: D.runStarted(runNumber(detail.runs, run.id)),
      body: null,
      link: null,
    })),
    ...detail.plans.map((plan): ActivityItemDto => ({
      id: `plan-${plan.id}`,
      at: plan.createdAt,
      runId: plan.runId,
      type: 'plan',
      actor: { kind: 'lead', label: A.actor.lead, agentRunId: null },
      title: D.plan(plan.version),
      body: null,
      link: { kind: 'plan', planId: plan.id },
    })),
    ...detail.comments.filter((c) => !onCommentsTab(c)).map((c) => itemOf(c, agents)),
  ];
  // A stable sort: same moment and same rank keep the order above.
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      if (a.item.at !== b.item.at) return a.item.at < b.item.at ? -1 : 1;
      const ra = ORDER[a.item.type] ?? 2;
      const rb = ORDER[b.item.type] ?? 2;
      return ra !== rb ? ra - rb : a.i - b.i;
    })
    .map((x) => x.item);
}

/** One filter chip per actor, in the order they first appear. */
export interface ActorFilter {
  key: string;
  label: string;
  kind: Actor['kind'];
  count: number;
}

export function actorKey(actor: Pick<Actor, 'kind' | 'label'>): string {
  return `${actor.kind}:${actor.label}`;
}

export function actorFilters(items: readonly ActivityItemDto[]): ActorFilter[] {
  const out = new Map<string, ActorFilter>();
  for (const item of items) {
    const key = actorKey(item.actor);
    const found = out.get(key);
    if (found) found.count += 1;
    else out.set(key, { key, label: item.actor.label, kind: item.actor.kind, count: 1 });
  }
  return [...out.values()];
}
