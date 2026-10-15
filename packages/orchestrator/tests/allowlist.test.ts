import { describe, expect, it } from 'vitest';
import {
  allowlistTarget,
  checkCommandLine,
  decidePlan,
  evaluateAllowlist,
  expireApprovals,
  decideApproval,
  isPathInside,
  leadToolCall,
  requestPermission,
} from '../src/index.js';
import type { AllowlistInput, RunState } from '../src/index.js';
import {
  LEAD,
  REGISTERED,
  event,
  makeCtx,
  ok,
  planningRun,
  statusOf,
  submitPlanFor,
} from './helpers.js';

/** Per-project allowlist (ADR-0013 amendment). Synthetic paths only. */

const ROOT = '/tmp/acp-test/worktrees/run-1/agent-1';
const CHECKS = [
  { id: 'test', argv: ['pnpm', 'test'] },
  { id: 'lint', argv: ['pnpm', 'run', 'lint', '--max-warnings=0'] },
  { id: 'quoted', argv: ['npm', 'run', 'a b'] },
];

const base = (over: Partial<AllowlistInput>): AllowlistInput => ({
  allowlist: { editInOwnWorktree: true, runHarnessChecks: true },
  agentKind: 'worker',
  target: null,
  resolvedPath: null,
  worktreeRoot: ROOT,
  checks: CHECKS,
  ...over,
});

const edit = (resolvedPath: string | null, over: Partial<AllowlistInput> = {}) =>
  evaluateAllowlist(
    base({ target: { kind: 'edit', toolName: 'Edit', path: 'x' }, resolvedPath, ...over }),
  );
const bash = (command: string, over: Partial<AllowlistInput> = {}) =>
  evaluateAllowlist(base({ target: { kind: 'bash', command }, ...over }));

describe('allowlistTarget', () => {
  it('reads paths of edit tools and the Bash command; null for anything else', () => {
    expect(allowlistTarget('Edit', { file_path: '/a/b.ts', old_string: 'x' })).toEqual({
      kind: 'edit',
      toolName: 'Edit',
      path: '/a/b.ts',
    });
    expect(allowlistTarget('Write', { file_path: 'c.ts' })).toMatchObject({ path: 'c.ts' });
    expect(allowlistTarget('MultiEdit', { file_path: 'd.ts' })).toMatchObject({ path: 'd.ts' });
    expect(allowlistTarget('NotebookEdit', { notebook_path: 'n.ipynb' })).toMatchObject({
      path: 'n.ipynb',
    });
    expect(allowlistTarget('Bash', { command: 'pnpm test' })).toEqual({
      kind: 'bash',
      command: 'pnpm test',
    });
    expect(allowlistTarget('Bash', { command: 'pnpm test', run_in_background: true })).toBeNull();
    expect(allowlistTarget('Edit', { path: 'x' })).toBeNull();
    expect(allowlistTarget('Edit', null)).toBeNull();
    expect(allowlistTarget('WebFetch', { url: 'x' })).toBeNull();
  });
});

describe('isPathInside', () => {
  it('accepts paths strictly inside a normalised root', () => {
    expect(isPathInside(`${ROOT}/src/a.ts`, ROOT)).toBe(true);
    expect(isPathInside(`${ROOT}/src/a.ts`, `${ROOT}/`)).toBe(true);
  });
  it('rejects the root itself, siblings with a shared prefix, and non-normal paths', () => {
    expect(isPathInside(ROOT, ROOT)).toBe(false);
    expect(isPathInside(`${ROOT}-evil/a.ts`, ROOT)).toBe(false);
    expect(isPathInside(`${ROOT}/../agent-2/a.ts`, ROOT)).toBe(false);
    expect(isPathInside(`${ROOT}/./a.ts`, ROOT)).toBe(false);
    expect(isPathInside(`${ROOT}//a.ts`, ROOT)).toBe(false);
    expect(isPathInside('src/a.ts', ROOT)).toBe(false);
    expect(isPathInside(`${ROOT}\\a.ts`, ROOT)).toBe(false);
    expect(isPathInside(`${ROOT}/a\0.ts`, ROOT)).toBe(false);
    expect(isPathInside('/etc/passwd', '/')).toBe(false);
  });
});

describe('checkCommandLine', () => {
  it('joins safe tokens with single spaces; null when quoting or a shell would matter', () => {
    expect(checkCommandLine(['pnpm', 'test'])).toBe('pnpm test');
    expect(checkCommandLine(['npm', 'run', 'a b'])).toBeNull();
    expect(checkCommandLine(['pnpm', 'test;rm'])).toBeNull();
    expect(checkCommandLine(['pnpm', '$(x)'])).toBeNull();
    expect(checkCommandLine(['./run.sh'])).toBeNull();
    expect(checkCommandLine([])).toBeNull();
  });
});

