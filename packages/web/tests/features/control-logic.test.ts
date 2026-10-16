import { describe, expect, it } from 'vitest';
import {
  budgetView,
  buildAgentTree,
  canChat,
  closedByEngine,
  diffLines,
  isRunLive,
  splitApprovals,
  type AgentNode,
} from '../../src/features/control/run-state';
import { ApiError, controlPaths, createApiClient, sendChat, startRun } from '../../src/lib/api';
import { AGENT_STATUS_COPY, RUN_STATUS_COPY } from '../../src/lib/copy';
import { href, parseRoute } from '../../src/lib/router';
import { CSRF, LEAD_ID, agent, approval, builder, lead, tester } from '../fixtures/control';
import { fakeServer } from '../helpers';

const shape = (n: AgentNode): unknown => ({ id: n.agent.id, children: n.children.map(shape) });

describe('closedByEngine (a lead closed after good work reads "Finished")', () => {
  const T = '2026-10-15T09:45:00.000Z';
  const ended = { status: 'CANCELLED' as const, endedAt: T };
  const reviewer = { kind: 'reviewer' as const, createdAt: T };

  it('holds when the run completed in the same step', () => {
    expect(closedByEngine(ended, { status: 'COMPLETED', endedAt: T, agents: [] })).toBe(true);
  });

  it('holds when the reviewer or tester started in the same step', () => {
    expect(closedByEngine(ended, { status: 'REVIEW', endedAt: null, agents: [reviewer] })).toBe(
      true,
    );
    const tester = { kind: 'tester' as const, createdAt: T };
    expect(closedByEngine(ended, { status: 'COMPLETED', endedAt: 'x', agents: [tester] })).toBe(
      true,
    );
  });

  it('does not hold for an owner stop, a stopped run, a timeout or a live agent', () => {
    const earlier = { status: 'CANCELLED' as const, endedAt: '2026-10-15T09:40:00.000Z' };
    expect(closedByEngine(earlier, { status: 'REVIEW', endedAt: null, agents: [reviewer] })).toBe(
      false,
    );
    expect(closedByEngine(earlier, { status: 'COMPLETED', endedAt: T, agents: [] })).toBe(false);
    // Stop all: the run is CANCELLED, never COMPLETED.
    expect(closedByEngine(ended, { status: 'CANCELLED', endedAt: T, agents: [reviewer] })).toBe(
      false,
    );
    const timedOut = { status: 'TIMED_OUT' as const, endedAt: T };
    expect(closedByEngine(timedOut, { status: 'COMPLETED', endedAt: T, agents: [] })).toBe(false);
    const live = { status: 'RUNNING' as const, endedAt: null };
    expect(closedByEngine(live, { status: 'REVIEW', endedAt: null, agents: [reviewer] })).toBe(
      false,
    );
    // A helper starting at that instant is not a stage the engine closes the lead for.
    const helper = { kind: 'worker' as const, createdAt: T };
    expect(closedByEngine(ended, { status: 'REVIEW', endedAt: null, agents: [helper] })).toBe(
      false,
    );
  });
});

describe('buildAgentTree', () => {
  it('puts the lead on top and its helper agents beneath it in start order', () => {
    expect(buildAgentTree([tester, builder, lead]).map(shape)).toEqual([
      {
        id: LEAD_ID,
        children: [
          { id: builder.id, children: [] },
          { id: tester.id, children: [] },
        ],
      },
    ]);
  });

  it('shows an agent whose parent is missing on its own branch, never hides it', () => {
    const orphan = agent({ id: 'orphan', parentAgentRunId: 'gone' });
    const tree = buildAgentTree([orphan, lead]);
    expect(tree.map((n) => n.agent.id)).toEqual([LEAD_ID, 'orphan']);
  });

  it('survives a parent cycle, listing each agent once', () => {
    const a = agent({ id: 'a', parentAgentRunId: 'b' });
    const b = agent({ id: 'b', parentAgentRunId: 'a' });
    const ids = JSON.stringify(buildAgentTree([a, b]).map(shape));
    expect(ids.match(/"a"/g)).toHaveLength(1);
    expect(ids.match(/"b"/g)).toHaveLength(1);
  });
});

describe('budgetView', () => {
  it('fills, warns near the limit and reports the overshoot', () => {
    expect(budgetView({ used: 100, limit: 1000 })).toEqual({ percent: 10, over: 0, level: 'ok' });
    expect(budgetView({ used: 850, limit: 1000 }).level).toBe('near');
    expect(budgetView({ used: 1200, limit: 1000 })).toEqual({
      percent: 100,
      over: 200,
      level: 'over',
    });
    expect(budgetView({ used: 0, limit: 0 })).toEqual({ percent: 0, over: 0, level: 'ok' });
  });
});

