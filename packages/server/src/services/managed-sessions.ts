import type { SessionSummaryDto } from '@acp/core/api';
import {
  createOrchestrationRepositories,
  createReviewLoopRepositories,
  createWorkspaceRepositories,
  type AcpDatabase,
  type AgentRunSessionRow,
  type SessionRow,
} from '@acp/db';
import type { RunState } from '@acp/orchestrator';
import { agentName } from '../control/session-names.js';
import { createRunStore } from '../control/store.js';

export type ManagedSessionDto = NonNullable<SessionSummaryDto['managed']>;

/**
 * `SessionSummaryDto.managed` (ADR-0024 §2): which agent run of which run started a session, and
 * its name. A session is the app's when `agent_run_sessions` links its provider session to an
 * agent run (the managed adapter's `started` event). Only top-level sessions: a helper agent that
 * Claude Code itself started inside one (`providerAgentId`) is not an agent run. The label is the
 * one the session was titled with at launch (`agentName`): app data only.
 */
export interface ManagedSessionNames {
  /** By session row id; rows the app did not start are left out. */
  of(rows: readonly SessionRow[]): Map<string, ManagedSessionDto>;
}

export function createManagedSessionNames(deps: {
  db: AcpDatabase;
  now: () => Date;
}): ManagedSessionNames {
  const orch = createOrchestrationRepositories(deps.db, { now: deps.now });
  const workspace = createWorkspaceRepositories(deps.db, { now: deps.now });
  const loop = createReviewLoopRepositories(deps.db, { now: deps.now });
  const store = createRunStore({ db: deps.db, now: deps.now });

  /** One link per provider session: the primary one, else the first (a retry). */
  function linksBySession(rows: readonly SessionRow[]): Map<string, AgentRunSessionRow> {
    const byProvider = new Map<SessionRow['provider'], string[]>();
    for (const row of rows) {
      if (row.providerAgentId !== null) continue;
      const ids = byProvider.get(row.provider) ?? [];
      ids.push(row.providerSessionId);
      byProvider.set(row.provider, ids);
    }
    const out = new Map<string, AgentRunSessionRow>();
    for (const [provider, ids] of byProvider) {
      for (const link of orch.agentRunSessions.listForProviderSessions(provider, ids)) {
        const key = `${provider}\u0000${link.providerSessionId}`;
        const seen = out.get(key);
        if (seen === undefined || (seen.relation !== 'primary' && link.relation === 'primary')) {
          out.set(key, link);
        }
      }
    }
    return out;
  }

  return {
    of(rows) {
      const result = new Map<string, ManagedSessionDto>();
      const links = linksBySession(rows);
      if (links.size === 0) return result;
      // One load per run for the whole call (labels come from the run's workflow snapshot).
      const runs = new Map<
        string,
        { state: RunState; ticketKey: string | null; reviewed: Map<string, string> } | null
      >();
      const runOf = (runId: string) => {
        if (runs.has(runId)) return runs.get(runId) ?? null;
        const state = store.load(runId) ?? null;
        let entry = null;
        if (state !== null) {
          const ticketId = state.run.ticketId;
          const ticketKey =
            state.integration?.ticketKey ??
            (ticketId === null ? null : (workspace.tickets.getById(ticketId)?.key ?? null));
          // A change reviewer → the helper whose change it reviewed (ADR-0021 `change_reviews`).
          const reviewed = new Map<string, string>();
          if (state.integration !== undefined) {
            for (const r of loop.changeReviews.listForRun(runId)) {
              if (r.reviewerAgentRunId !== null) reviewed.set(r.reviewerAgentRunId, r.agentRunId);
            }
          }
          entry = { state, ticketKey, reviewed };
        }
        runs.set(runId, entry);
        return entry;
      };
      for (const row of rows) {
        if (row.providerAgentId !== null) continue;
        const link = links.get(`${row.provider}\u0000${row.providerSessionId}`);
        if (link === undefined) continue;
        const agentRun = orch.agentRuns.getById(link.agentRunId);
        if (agentRun === undefined) continue;
        const run = runOf(agentRun.runId);
        if (run === null) continue;
        const name = agentName({
          state: run.state,
          agentRunId: agentRun.id,
          ticketKey: run.ticketKey,
          reviewedAgentRunId: (id) => run.reviewed.get(id),
        });
        if (name === undefined) continue;
        result.set(row.id, {
          runId: agentRun.runId,
          agentRunId: agentRun.id,
          ticketKey: run.state.run.ticketId === null ? null : run.ticketKey,
          kind: agentRun.kind,
          label: name.label,
        });
      }
      return result;
    },
  };
}