describe('evaluateAllowlist: editInOwnWorktree', () => {
  it('allows an edit whose real path is inside the own worktree', () => {
    expect(edit(`${ROOT}/src/a.ts`)).toEqual({ allowed: true, rule: 'edit-in-own-worktree' });
  });
  it('asks when off, outside, unresolved, without a worktree, or for the lead', () => {
    expect(
      edit(`${ROOT}/a.ts`, { allowlist: { editInOwnWorktree: false, runHarnessChecks: true } })
        .allowed,
    ).toBe(false);
    expect(edit('/tmp/acp-test/repo/a.ts').allowed).toBe(false);
    expect(edit(null).allowed).toBe(false);
    expect(edit(`${ROOT}/a.ts`, { worktreeRoot: null }).allowed).toBe(false);
    expect(edit(`${ROOT}/a.ts`, { agentKind: 'lead' }).allowed).toBe(false);
  });
  it('always asks for git internals and Claude settings inside the worktree', () => {
    expect(edit(`${ROOT}/.git`).allowed).toBe(false);
    expect(edit(`${ROOT}/.git/config`).allowed).toBe(false);
    expect(edit(`${ROOT}/.claude/settings.json`).allowed).toBe(false);
    expect(edit(`${ROOT}/pkg/.git/hooks/x`).allowed).toBe(false);
    expect(edit(`${ROOT}/.github/workflows/ci.yml`).allowed).toBe(true);
  });
});

describe('evaluateAllowlist: runHarnessChecks', () => {
  it("allows a Bash command exactly equal to a check's command line", () => {
    expect(bash('pnpm test')).toEqual({
      allowed: true,
      rule: 'run-harness-check',
      checkId: 'test',
    });
    expect(bash('pnpm run lint --max-warnings=0')).toMatchObject({ checkId: 'lint' });
  });
  it('asks for anything that is not an exact match', () => {
    for (const c of [
      'pnpm  test',
      ' pnpm test',
      'pnpm test ',
      'pnpm test && rm -rf /',
      'pnpm test; ls',
      'pnpm test | cat',
      'pnpm test\n',
      'PNPM test',
      'npm run a b',
      "npm run 'a b'",
    ]) {
      expect(bash(c).allowed).toBe(false);
    }
  });
  it('asks when the rule is off, there are no checks, or the caller is the lead', () => {
    expect(
      bash('pnpm test', { allowlist: { editInOwnWorktree: true, runHarnessChecks: false } })
        .allowed,
    ).toBe(false);
    expect(bash('pnpm test', { checks: [] }).allowed).toBe(false);
    expect(bash('pnpm test', { agentKind: 'lead' }).allowed).toBe(false);
    expect(evaluateAllowlist(base({ target: null })).allowed).toBe(false);
  });
});

describe('requestPermission with an allowlist verdict', () => {
  function withHelper(): { state: RunState; id: string } {
    const { state, planId } = submitPlanFor(planningRun());
    let s = ok(decidePlan(state, planId, 'approve', makeCtx(2000))).state;
    s = ok(
      leadToolCall(
        s,
        {
          callerAgentRunId: LEAD,
          name: 'start_agent',
          input: { role: 'UI', task: 'Add the toggle' },
          registeredProjectIds: REGISTERED,
        },
        makeCtx(3000, 'w'),
      ),
    ).state;
    s = ok(event(s, 'w-1', { type: 'started', providerSessionId: 's-w', model: null })).state;
    return { state: s, id: 'w-1' };
  }
  const request = (agentRunId: string) => ({
    agentRunId,
    toolName: 'Edit',
    toolUseId: 'tu-1',
    summary: 'Edit src/a.ts',
  });
  const allowed = { allowed: true, rule: 'edit-in-own-worktree' } as const;

  it('records an approved approval decided by the allowlist and resolves it at once', () => {
    const { state, id } = withHelper();
    const r = ok(
      requestPermission(state, request(id), makeCtx(4000, 'ap'), { allowlist: allowed }),
    );
    expect(r.value).toMatchObject({
      id: 'ap-1',
      kind: 'tool-use',
      status: 'approved',
      decidedBy: 'allowlist',
      decidedAt: r.value.requestedAt,
    });
    expect(r.effects).toEqual([
      { type: 'resolve-permission', approvalId: 'ap-1', decision: { allow: true } },
    ]);
    expect(statusOf(r.state, id)).toBe('RUNNING');
    expect(r.state.run.status).toBe('RUNNING');
    // Nothing is left for the owner, and expiry ignores it.
    expect(ok(expireApprovals(r.state, makeCtx(10 ** 9))).value).toBe(0);
  });

  it('asks the owner for a deny verdict, and for the lead even with an allow verdict', () => {
    const { state, id } = withHelper();
    const asked = ok(
      requestPermission(state, request(id), makeCtx(4000, 'ap'), {
        allowlist: { allowed: false, reason: 'x' },
      }),
    );
    expect(asked.value).toMatchObject({ status: 'pending', decidedBy: null });
    expect(statusOf(asked.state, id)).toBe('WAITING_APPROVAL');
    const lead = ok(
      requestPermission(state, request(LEAD), makeCtx(4000, 'ap'), { allowlist: allowed }),
    );
    expect(lead.value.status).toBe('pending');
  });

  it('still refuses while planning, even when allowlisted', () => {
    const s = planningRun();
    const r = requestPermission(s, request(LEAD), makeCtx(1000), { allowlist: allowed });
    expect(r.ok).toBe(false);
  });

  it('records who decided: owner or timeout', () => {
    const { state, id } = withHelper();
    const asked = ok(requestPermission(state, request(id), makeCtx(4000, 'ap')));
    const byOwner = ok(decideApproval(asked.state, 'ap-1', 'approve', makeCtx(5000)));
    expect(byOwner.state.approvals[0]?.decidedBy).toBe('owner');
    const expired = ok(expireApprovals(asked.state, makeCtx(10 ** 9)));
    expect(expired.state.approvals[0]?.decidedBy).toBe('timeout');
  });
});
