import { COMMENTS_TAB_KINDS } from '@acp/core';
import type {
  AgentRoleKind,
  AgentRunStatus,
  ChangeDecider,
  ChangeDecision,
  OrchestrationRun,
  RunStatus,
  TicketPlan,
} from '@acp/core';
import type { ActivityItemDto, TicketActivityDto } from '@acp/core/api';
import type { ChangeReviewRow, StoredTicketComment, TicketBranchRow, WorkspaceRow } from '@acp/db';
import type { EngineAgent, RunState } from '@acp/orchestrator';
import { agentName, capTitle, ROLE_WORDS } from '../control/session-names.js';
import { commentKindOf } from './comments.js';

/**
 * The ticket's activity, the Conversation tab (ADR-0026 §1): a timeline built from records the app
 * already keeps (runs, plans, agent runs, change reviews and decisions, ticket branches, and the
 * comments that belong on Conversation). Pure: the board service gathers the records. No
 * conversation content (ADR-0009): the only texts are those written for the ticket on purpose
 * (plan summaries, agent notes, review findings, the lead's and owner's notes, run facts).
 */

export interface ActivityRun {
  run: OrchestrationRun;
  /** The engine state, for agent names and agents; undefined when it cannot be loaded. */
  state: RunState | undefined;
  reviews: readonly ChangeReviewRow[];
  branch: TicketBranchRow | undefined;
  workspaces: readonly WorkspaceRow[];
}

export interface ActivityInput {
  ticketId: string;
  ticketKey: string;
  /** Oldest first. */
  runs: readonly ActivityRun[];
  plans: readonly TicketPlan[];
  comments: readonly StoredTicketComment[];
}

const APP_LABEL = 'Agent Control Plane';
const OWNER_LABEL = 'You';
const TITLE_MAX = 300;
const BODY_MAX = 8000;

type Item = ActivityItemDto;
type Actor = Item['actor'];

const APP: Actor = { kind: 'app', label: APP_LABEL, agentRunId: null };
const OWNER: Actor = { kind: 'owner', label: OWNER_LABEL, agentRunId: null };

const RUN_ENDED: Partial<Record<RunStatus, string>> = {
  COMPLETED: 'finished',
  FAILED: 'failed',
  CANCELLED: 'was stopped',
};

const AGENT_ENDED: Partial<Record<AgentRunStatus, string>> = {
  SUCCEEDED: 'finished',
  FAILED: 'failed',
  CANCELLED: 'was stopped',
  TIMED_OUT: 'timed out',
  NEEDS_REVIEW: 'was interrupted by a restart',
};

function title(text: string): string {
  return capTitle(text, TITLE_MAX);
}

function body(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  const trimmed = text.trim();
  if (trimmed === '') return null;
  return trimmed.length <= BODY_MAX ? trimmed : `${trimmed.slice(0, BODY_MAX - 1)}…`;
}

/** Names and kinds of one run's agents, from its engine state. */
function namesOf(input: ActivityInput, entry: ActivityRun) {
  const state = entry.state;
  const reviewed = new Map<string, string>();
  for (const r of entry.reviews) {
    if (r.reviewerAgentRunId !== null) reviewed.set(r.reviewerAgentRunId, r.agentRunId);
  }
  const agents = new Map<string, EngineAgent>((state?.agents ?? []).map((a) => [a.id, a]));
  const label = (agentRunId: string | null, fallback: AgentRoleKind): string => {
    if (agentRunId === null || state === undefined) return ROLE_WORDS[fallback];
    return (
      agentName({
        state,
        agentRunId,
        ticketKey: input.ticketKey,
        reviewedAgentRunId: (id) => reviewed.get(id),
      })?.label ?? ROLE_WORDS[agents.get(agentRunId)?.kind ?? fallback]
    );
  };
  const actor = (agentRunId: string | null, fallback: AgentRoleKind): Actor => {
    const kind = (agentRunId === null ? undefined : agents.get(agentRunId)?.kind) ?? fallback;
    return { kind, label: label(agentRunId, kind), agentRunId };
  };
  const lead = state?.agents.find((a) => a.kind === 'lead');
  const leadActor = (): Actor => actor(lead?.id ?? null, 'lead');
  return { agents, label, actor, leadActor };
}

function deciderActor(
  by: ChangeDecider,
  names: ReturnType<typeof namesOf>,
  row: ChangeReviewRow,
): Actor {
  if (by === 'owner') return OWNER;
  if (by === 'lead') return names.leadActor();
  return names.actor(row.reviewerAgentRunId, 'reviewer');
}

const DECISION_WORDS: Readonly<Record<ChangeDecision, (who: string, helper: string) => string>> = {
  merge: (w, h) => `${w} merged ${h}'s change into the ticket branch`,
  'merge-anyway': (w, h) => `${w} merged ${h}'s change anyway`,
  rework: (w, h) => `${w} sent ${h}'s change back for rework`,
  discard: (w, h) => `${w} discarded ${h}'s change`,
  'ask-owner': (w, h) => `${w} asked you to decide on ${h}'s change`,
};

