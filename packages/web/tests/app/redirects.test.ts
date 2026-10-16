import { describe, expect, it } from 'vitest';
import { planRedirect, runTarget, type RedirectContext } from '../../src/app/redirects';
import { parseRoute, type LegacyRoute } from '../../src/lib/router';

function legacyOf(hash: string): LegacyRoute {
  const route = parseRoute(hash);
  if (route.name !== 'legacy') throw new Error(`${hash} is not a legacy route`);
  return route.legacy;
}

const withLast: RedirectContext = { lastProject: 'p-last', firstProject: 'p-first' };
const noLast: RedirectContext = { lastProject: null, firstProject: 'p-first' };
const none: RedirectContext = { lastProject: null, firstProject: null };

const go = (hash: string) => ({ kind: 'go', hash });
const plan = (hash: string, ctx: RedirectContext) => planRedirect(legacyOf(hash), ctx);

describe('old addresses redirect to their new home', () => {
  it('#/ opens the last project board, else All projects (never a guessed project)', () => {
    expect(plan('#/', withLast)).toEqual(go('#/p/p-last/board'));
    expect(plan('#/', noLast)).toEqual(go('#/projects'));
    expect(plan('', none)).toEqual(go('#/projects'));
  });

  it('#/board and #/board/:id', () => {
    expect(plan('#/board/p-9', withLast)).toEqual(go('#/p/p-9/board'));
    expect(plan('#/board', withLast)).toEqual(go('#/p/p-last/board'));
    expect(plan('#/board', noLast)).toEqual(go('#/p/p-first/board'));
    expect(plan('#/board', none)).toEqual(go('#/projects'));
  });

  it('#/projects/:id goes to the board; #/projects/:id/settings to Settings', () => {
    expect(plan('#/projects/p-9', none)).toEqual(go('#/p/p-9/board'));
    expect(plan('#/projects/p-9/settings', none)).toEqual(go('#/p/p-9/settings'));
  });

  it('#/usage and #/sessions keep their filters and move the project into the path', () => {
    expect(plan('#/usage?groupBy=day&projectId=p-9&range=7d', withLast)).toEqual(
      go('#/p/p-9/tokens?groupBy=day&range=7d'),
    );
    expect(plan('#/usage', withLast)).toEqual(go('#/p/p-last/tokens'));
    expect(plan('#/usage?groupBy=model', noLast)).toEqual(go('#/p/p-first/tokens?groupBy=model'));
    expect(plan('#/usage', none)).toEqual(go('#/projects'));
    expect(plan('#/sessions?status=stale&projectId=p-9', none)).toEqual(
      go('#/p/p-9/sessions?status=stale'),
    );
    expect(plan('#/sessions?root=s-1&view=graph', withLast)).toEqual(
      go('#/p/p-last/sessions?root=s-1&view=graph'),
    );
  });

  it('#/setup becomes Connection under Data health', () => {
    expect(plan('#/setup', none)).toEqual(go('#/health/connection'));
  });

  it('#/tickets/:id needs the ticket; #/control/:runId needs the run', () => {
    expect(plan('#/tickets/t-1', withLast)).toEqual({ kind: 'ticket', ticketId: 't-1' });
    expect(plan('#/control/r-1', withLast)).toEqual({ kind: 'run', runId: 'r-1' });
  });

  it('#/control opens the board; #/control/new the Phase 3 start page', () => {
    expect(plan('#/control', withLast)).toEqual(go('#/p/p-last/board'));
    expect(plan('#/control', none)).toEqual(go('#/projects'));
    expect(plan('#/control/new', noLast)).toEqual(go('#/p/p-first/runs/new'));
    expect(plan('#/control/new', none)).toEqual(go('#/projects'));
  });
});

describe('a run opens on its ticket when it has one', () => {
  const run = { id: 'r-1', projectId: 'p-1' };
  it('goes to the ticket whose current run it is', () => {
    const tickets = [
      { id: 't-0', projectId: 'p-1', currentRunId: 'r-0' },
      { id: 't-1', projectId: 'p-1', currentRunId: 'r-1' },
    ];
    expect(runTarget(run, tickets)).toBe('#/p/p-1/tickets/t-1');
  });

  it('otherwise (a Phase 3 run, or no board) goes to the run page', () => {
    expect(runTarget(run, [{ id: 't-0', projectId: 'p-1', currentRunId: null }])).toBe(
      '#/p/p-1/runs/r-1',
    );
    expect(runTarget(run, null)).toBe('#/p/p-1/runs/r-1');
  });
});