describe('diffLines', () => {
  it('turns a diff header into a file heading and keeps +/- lines', () => {
    expect(
      diffLines(
        'diff --git a/x.ts b/x.ts\nindex 1..2 100644\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b\n\\ No newline at end of file\n',
      ),
    ).toEqual([
      { kind: 'file', text: 'x.ts' },
      { kind: 'hunk', text: '@@ -1 +1 @@' },
      { kind: 'del', text: '-a' },
      { kind: 'add', text: '+b' },
      { kind: 'meta', text: '\\ No newline at end of file' },
    ]);
    expect(diffLines('')).toEqual([]);
  });
});

describe('run rules and wording', () => {
  it('offers Stop all and chat only where they make sense', () => {
    expect(isRunLive('RUNNING')).toBe(true);
    expect(isRunLive('REVIEW')).toBe(false);
    expect(canChat('REVIEW')).toBe(true);
    expect(canChat('COMPLETED')).toBe(false);
    expect(canChat('CANCELLING')).toBe(false);
  });

  it('has words for every state and no "completed"', () => {
    for (const c of [...Object.values(RUN_STATUS_COPY), ...Object.values(AGENT_STATUS_COPY)]) {
      expect(c.word.length).toBeGreaterThan(0);
      expect(c.tip.length).toBeGreaterThan(0);
    }
    const words = [...Object.values(RUN_STATUS_COPY), ...Object.values(AGENT_STATUS_COPY)].map(
      (c) => `${c.word} ${c.tip}`,
    );
    expect(words.join(' ')).not.toMatch(/complete/i);
    expect(RUN_STATUS_COPY.COMPLETED.word).toBe('Finished — all changes reviewed');
  });

  it('splits waiting requests (oldest first) from answered ones (newest first)', () => {
    const r = splitApprovals([
      approval({ id: 'p2', requestedAt: '2026-10-11T09:03:00.000Z' }),
      approval({ id: 'd1', status: 'denied', requestedAt: '2026-10-11T09:00:00.000Z' }),
      approval({ id: 'p1', requestedAt: '2026-10-11T09:01:00.000Z' }),
      approval({ id: 'd2', status: 'expired', requestedAt: '2026-10-11T09:02:00.000Z' }),
    ]);
    expect(r.pending.map((a) => a.id)).toEqual(['p1', 'p2']);
    expect(r.decided.map((a) => a.id)).toEqual(['d2', 'd1']);
  });
});

describe('control routes and client', () => {
  it('parses #/control and #/control/:runId', () => {
    // Redesign (R-A): old control-panel addresses redirect (tests/app/redirects.test.ts).
    expect(parseRoute('#/control')).toEqual({
      name: 'legacy',
      legacy: { kind: 'control', runId: null },
    });
    expect(parseRoute(href.control('a/b'))).toEqual({
      name: 'legacy',
      legacy: { kind: 'control', runId: 'a/b' },
    });
    expect(parseRoute(href.run({ id: 'a/b', projectId: 'p 1' }))).toEqual({
      name: 'run',
      projectId: 'p 1',
      runId: 'a/b',
    });
    expect(parseRoute('#/control/a/b').name).toBe('not-found');
    expect(controlPaths.stopAgent('r 1', 'a/1')).toBe('/api/runs/r%201/agents/a%2F1/stop');
  });

  it('checks a request against its contract before sending it', async () => {
    const server = fakeServer({ '/api/control/token': { token: CSRF } });
    const client = createApiClient(server.fetch);
    await expect(sendChat(client, 'r', { text: '   ' })).rejects.toBeInstanceOf(ApiError);
    await expect(startRun(client, { projectId: '' })).rejects.toMatchObject({ kind: 'parse' });
    expect(server.calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it('fetches the CSRF token once per client', async () => {
    const server = fakeServer({
      '/api/control/token': { token: CSRF },
      'POST /api/runs/r/chat': () =>
        new Response(
          JSON.stringify({
            id: 'm',
            runId: 'r',
            role: 'owner',
            text: 'x',
            createdAt: '2026-10-11T09:00:00.000Z',
          }),
          { status: 201 },
        ),
    });
    const client = createApiClient(server.fetch);
    await sendChat(client, 'r', { text: 'x' });
    await sendChat(client, 'r', { text: 'x' });
    expect(server.calls.filter((c) => c.path === '/api/control/token')).toHaveLength(1);
  });
});