/** Builds the timeline, oldest first (ties keep the order they were found in). */
export function buildTicketActivity(input: ActivityInput): TicketActivityDto {
  const items: Item[] = [];
  const used = new Set<string>();
  const commentsById = new Map(input.comments.map((c) => [c.id, c]));
  const runIndex = new Map(input.runs.map((r, i) => [r.run.id, i]));
  const namesByRun = new Map(input.runs.map((r) => [r.run.id, namesOf(input, r)]));

  for (const [i, entry] of input.runs.entries()) {
    const { run } = entry;
    const n = i + 1;
    const names = namesByRun.get(run.id) ?? namesOf(input, entry);
    items.push({
      id: `run-started:${run.id}`,
      at: run.createdAt,
      runId: run.id,
      type: 'run-started',
      actor: APP,
      title: title(`Run ${n} started`),
      body: null,
      link: null,
    });

    // Agents starting and ending.
    for (const agent of entry.state?.agents ?? []) {
      const actor = names.actor(agent.id, agent.kind);
      const change = agent.kind === 'worker' || agent.kind === 'tester';
      const link = change ? ({ kind: 'change', agentRunId: agent.id } as const) : null;
      items.push({
        id: `agent-started:${agent.id}`,
        at: agent.createdAt,
        runId: run.id,
        type: 'agent-started',
        actor,
        title: title(`${actor.label} started`),
        body: null,
        link,
      });
      const ended = AGENT_ENDED[agent.status];
      if (agent.endedAt !== null && ended !== undefined) {
        items.push({
          id: `agent-ended:${agent.id}`,
          at: agent.endedAt,
          runId: run.id,
          type: 'agent-ended',
          actor,
          title: title(`${actor.label} ${ended}`),
          body: null,
          link,
        });
      }
    }

    // Review-loop rounds: a review agent's findings, and every decision with its note.
    for (const row of entry.reviews) {
      const helper = names.label(row.agentRunId, 'worker');
      const link = { kind: 'change', agentRunId: row.agentRunId } as const;
      const comment = row.commentId === null ? undefined : commentsById.get(row.commentId);
      if (row.reviewer === 'agent' && comment !== undefined && !used.has(comment.id)) {
        used.add(comment.id);
        const actor = names.actor(row.reviewerAgentRunId, 'reviewer');
        const verdict = row.verdict === null ? '' : `: ${row.verdict}`;
        items.push({
          id: `review:${comment.id}`,
          at: comment.createdAt,
          runId: run.id,
          type: 'review',
          actor,
          title: title(`Reviewed ${helper}'s change${verdict}`),
          body: body(comment.body),
          link,
        });
      }
      if (row.decision !== null && row.decidedBy !== null && row.decidedAt !== null) {
        const actor = deciderActor(row.decidedBy, names, row);
        const note =
          row.reviewer !== 'agent' && comment !== undefined && !used.has(comment.id)
            ? comment
            : undefined;
        if (note !== undefined) used.add(note.id);
        items.push({
          id: `decision:${row.id}`,
          at: row.decidedAt,
          runId: run.id,
          type: 'decision',
          actor,
          title: title(DECISION_WORDS[row.decision](actor.label, helper)),
          body: body(note?.body),
          link,
        });
      }
    }

    // Runs before the review loop: the owner's merge or discard of each helper's change.
    if (entry.state?.integration === undefined) {
      for (const ws of entry.workspaces) {
        if (ws.reviewState !== 'merged' && ws.reviewState !== 'discarded') continue;
        const helper = names.label(ws.agentRunId, 'worker');
        items.push({
          id: `decision:${ws.id}`,
          at: ws.updatedAt,
          runId: run.id,
          type: 'decision',
          actor: OWNER,
          title: title(
            ws.reviewState === 'merged'
              ? `${OWNER_LABEL} merged ${helper}'s change`
              : `${OWNER_LABEL} discarded ${helper}'s change`,
          ),
          body: null,
          link: { kind: 'change', agentRunId: ws.agentRunId },
        });
      }
    }

    const ended = RUN_ENDED[run.status];
    if (run.endedAt !== null && ended !== undefined) {
      items.push({
        id: `run-ended:${run.id}`,
        at: run.endedAt,
        runId: run.id,
        type: 'run-ended',
        actor: APP,
        title: title(`Run ${n} ${ended}`),
        body: null,
        link: null,
      });
    }
  }

  // Plans: each version proposed, and the decision on it.
  for (const plan of input.plans) {
    const names = namesByRun.get(plan.runId);
    const planner = input.runs[runIndex.get(plan.runId) ?? -1]?.state?.agents.find(
      (a) => a.kind === 'planner',
    );
    const author = names === undefined ? undefined : names.actor(planner?.id ?? null, 'planner');
    const actor =
      planner !== undefined && author !== undefined ? author : (names?.leadActor() ?? APP);
    const link = { kind: 'plan', planId: plan.id } as const;
    items.push({
      id: `plan:${plan.id}`,
      at: plan.createdAt,
      runId: plan.runId,
      type: 'plan',
      actor,
      title: title(
        `Proposed plan v${plan.version} (${plan.steps.length} ${plan.steps.length === 1 ? 'step' : 'steps'})`,
      ),
      body: body(plan.summary),
      link,
    });
    if (plan.decidedAt !== null && plan.status !== 'superseded' && plan.status !== 'proposed') {
      const auto = plan.decidedBy === 'auto';
      items.push({
        id: `plan-decision:${plan.id}`,
        at: plan.decidedAt,
        runId: plan.runId,
        type: 'decision',
        actor: auto ? APP : OWNER,
        title: title(
          plan.status === 'approved'
            ? `${auto ? 'Approved' : `${OWNER_LABEL} approved`} plan v${plan.version}${auto ? ' automatically (Full auto)' : ''}`
            : `${OWNER_LABEL} asked for changes to plan v${plan.version}`,
        ),
        body: null,
        link,
      });
    }
  }

  // The comments that belong on Conversation and were not shown with a review or decision.
  for (const comment of input.comments) {
    if (used.has(comment.id)) continue;
    const kind = commentKindOf(comment);
    if (COMMENTS_TAB_KINDS.includes(kind)) continue;
    const names = comment.runId === null ? undefined : namesByRun.get(comment.runId);
    const entry =
      comment.runId === null ? undefined : input.runs[runIndex.get(comment.runId) ?? -1];
    const base = { at: comment.createdAt, runId: comment.runId };
    if (kind === 'agent-note') {
      const actor = names?.actor(comment.agentRunId, 'worker') ?? {
        kind: 'worker' as const,
        label: ROLE_WORDS.worker,
        agentRunId: comment.agentRunId,
      };
      items.push({
        id: `agent-note:${comment.id}`,
        ...base,
        type: 'agent-note',
        actor,
        title: title(`${actor.label} reported its work`),
        body: body(comment.body),
        link:
          comment.agentRunId === null ? null : { kind: 'change', agentRunId: comment.agentRunId },
      });
    } else if (kind === 'review') {
      // A final reviewer's findings (post_review): named when the run has one final reviewer.
      const finals = (entry?.state?.agents ?? []).filter(
        (a) => a.kind === 'reviewer' && !entry?.reviews.some((r) => r.reviewerAgentRunId === a.id),
      );
      const actor =
        names !== undefined && finals.length === 1
          ? names.actor(finals[0]?.id ?? null, 'reviewer')
          : { kind: 'reviewer' as const, label: ROLE_WORDS.reviewer, agentRunId: null };
      items.push({
        id: `review:${comment.id}`,
        ...base,
        type: 'review',
        actor,
        title: title(`${actor.label} posted review findings`),
        body: body(comment.body),
        link: { kind: 'files' },
      });
    } else if (kind === 'run-facts') {
      const [first = 'Run summary', ...rest] = comment.body.split('\n');
      items.push({
        id: `run-facts:${comment.id}`,
        ...base,
        type: 'run-facts',
        actor: APP,
        title: title(first),
        body: body(rest.join('\n')),
        link: null,
      });
    } else if (kind === 'system') {
      const [first = '', ...rest] = comment.body.split('\n');
      const pr = entry?.branch?.pullRequest ?? null;
      const viaPr = /pull request/i.test(first);
      const merge = first.startsWith('Merged');
      items.push({
        id: `system:${comment.id}`,
        ...base,
        type: merge ? 'merge' : viaPr ? 'pull-request' : 'note',
        actor: APP,
        title: title(first),
        body: body(rest.join('\n')),
        link:
          viaPr && pr !== null
            ? { kind: 'pull-request', url: pr.url }
            : merge
              ? { kind: 'files' }
              : null,
      });
    } else {
      // `note`: the lead's or owner's note not tied to a recorded decision.
      const actor: Actor =
        comment.author === 'owner'
          ? OWNER
          : comment.author === 'app'
            ? APP
            : comment.author === 'reviewer'
              ? { kind: 'reviewer', label: ROLE_WORDS.reviewer, agentRunId: null }
              : (names?.leadActor() ?? { kind: 'lead', label: ROLE_WORDS.lead, agentRunId: null });
      items.push({
        id: `note:${comment.id}`,
        ...base,
        type: 'note',
        actor,
        title: title(`${actor.label} wrote a note`),
        body: body(comment.body),
        link: null,
      });
    }
  }

  // Oldest first; a stable sort keeps each run's own order for equal times.
  const ordered = items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => (a.item.at < b.item.at ? -1 : a.item.at > b.item.at ? 1 : a.i - b.i))
    .map((x) => x.item);
  return { ticketId: input.ticketId, items: ordered };
}
