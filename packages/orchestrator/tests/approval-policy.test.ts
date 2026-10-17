import {
  FORBIDDEN_ALLOWLIST_COMMANDS,
  GIT_READ_ONLY_SUBCOMMANDS,
  isSafeCommandToken,
} from '@acp/core';
import type { AllowRule, ApprovalMode, CommandPattern, ProjectApprovals } from '@acp/core';
import { describe, expect, it } from 'vitest';
import {
  allowlistTarget,
  evaluateAllowlist,
  matchCommandAllowlist,
  requestPermission,
  ruleAllowedByMode,
} from '../src/index.js';
import type { AllowlistInput, AllowlistVerdict } from '../src/index.js';
import { LEAD, makeCtx, ok, statusOf } from './helpers.js';
import { A, helper, loopRunning } from './loop-helpers.js';

/** Approval modes and the command allowlist (ADR-0021 §1–2). Synthetic data only. */

const PATTERNS: CommandPattern[] = [
  { argv: ['npm'], match: 'prefix' },
  { argv: ['mvn', 'test'], match: 'exact' },
  { argv: ['git', 'status'], match: 'prefix' },
  { argv: ['make', 'lint'], match: 'exact' },
];

describe('ruleAllowedByMode', () => {
  const table: Record<ApprovalMode, Record<AllowRule, boolean>> = {
    manual: {
      'edit-in-own-worktree': false,
      'run-harness-check': false,
      'command-allowlist': false,
    },
    'auto-edits': {
      'edit-in-own-worktree': true,
      'run-harness-check': true,
      'command-allowlist': false,
    },
    auto: { 'edit-in-own-worktree': true, 'run-harness-check': true, 'command-allowlist': true },
    // ADR-0022: what still reaches the gate in Full auto was escalated by the classifier; only the
    // two narrow rules may allow it, never the command allowlist.
    'full-auto': {
      'edit-in-own-worktree': true,
      'run-harness-check': true,
      'command-allowlist': false,
    },
  };
  for (const [mode, rules] of Object.entries(table) as [
    ApprovalMode,
    Record<AllowRule, boolean>,
  ][]) {
    for (const [rule, allowed] of Object.entries(rules) as [AllowRule, boolean][]) {
      it(`${mode} ${allowed ? 'allows' : 'asks for'} ${rule}`, () => {
        expect(ruleAllowedByMode(mode, rule)).toBe(allowed);
      });
    }
  }
});

describe('evaluateAllowlist with a policy', () => {
  const base: Omit<AllowlistInput, 'target'> = {
    agentKind: 'worker',
    resolvedPath: '/repo/wt/src/a.ts',
    worktreeRoot: '/repo/wt',
    checks: [{ id: 'test', argv: ['npm', 'test'] }],
  };
  const edit = { kind: 'edit', toolName: 'Edit', path: 'src/a.ts' } as const;
  const bash = (command: string) => ({ kind: 'bash', command }) as const;
  const policy = (mode: ApprovalMode, commands = PATTERNS): ProjectApprovals => ({
    mode,
    commands,
  });
  const allowed = (v: AllowlistVerdict) => (v.allowed ? v.rule : null);

  it('manual asks for everything, harness checks included', () => {
    expect(
      allowed(evaluateAllowlist({ ...base, policy: policy('manual'), target: edit })),
    ).toBeNull();
    expect(
      allowed(evaluateAllowlist({ ...base, policy: policy('manual'), target: bash('npm test') })),
    ).toBeNull();
    expect(
      allowed(evaluateAllowlist({ ...base, policy: policy('manual'), target: bash('npm run x') })),
    ).toBeNull();
  });

  it('auto-edits allows own-worktree edits and exact harness checks, never the command list', () => {
    const p = policy('auto-edits');
    expect(allowed(evaluateAllowlist({ ...base, policy: p, target: edit }))).toBe(
      'edit-in-own-worktree',
    );
    expect(allowed(evaluateAllowlist({ ...base, policy: p, target: bash('npm test') }))).toBe(
      'run-harness-check',
    );
    expect(
      allowed(evaluateAllowlist({ ...base, policy: p, target: bash('npm run build') })),
    ).toBeNull();
    // Still never under .git or .claude, nor outside the worktree.
    for (const resolvedPath of [
      '/repo/wt/.git/config',
      '/repo/wt/.claude/x.md',
      '/repo/other.ts',
    ]) {
      expect(
        allowed(evaluateAllowlist({ ...base, resolvedPath, policy: p, target: edit })),
      ).toBeNull();
    }
  });

  it('auto adds the command allowlist and says which pattern matched', () => {
    const v = evaluateAllowlist({ ...base, policy: policy('auto'), target: bash('npm run build') });
    expect(v).toEqual({ allowed: true, rule: 'command-allowlist', pattern: PATTERNS[0] });
    expect(
      allowed(evaluateAllowlist({ ...base, policy: policy('auto'), target: bash('npm test') })),
    ).toBe('run-harness-check');
    expect(
      allowed(evaluateAllowlist({ ...base, policy: policy('auto'), target: bash('rm -rf src') })),
    ).toBeNull();
  });

  it('covers only helpers and the tester; the policy overrides the legacy switches', () => {
    for (const agentKind of ['lead', 'planner', 'reviewer'] as const) {
      expect(
        allowed(evaluateAllowlist({ ...base, agentKind, policy: policy('auto'), target: edit })),
      ).toBeNull();
    }
    expect(
      allowed(
        evaluateAllowlist({ ...base, agentKind: 'tester', policy: policy('auto'), target: edit }),
      ),
    ).toBe('edit-in-own-worktree');
    const legacyOn = { editInOwnWorktree: true, runHarnessChecks: true };
    expect(
      allowed(
        evaluateAllowlist({ ...base, allowlist: legacyOn, policy: policy('manual'), target: edit }),
      ),
    ).toBeNull();
    expect(allowed(evaluateAllowlist({ ...base, target: edit }))).toBeNull();
  });

  it('a background command is never covered', () => {
    expect(allowlistTarget('Bash', { command: 'npm test', run_in_background: true })).toBeNull();
    expect(
      allowed(evaluateAllowlist({ ...base, policy: policy('auto'), target: null })),
    ).toBeNull();
  });
});

