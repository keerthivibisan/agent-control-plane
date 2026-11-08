// Synthetic temp git repo and the scripted fake adapter only (CX-2). Never the Agent SDK or Codex.
import { describe, expect, it } from 'vitest';
import type { ProjectAgentSetupDto, RunDetailDto } from '@acp/core/api';
import { createOrchestrationRepositories } from '@acp/db';
import { createRunStore } from '../../src/control/store.js';
import { BOARD_NOW, setupBoard } from '../board/helpers.js';

/*
 * ADR-0031 plumbing before the adapter registry (CX-4): the project's default provider round-trips
 * through the setup API, a ticket run's agents record the provider the engine resolved (the
 * node's, else the project's, else Claude Code) in `agent_runs.provider` and the agent DTO, and a
 * session is linked under the agent's provider. A run reloaded from the database keeps it.
 */

type Board = Awaited<ReturnType<typeof setupBoard>>;

async function setProvider(s: Board, provider: 'claude-code' | 'codex' | null | undefined) {
  const current = (await s.get(`/api/projects/${s.project.id}/setup`)).body as ProjectAgentSetupDto;
  const res = await s.send('put', `/api/projects/${s.project.id}/setup`, {
    projectKey: current.projectKey,
    maxConcurrentHelpers: current.maxConcurrentHelpers,
    maxDepth: current.maxDepth,
    defaultBudgetTokensPerAgent: current.defaultBudgetTokensPerAgent,
    model: null,
    contextFiles: [],
    ...(provider !== undefined && { provider }),
  });
  expect(res.status).toBe(200);
  return res.body as ProjectAgentSetupDto;
}

async function runOf(s: Board, ticketId: string): Promise<RunDetailDto> {
  const runId = (await s.detail(ticketId)).currentRun?.id ?? '';
  const res = await s.get(`/api/runs/${runId}`);
  expect(res.status).toBe(200);
  return res.body as RunDetailDto;
}

describe('managed provider plumbing (ADR-0031, CX-2)', () => {
  it('keeps, sets and removes the project default provider', async () => {
    const s = await setupBoard();
    expect(await setProvider(s, undefined)).not.toHaveProperty('provider');
    expect((await setProvider(s, 'codex')).provider).toBe('codex');
    // Absent keeps the stored value; null removes it.
    expect((await setProvider(s, undefined)).provider).toBe('codex');
    expect(await setProvider(s, null)).not.toHaveProperty('provider');
  });

  it('a project without a provider runs its agents on Claude Code, as before', async () => {
    const s = await setupBoard();
    const { ticket } = await s.startTicket();
    const run = await runOf(s, ticket.id);
    const lead = run.agents.find((a) => a.kind === 'lead');
    expect(lead?.provider).toBe('claude-code');
    const links = createOrchestrationRepositories(s.db).agentRunSessions.listForAgentRun(
      lead?.id ?? '',
    );
    expect(links.map((l) => l.provider)).toEqual(['claude-code']);
  });

  it('a Codex project default reaches the agent row, the DTO and a reload, and is never run on another provider', async () => {
    const s = await setupBoard();
    await setProvider(s, 'codex');
    // Not `startTicket`: it drives the lead, which never starts here.
    const ticket = await s.createTicket();
    expect((await s.post(`/api/tickets/${ticket.id}/move`, { status: 'READY' })).status).toBe(200);
    expect((await s.post(`/api/tickets/${ticket.id}/start`)).status).toBe(200);
    const run = await runOf(s, ticket.id);
    const lead = run.agents.find((a) => a.kind === 'lead');
    expect(lead?.provider).toBe('codex');
    const repos = createOrchestrationRepositories(s.db);
    expect(repos.agentRuns.getById(lead?.id ?? '')?.provider).toBe('codex');
    // The board's fake adapter is Claude Code's: the Codex lead is refused (provider-unavailable)
    // instead of running on Claude, so no session is ever linked for it.
    expect(repos.agentRunSessions.listForAgentRun(lead?.id ?? '')).toEqual([]);
    expect(lead?.status).toBe('FAILED');
    const loaded = createRunStore({ db: s.db, now: () => BOARD_NOW }).load(run.id);
    expect(loaded?.agents.find((a) => a.kind === 'lead')?.provider).toBe('codex');
    expect(loaded?.graphContext?.projectProvider).toBe('codex');
  });
});