describe('matchCommandAllowlist', () => {
  const match = (command: string, patterns: readonly CommandPattern[] = PATTERNS) =>
    matchCommandAllowlist(command, patterns);

  it('matches exact and prefix patterns word for word', () => {
    expect(match('npm')).toEqual(PATTERNS[0]);
    expect(match('npm test')).toEqual(PATTERNS[0]);
    expect(match('npm run build -- --watch=false')).toEqual(PATTERNS[0]);
    expect(match('mvn test')).toEqual(PATTERNS[1]);
    expect(match('mvn test -X')).toBeNull();
    expect(match('mvn')).toBeNull();
    expect(match('make lint')).toEqual(PATTERNS[3]);
    expect(match('make lint fix')).toBeNull();
    expect(match('git status')).toEqual(PATTERNS[2]);
    expect(match('git status --short')).toEqual(PATTERNS[2]);
    expect(match('npx test')).toBeNull();
    expect(match('npmx test')).toBeNull();
  });

  it('refuses every shell metacharacter, quote, glob and whitespace trick', () => {
    const specials = [
      ';',
      '|',
      '&',
      '$',
      '<',
      '>',
      '`',
      "'",
      '"',
      '\\',
      '*',
      '?',
      '~',
      '(',
      ')',
      '{',
      '}',
      '[',
      ']',
      '!',
      '#',
      '^',
      '\n',
      '\t',
      '\r',
      '\0',
      ' ',
    ];
    for (const ch of specials) {
      for (const command of [
        `npm test${ch}`,
        `npm ${ch}test`,
        `npm te${ch}st`,
        `${ch}npm test`,
        `npm${ch}test`,
      ]) {
        expect(match(command), JSON.stringify(command)).toBeNull();
      }
    }
    for (const command of [
      'npm test && rm -rf x',
      'npm test; ls',
      'npm $(id)',
      'npm test | sh',
      'npm  test',
      ' npm test',
      'npm test ',
      'npm test > out.txt',
      'npm test 2>&1',
      '',
    ]) {
      expect(match(command), JSON.stringify(command)).toBeNull();
    }
  });

  it('refuses absolute paths and .. anywhere in a token', () => {
    for (const command of [
      'npm /etc/passwd',
      'npm --prefix=/etc',
      'npm run x:/tmp',
      'npm a,/b',
      'npm a@/b',
      'npm ../x',
      'npm run ..',
      'npm a/../b',
      'npm ..',
    ]) {
      expect(match(command), command).toBeNull();
    }
    expect(match('npm run ./scripts/x')).toEqual(PATTERNS[0]);
  });

  it('keeps git read-only, with no -c, -C or other forbidden option', () => {
    const anyGit: CommandPattern[] = GIT_READ_ONLY_SUBCOMMANDS.map((sub) => ({
      argv: ['git', sub],
      match: 'prefix' as const,
    }));
    for (const sub of GIT_READ_ONLY_SUBCOMMANDS) expect(match(`git ${sub}`, anyGit)).not.toBeNull();
    for (const command of [
      'git -c core.pager=x status',
      'git status -c core.pager=x',
      'git -C repo status',
      'git status -C repo',
      'git status --git-dir=x',
      'git diff --work-tree=x',
      'git log --exec-path=x',
      'git log --config-env=a=b',
      'git log --output=out.txt',
      'git grep -Ocat x',
      'git grep --open-files-in-pager=x y',
      'git diff --ext-diff',
      'git push',
      'git commit -m x',
      'git config core.pager x',
      'git --paginate log',
    ]) {
      expect(match(command, anyGit), command).toBeNull();
    }
    // A stored pattern that no longer passes the schema never matches.
    expect(match('git push origin', [{ argv: ['git'], match: 'prefix' }])).toBeNull();
  });

  it('never matches a forbidden or non-bare command, even with a forged pattern', () => {
    for (const cmd of FORBIDDEN_ALLOWLIST_COMMANDS) {
      expect(match(`${cmd} npm test`, [{ argv: [cmd], match: 'prefix' }]), cmd).toBeNull();
    }
    for (const command of ['./npm test', 'NPM test', '/usr/bin/npm test', 'bin/npm test']) {
      expect(match(command, [{ argv: [command.split(' ')[0] ?? ''], match: 'prefix' }])).toBeNull();
    }
    expect(match(`npm ${'a'.repeat(4100)}`)).toBeNull();
  });

  it('fuzz: anything it matches is plain safe words of an allowed pattern', () => {
    // A small deterministic PRNG (no wall clock, no Math.random).
    let seed = 0x2021;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    const alphabet = 'npmgitstatusmvnlake -./=:@,;|&$<>`\'"\\*?~(){}\n\t#!_%+0';
    const words = ['npm', 'git', 'status', 'mvn', 'test', 'make', 'lint', '-c', '-C', '..', '/etc'];
    let matched = 0;
    for (let i = 0; i < 5000; i++) {
      const parts: string[] = [];
      const n = 1 + (next() % 5);
      for (let j = 0; j < n; j++) {
        if (next() % 2 === 0) parts.push(words[next() % words.length] ?? 'npm');
        else {
          let w = '';
          const len = next() % 6;
          for (let k = 0; k < len; k++) w += alphabet[next() % alphabet.length];
          parts.push(w);
        }
      }
      const command = parts.join(next() % 7 === 0 ? '  ' : ' ');
      const result = match(command);
      if (result === null) continue;
      matched++;
      const argv = command.split(' ');
      expect(/^[A-Za-z0-9._/:=@+%,-]+( [A-Za-z0-9._/:=@+%,-]+)*$/.test(command)).toBe(true);
      expect(argv.every(isSafeCommandToken)).toBe(true);
      expect(FORBIDDEN_ALLOWLIST_COMMANDS).not.toContain(argv[0]);
      expect(result.argv.every((w, idx) => argv[idx] === w)).toBe(true);
      if (argv[0] === 'git') {
        expect(argv).not.toContain('-c');
        expect(argv).not.toContain('-C');
      }
    }
    expect(matched).toBeGreaterThan(0);
  });
});

describe('requestPermission re-checks the run’s mode', () => {
  const req = { agentRunId: A, toolName: 'Bash', toolUseId: 't1', summary: 'npm run build' };
  const verdict = (rule: AllowRule): AllowlistVerdict => ({ allowed: true, rule });

  it('auto-approves a rule the mode allows and records it', () => {
    const s = helper(
      loopRunning({ approvals: { mode: 'auto', commands: PATTERNS } }),
      'API builder',
      'wa',
    );
    const r = ok(
      requestPermission(s, req, makeCtx(3500, 'al'), { allowlist: verdict('command-allowlist') }),
    );
    expect(r.value).toMatchObject({
      status: 'approved',
      decidedBy: 'allowlist',
      allowRule: 'command-allowlist',
    });
    expect(statusOf(r.state, A)).toBe('RUNNING');
  });

  it('asks when the verdict’s rule is not allowed by the mode', () => {
    const s = helper(
      loopRunning({ approvals: { mode: 'auto-edits', commands: PATTERNS } }),
      'API builder',
      'wa',
    );
    const r = ok(
      requestPermission(s, req, makeCtx(3500, 'al'), { allowlist: verdict('command-allowlist') }),
    );
    expect(r.value).toMatchObject({ status: 'pending' });
    expect(r.value).not.toHaveProperty('allowRule');
    expect(statusOf(r.state, A)).toBe('WAITING_APPROVAL');
    const edit = ok(
      requestPermission(s, { ...req, toolName: 'Edit' }, makeCtx(3500, 'ed'), {
        allowlist: verdict('edit-in-own-worktree'),
      }),
    );
    expect(edit.value).toMatchObject({ status: 'approved', allowRule: 'edit-in-own-worktree' });
    const manual = helper(
      loopRunning({ approvals: { mode: 'manual', commands: [] } }),
      'API builder',
      'wa',
    );
    const m = ok(
      requestPermission(manual, req, makeCtx(3500, 'al'), {
        allowlist: verdict('run-harness-check'),
      }),
    );
    expect(m.value.status).toBe('pending');
  });

  it('never pre-approves the lead, whatever the verdict', () => {
    const s = loopRunning({ approvals: { mode: 'auto', commands: PATTERNS } });
    const r = ok(
      requestPermission(s, { ...req, agentRunId: LEAD }, makeCtx(3500, 'al'), {
        allowlist: verdict('edit-in-own-worktree'),
      }),
    );
    expect(r.value.status).toBe('pending');
  });
});
