// Contract tests for approval modes, the review loop and the ticket branch (ADR-0021, RL-0).
// Synthetic data only.
import { describe, expect, it } from 'vitest';
import {
  APPROVAL_MODES,
  AgentRunSchema,
  AgentRunStatusSchema,
  AllowRuleSchema,
  CHANGE_DECISION_TOOL_NAMES,
  CHANGE_REVIEWER_TOOL_NAMES,
  CONTROL_TOOL_LABELS,
  ChangeStateSchema,
  CheckRunSchema,
  CommandPatternSchema,
  CommandTokenSchema,
  DEFAULT_APPROVAL_MODE,
  DEFAULT_MAX_REWORK_ROUNDS,
  FINAL_CHANGE_STATES,
  FORBIDDEN_ALLOWLIST_COMMANDS,
  GIT_READ_ONLY_SUBCOMMANDS,
  GitCommitSchema,
  LEAD_TOOL_NAMES,
  LeadToolInputs,
  MAX_COMMAND_PATTERNS,
  ProjectAgentSetupSchema,
  ProjectApprovalsSchema,
  ProjectWorkflowSchema,
  REVIEW_LOOP_TOOL_NAMES,
  TicketBranchNameSchema,
  approvalsFromLegacy,
  approvalsOf,
  controlToolLabel,
  defaultProjectWorkflow,
  isForbiddenGitOption,
  isSafeCommandToken,
  reviewStageOf,
  stagesUsingAgent,
  stagesUsingSkill,
  ticketBranchName,
  type CommandPattern,
} from '../src/index.js';
import {
  ApprovalDtoSchema,
  ChangeReviewDtoSchema,
  ReviewActionRequestSchema,
  RunDetailDtoSchema,
  RunWorkflowDtoSchema,
  StartTicketRequestSchema,
  TicketBranchActionRequestSchema,
  TicketBranchDtoSchema,
  TicketBranchReviewDtoSchema,
  UpdateProjectSetupRequestSchema,
  UpdateWorkflowRequestSchema,
} from '../src/api/index.js';

const T = '2026-10-17T09:00:00.000Z';
const SHA = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);

const pattern = (argv: string[], match: 'exact' | 'prefix' = 'exact') =>
  CommandPatternSchema.safeParse({ argv, match });
const accepts = (argv: string[], match: 'exact' | 'prefix' = 'exact') =>
  pattern(argv, match).success;

describe('approval modes (ADR-0021 §1)', () => {
  it('are manual, auto edits, auto and full auto; new projects start on auto edits', () => {
    expect(APPROVAL_MODES).toEqual(['manual', 'auto-edits', 'auto', 'full-auto']);
    expect(DEFAULT_APPROVAL_MODE).toBe('auto-edits');
    expect(AllowRuleSchema.options).toEqual([
      'edit-in-own-worktree',
      'run-harness-check',
      'command-allowlist',
    ]);
  });

  it('maps a legacy allowlist without widening it: both on is auto edits, else manual', () => {
    expect(approvalsFromLegacy({ editInOwnWorktree: true, runHarnessChecks: true })).toEqual({
      mode: 'auto-edits',
      commands: [],
    });
    expect(approvalsFromLegacy({ editInOwnWorktree: true, runHarnessChecks: false })).toEqual({
      mode: 'manual',
      commands: [],
    });
    expect(approvalsFromLegacy({ editInOwnWorktree: false, runHarnessChecks: true })).toEqual({
      mode: 'manual',
      commands: [],
    });
    expect(approvalsFromLegacy({ editInOwnWorktree: false, runHarnessChecks: false })).toEqual({
      mode: 'manual',
      commands: [],
    });
  });

  it('approvalsOf prefers the stored approvals and falls back to the legacy mapping', () => {
    const allowlist = { editInOwnWorktree: true, runHarnessChecks: true };
    expect(approvalsOf({ allowlist })).toEqual({ mode: 'auto-edits', commands: [] });
    const own = { mode: 'auto' as const, commands: [{ argv: ['npm'], match: 'prefix' as const }] };
    expect(approvalsOf({ allowlist, approvals: own })).toBe(own);
    expect(approvalsOf({ allowlist, approvals: { mode: 'manual', commands: [] } }).mode).toBe(
      'manual',
    );
  });
});

describe('project setup with approvals', () => {
  const legacy = {
    projectId: 'p1',
    projectKey: 'WEB',
    planFirst: true,
    maxConcurrentHelpers: 3,
    maxDepth: 1,
    defaultBudgetTokensPerAgent: 500_000,
    model: null,
    allowlist: { editInOwnWorktree: true, runHarnessChecks: true },
    contextFiles: ['CLAUDE.md'],
    updatedAt: T,
  };

  it('still parses a setup stored before ADR-0021 (no approvals key)', () => {
    const parsed = ProjectAgentSetupSchema.parse(legacy);
    expect(parsed.approvals).toBeUndefined();
    expect(approvalsOf(parsed)).toEqual({ mode: 'auto-edits', commands: [] });
  });

  it('parses stored approvals and refuses invalid ones', () => {
    const approvals = {
      mode: 'auto',
      commands: [
        { argv: ['npm'], match: 'prefix' },
        { argv: ['git', 'status'], match: 'exact' },
      ],
    };
    expect(ProjectAgentSetupSchema.parse({ ...legacy, approvals }).approvals).toEqual(approvals);
    expect(
      ProjectAgentSetupSchema.safeParse({ ...legacy, approvals: { mode: 'yolo', commands: [] } })
        .success,
    ).toBe(false);
    expect(
      ProjectAgentSetupSchema.safeParse({
        ...legacy,
        approvals: { mode: 'auto', commands: [{ argv: ['bash'], match: 'prefix' }] },
      }).success,
    ).toBe(false);
  });

  it('the setup update request takes approvals optionally', () => {
    const { projectId: _p, planFirst: _f, updatedAt: _u, ...request } = legacy;
    expect(UpdateProjectSetupRequestSchema.safeParse(request).success).toBe(true);
    expect(
      UpdateProjectSetupRequestSchema.safeParse({
        ...request,
        approvals: { mode: 'manual', commands: [] },
      }).success,
    ).toBe(true);
    expect(
      UpdateProjectSetupRequestSchema.safeParse({
        ...request,
        approvals: { mode: 'auto', commands: [{ argv: ['curl'], match: 'prefix' }] },
      }).success,
    ).toBe(false);
  });

  it('RL-V: the legacy allowlist is optional in the setup update request', () => {
    const { projectId: _p, planFirst: _f, updatedAt: _u, allowlist: _a, ...rest } = legacy;
    expect(UpdateProjectSetupRequestSchema.safeParse(rest).success).toBe(true);
    expect(
      UpdateProjectSetupRequestSchema.safeParse({
        ...rest,
        approvals: { mode: 'auto-edits', commands: [] },
      }).success,
    ).toBe(true);
  });

  it('caps the allowlist and refuses duplicates', () => {
    const many: CommandPattern[] = Array.from({ length: MAX_COMMAND_PATTERNS + 1 }, (_, i) => ({
      argv: ['make', `target-${i}`],
      match: 'exact',
    }));
    expect(
      ProjectApprovalsSchema.safeParse({ mode: 'auto', commands: many.slice(0, -1) }).success,
    ).toBe(true);
    expect(ProjectApprovalsSchema.safeParse({ mode: 'auto', commands: many }).success).toBe(false);
    const dup = { argv: ['npm', 'test'], match: 'exact' };
    expect(ProjectApprovalsSchema.safeParse({ mode: 'auto', commands: [dup, dup] }).success).toBe(
      false,
    );
    // The same words as exact and as prefix are two different rules.
    expect(
      ProjectApprovalsSchema.safeParse({
        mode: 'auto',
        commands: [dup, { ...dup, match: 'prefix' }],
      }).success,
    ).toBe(true);
  });
});

describe('command tokens (ADR-0021 §2)', () => {
  it('accepts ordinary arguments', () => {
    for (const ok of [
      'test',
      '--watch=false',
      'src/app.ts',
      '@scope/pkg',
      'build:prod',
      '-Dskip=true',
      'a,b',
      '50%',
      'v1.2.3+meta',
      'x'.repeat(200),
    ]) {
      expect(CommandTokenSchema.safeParse(ok).success, ok).toBe(true);
      expect(isSafeCommandToken(ok), ok).toBe(true);
    }
  });

  it('refuses every shell metacharacter, whitespace and empty or long tokens', () => {
    const metas = [
      ';',
      '|',
      '&',
      '$',
      '`',
      '>',
      '<',
      '*',
      '?',
      '~',
      '"',
      "'",
      ' ',
      '\t',
      '\n',
      '\\',
      '(',
      ')',
      '{',
      '}',
      '[',
      ']',
      '!',
      '#',
      '^',
      '\0',
    ];
    for (const m of metas) {
      for (const token of [m, `a${m}b`, `${m}x`, `x${m}`]) {
        expect(CommandTokenSchema.safeParse(token).success, JSON.stringify(token)).toBe(false);
      }
    }
    expect(CommandTokenSchema.safeParse('').success).toBe(false);
    expect(CommandTokenSchema.safeParse('x'.repeat(201)).success).toBe(false);
  });

  it('refuses absolute paths, also after =, :, , or @, and .. anywhere', () => {
    for (const bad of [
      '/etc/passwd',
      '/',
      '--out=/etc/x',
      'file:/etc/x',
      'https://example.com',
      'a,/b',
      'pkg@/abs',
      '..',
      '../x',
      'a/../b',
      'x..y',
      '--dir=..',
    ]) {
      expect(CommandTokenSchema.safeParse(bad).success, bad).toBe(false);
      expect(isSafeCommandToken(bad), bad).toBe(false);
    }
  });

  it('fuzz: an accepted token is always shell-inert and inside the project', () => {
    // Deterministic PRNG (mulberry32) so the test never depends on chance.
    let seed = 0x5eed;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const alphabet = 'aZ09._/:=@+%,-;|&$`<>*?~"\' \t\n\\(){}[]!#^\0';
    let accepted = 0;
    for (let n = 0; n < 5000; n++) {
      const len = 1 + Math.floor(rand() * 12);
      let token = '';
      for (let i = 0; i < len; i++) token += alphabet[Math.floor(rand() * alphabet.length)] ?? '';
      if (!CommandTokenSchema.safeParse(token).success) continue;
      accepted++;
      expect(token).toMatch(/^[A-Za-z0-9._/:=@+%,-]{1,200}$/);
      expect(token).not.toContain('..');
      for (const part of token.split(/[=:,@]/)) expect(part.startsWith('/')).toBe(false);
    }
    // The generator does produce acceptable tokens, so the loop checked something.
    expect(accepted).toBeGreaterThan(50);
  });
});

describe('command patterns (ADR-0021 §2)', () => {
  it('accepts bare commands with exact or prefix match', () => {
    expect(accepts(['npm'], 'prefix')).toBe(true);
    expect(accepts(['mvn'], 'prefix')).toBe(true);
    expect(accepts(['mvn', '-q', 'test'])).toBe(true);
    expect(accepts(['make', 'build'])).toBe(true);
    expect(accepts(['pnpm', '--filter', '@acp/core', 'test'])).toBe(true);
    expect(accepts(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])).toBe(true);
  });

  it('refuses empty, too long, unknown match kinds and non-bare commands', () => {
    expect(accepts([])).toBe(false);
    expect(accepts(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'])).toBe(false);
    expect(CommandPatternSchema.safeParse({ argv: ['npm'], match: 'regex' }).success).toBe(false);
    expect(CommandPatternSchema.safeParse({ argv: ['npm'] }).success).toBe(false);
    for (const command of ['./gradlew', 'bin/run', '/usr/bin/npm', 'NPM', 'Make', '-rf', '.x']) {
      expect(accepts([command], 'prefix'), command).toBe(false);
    }
  });

  it('refuses every forbidden command as the first word', () => {
    expect(FORBIDDEN_ALLOWLIST_COMMANDS).toEqual(
      expect.arrayContaining([
        'sh',
        'bash',
        'zsh',
        'env',
        'sudo',
        'su',
        'doas',
        'xargs',
        'eval',
        'exec',
        'command',
        'builtin',
        'nohup',
        'timeout',
        'nice',
        'time',
        'watch',
        'cd',
        'export',
        'alias',
        'source',
        'set',
        'unset',
        'ssh',
        'scp',
        'rsync',
        'curl',
        'wget',
        'nc',
      ]),
    );
    for (const command of FORBIDDEN_ALLOWLIST_COMMANDS) {
      expect(accepts([command], 'prefix'), command).toBe(false);
      expect(accepts([command, 'x']), command).toBe(false);
    }
  });

  it('limits git to read-only subcommands', () => {
    expect(GIT_READ_ONLY_SUBCOMMANDS).toEqual([
      'status',
      'diff',
      'log',
      'show',
      'rev-parse',
      'ls-files',
      'blame',
      'grep',
    ]);
    for (const sub of GIT_READ_ONLY_SUBCOMMANDS) {
      expect(accepts(['git', sub]), sub).toBe(true);
      expect(accepts(['git', sub], 'prefix'), sub).toBe(true);
    }
    expect(accepts(['git'], 'prefix')).toBe(false);
    for (const sub of ['push', 'commit', 'reset', 'checkout', 'config', 'clean', 'am', 'apply']) {
      expect(accepts(['git', sub], 'prefix'), sub).toBe(false);
    }
  });

  it('refuses git options that change the repository, run programs or write files', () => {
    for (const argv of [
      ['git', '-C', 'x', 'status'],
      ['git', '-c', 'core.pager=x', 'log'],
      ['git', 'status', '-c'],
      ['git', 'log', '-C'],
      ['git', 'status', '--git-dir=x'],
      ['git', 'status', '--git-dir'],
      ['git', 'diff', '--work-tree=x'],
      ['git', 'log', '--exec-path=x'],
      ['git', 'log', '--config-env=a=b'],
      ['git', 'grep', '-Ofoo'],
      ['git', 'grep', '--open-files-in-pager=vi'],
      ['git', 'diff', '--ext-diff'],
      ['git', 'log', '--output=out.txt'],
    ]) {
      expect(accepts(argv), argv.join(' ')).toBe(false);
    }
    expect(isForbiddenGitOption('--outputs')).toBe(false);
    expect(isForbiddenGitOption('--oneline')).toBe(false);
    expect(accepts(['git', 'log', '--oneline'])).toBe(true);
    // Only git's options are special; `-c` means something else to other tools.
    expect(accepts(['gcc', '-c', 'main.c'])).toBe(true);
  });
});

describe('review stage (ADR-0021 §3)', () => {
  it('still parses a workflow stored before ADR-0021 and applies the defaults', () => {
    const stored = defaultProjectWorkflow('p1', T);
    expect(stored.stages.review).toEqual({ requireChecks: true });
    const wf = ProjectWorkflowSchema.parse(stored);
    expect(reviewStageOf(wf)).toEqual({
      reviewer: 'agent',
      maxReworkRounds: DEFAULT_MAX_REWORK_ROUNDS,
      model: null,
      skill: null,
      agent: null,
    });
    expect(DEFAULT_MAX_REWORK_ROUNDS).toBe(2);
  });

  it('takes a reviewer, rework rounds 0..5 and the review agent settings', () => {
    const base = defaultProjectWorkflow('p1', T);
    const review = {
      requireChecks: true,
      reviewer: 'lead',
      maxReworkRounds: 0,
      model: 'claude-opus-4',
      skill: 'code-review',
      agent: 'strict-reviewer',
    };
    const wf = ProjectWorkflowSchema.parse({ ...base, stages: { ...base.stages, review } });
    expect(reviewStageOf(wf)).toEqual({
      reviewer: 'lead',
      maxReworkRounds: 0,
      model: 'claude-opus-4',
      skill: 'code-review',
      agent: 'strict-reviewer',
    });
    const bad = (r: object) =>
      UpdateWorkflowRequestSchema.safeParse({
        plannerMode: 'lead',
        stages: { ...base.stages, review: { requireChecks: true, ...r } },
      }).success;
    expect(bad({ reviewer: 'agent', maxReworkRounds: 5 })).toBe(true);
    expect(bad({ maxReworkRounds: 6 })).toBe(false);
    expect(bad({ maxReworkRounds: -1 })).toBe(false);
    expect(bad({ maxReworkRounds: 1.5 })).toBe(false);
    expect(bad({ reviewer: 'owner' })).toBe(false);
    expect(bad({ skill: 'Bad Name' })).toBe(false);
  });

  it('counts the review stage in "used by" for skills and agent files', () => {
    const wf = defaultProjectWorkflow('p1', T);
    wf.stages.review = { requireChecks: true, skill: 'code-review', agent: 'strict-reviewer' };
    wf.stages['code-review'] = { enabled: true, model: null, skill: 'code-review' };
    wf.stages.helpers.agent = 'strict-reviewer';
    expect(stagesUsingSkill(wf, 'code-review')).toEqual(['review', 'code-review']);
    expect(stagesUsingAgent(wf, 'strict-reviewer')).toEqual(['helpers', 'review']);
  });
});

describe('agent status and change states', () => {
  it('adds AWAITING_REVIEW to the agent statuses', () => {
    expect(AgentRunStatusSchema.options).toContain('AWAITING_REVIEW');
    expect(
      AgentRunSchema.safeParse({
        id: 'a1',
        runId: 'r1',
        parentAgentRunId: 'lead',
        kind: 'worker',
        role: 'API builder',
        task: 'Build it',
        status: 'AWAITING_REVIEW',
        sessionId: null,
        budgetTokensUsed: 0,
        createdAt: T,
        endedAt: null,
      }).success,
    ).toBe(true);
  });

  it('has the nine change states; merged, discarded and no-changes are final', () => {
    expect(ChangeStateSchema.options).toEqual([
      'sealing',
      'ready',
      'reviewing',
      'decision',
      'rework',
      'needs-owner',
      'merged',
      'discarded',
      'no-changes',
    ]);
    expect([...FINAL_CHANGE_STATES]).toEqual(['merged', 'discarded', 'no-changes']);
  });
});

describe('review-loop tools (ADR-0021 §3)', () => {
  it('are lead tools, split into the lead change tools and the change reviewer tool', () => {
    expect([...CHANGE_DECISION_TOOL_NAMES]).toEqual([
      'view_change',
      'merge_change',
      'request_rework',
      'discard_change',
      'ask_owner',
    ]);
    expect([...CHANGE_REVIEWER_TOOL_NAMES]).toEqual(['submit_review']);
    expect([...REVIEW_LOOP_TOOL_NAMES]).toEqual([
      ...CHANGE_DECISION_TOOL_NAMES,
      ...CHANGE_REVIEWER_TOOL_NAMES,
    ]);
    for (const name of REVIEW_LOOP_TOOL_NAMES) expect(LEAD_TOOL_NAMES).toContain(name);
  });

  it('validate their inputs', () => {
    const t = LeadToolInputs;
    expect(t.view_change.safeParse({ agentId: 'a1' }).success).toBe(true);
    expect(t.view_change.safeParse({ agentId: '' }).success).toBe(false);
    expect(t.merge_change.safeParse({ agentId: 'a1' }).success).toBe(true);
    expect(t.merge_change.safeParse({}).success).toBe(false);

    expect(t.request_rework.safeParse({ agentId: 'a1', comments: 'Add a test.' }).success).toBe(
      true,
    );
    expect(t.request_rework.safeParse({ agentId: 'a1', comments: '  ' }).success).toBe(false);
    expect(t.request_rework.safeParse({ agentId: 'a1', comments: 'x'.repeat(4001) }).success).toBe(
      false,
    );

    expect(t.discard_change.safeParse({ agentId: 'a1', reason: 'Duplicate.' }).success).toBe(true);
    expect(t.discard_change.safeParse({ agentId: 'a1', reason: '' }).success).toBe(false);
    expect(t.discard_change.safeParse({ agentId: 'a1', reason: 'x'.repeat(501) }).success).toBe(
      false,
    );

    expect(t.ask_owner.safeParse({ agentId: 'a1', question: 'Keep both?' }).success).toBe(true);
    expect(t.ask_owner.safeParse({ agentId: 'a1', question: 'x'.repeat(2001) }).success).toBe(
      false,
    );

    expect(t.submit_review.safeParse({ verdict: 'approve', findings: 'Fine.' }).success).toBe(true);
    expect(
      t.submit_review.safeParse({ verdict: 'rework', findings: 'Missing test.' }).success,
    ).toBe(true);
    expect(t.submit_review.safeParse({ verdict: 'merge', findings: 'x' }).success).toBe(false);
    expect(t.submit_review.safeParse({ verdict: 'approve', findings: ' ' }).success).toBe(false);
    expect(
      t.submit_review.safeParse({ verdict: 'approve', findings: 'x'.repeat(8001) }).success,
    ).toBe(false);
  });
});

describe('control tool labels (ADR-0021 fix)', () => {
  it('cover every control-plane tool in plain words', () => {
    expect(Object.keys(CONTROL_TOOL_LABELS).sort()).toEqual([...LEAD_TOOL_NAMES].sort());
    for (const [name, label] of Object.entries(CONTROL_TOOL_LABELS)) {
      expect(label, name).toMatch(/^[A-Z][^_]*[a-z]$/);
      expect(label, name).not.toContain('mcp__');
      expect(label.length, name).toBeLessThanOrEqual(60);
    }
    expect(CONTROL_TOOL_LABELS.agent_status).toBe("Checked a helper's status");
  });

  it('look up bare names only, never prototype keys', () => {
    expect(controlToolLabel('merge_change')).toBe("Merged a helper's change");
    expect(controlToolLabel('mcp__acp__merge_change')).toBeNull();
    expect(controlToolLabel('toString')).toBeNull();
    expect(controlToolLabel('Bash')).toBeNull();
  });
});

describe('ticket branch (ADR-0021 §4)', () => {
  it('names the branch after the ticket key, with -r<n> when taken', () => {
    expect(ticketBranchName('WEB-12')).toBe('acp/WEB-12');
    expect(ticketBranchName('WEB-12', 0)).toBe('acp/WEB-12');
    expect(ticketBranchName('WEB-12', 2)).toBe('acp/WEB-12-r2');
    expect(() => ticketBranchName('web-12')).toThrow();
    expect(() => ticketBranchName('WEB-12', -1)).toThrow(RangeError);
    expect(() => ticketBranchName('WEB-12', 1.5)).toThrow(RangeError);
  });

  it('accepts only acp/<KEY> and acp/<KEY>-r<n>', () => {
    for (const ok of ['acp/WEB-12', 'acp/AB-1', 'acp/ABCDEF-999-r3']) {
      expect(TicketBranchNameSchema.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of [
      'main',
      'acp/web-12',
      'acp/WEB-0',
      'acp/WEB-12-r0',
      'acp/A-1',
      'acp/WEB-12/x',
      'acp/run-1/agent-2',
      'refs/heads/acp/WEB-12',
    ]) {
      expect(TicketBranchNameSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('commit ids are 7 to 64 lowercase hex digits', () => {
    expect(GitCommitSchema.safeParse('abc1234').success).toBe(true);
    expect(GitCommitSchema.safeParse(SHA).success).toBe(true);
    for (const bad of ['abc123', 'ABC1234', 'g'.repeat(40), 'a'.repeat(65), 'HEAD']) {
      expect(GitCommitSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('review-loop DTOs', () => {
  const branch = {
    runId: 'r1',
    branch: 'acp/WEB-12',
    baseBranch: 'main',
    baseCommit: SHA,
    headCommit: SHA2,
    state: 'open',
    mergedCommit: null,
    createdAt: T,
    updatedAt: T,
  };
  const check = {
    id: 'c1',
    runId: 'r1',
    agentRunId: 'a1',
    projectId: 'p1',
    checkId: 'test',
    name: 'Unit tests',
    required: true,
    status: 'passed',
    exitCode: 0,
    durationMs: 1200,
    outputTail: '',
    startedAt: T,
    commit: SHA2,
  };
  const change = {
    agentRunId: 'a1',
    role: 'API builder',
    state: 'decision',
    reworkRounds: 1,
    maxReworkRounds: 2,
    headCommit: SHA2,
    changedFiles: 3,
    conflictFiles: [],
    checks: [check],
    reviews: [
      {
        id: 'cr1',
        round: 0,
        reviewer: 'agent',
        reviewerAgentRunId: 'rev1',
        verdict: 'rework',
        decision: 'rework',
        decidedBy: 'lead',
        commentId: 'tc1',
        createdAt: T,
        decidedAt: T,
      },
      {
        id: 'cr2',
        round: 1,
        reviewer: 'agent',
        reviewerAgentRunId: 'rev2',
        verdict: 'approve',
        decision: null,
        decidedBy: null,
        commentId: 'tc2',
        createdAt: T,
        decidedAt: null,
      },
    ],
  };
  const run = {
    id: 'r1',
    projectId: 'p1',
    ticketId: 't1',
    title: 'Add rate limiting',
    status: 'RUNNING',
    agentCount: 1,
    pendingApprovals: 0,
    createdAt: T,
    updatedAt: T,
    endedAt: null,
    budget: { maxTokensPerAgent: 500_000, softCostUsdPerRun: null },
    agents: [],
    approvals: [],
    messages: [],
  };

  it('RL-V: the run detail carries the snapshotted reviewer and rework limit (optional)', () => {
    expect(RunDetailDtoSchema.parse(run).reviewer).toBeUndefined();
    const loop = RunDetailDtoSchema.parse({ ...run, reviewer: 'agent', maxReworkRounds: 2 });
    expect(loop).toMatchObject({ reviewer: 'agent', maxReworkRounds: 2 });
    expect(RunDetailDtoSchema.safeParse({ ...run, reviewer: 'owner' }).success).toBe(false);
    expect(RunDetailDtoSchema.safeParse({ ...run, maxReworkRounds: -1 }).success).toBe(false);
  });

  it('check runs record their commit; older check runs have none', () => {
    const { commit: _c, ...legacy } = check;
    expect(CheckRunSchema.parse(legacy).commit).toBeUndefined();
    expect(CheckRunSchema.parse(check).commit).toBe(SHA2);
    expect(CheckRunSchema.parse({ ...check, commit: null }).commit).toBeNull();
    expect(CheckRunSchema.safeParse({ ...check, commit: 'main' }).success).toBe(false);
  });

  it('parse a ticket branch, a change card and the final merge view', () => {
    expect(TicketBranchDtoSchema.parse(branch).branch).toBe('acp/WEB-12');
    expect(TicketBranchDtoSchema.safeParse({ ...branch, state: 'closed' }).success).toBe(false);
    expect(TicketBranchDtoSchema.safeParse({ ...branch, branch: 'main' }).success).toBe(false);
    expect(ChangeReviewDtoSchema.parse(change).reviews).toHaveLength(2);
    expect(ChangeReviewDtoSchema.safeParse({ ...change, state: 'approved' }).success).toBe(false);
    expect(
      ChangeReviewDtoSchema.safeParse({ ...change, conflictFiles: ['../outside'] }).success,
    ).toBe(false);
    expect(
      TicketBranchReviewDtoSchema.parse({
        runId: 'r1',
        ticketBranch: branch,
        files: [{ path: 'src/app.ts', status: 'modified', additions: 3, deletions: 1 }],
        diff: '',
        diffTruncated: false,
        checks: [{ ...check, agentRunId: null }],
        baseMoved: false,
      }).baseMoved,
    ).toBe(false);
  });

  it('a legacy run detail still parses; the new fields are optional', () => {
    const legacy = RunDetailDtoSchema.parse(run);
    expect(legacy.approvalMode).toBeUndefined();
    expect(legacy.ticketBranch).toBeUndefined();
    expect(legacy.changes).toBeUndefined();
    const loop = RunDetailDtoSchema.parse({
      ...run,
      approvalMode: 'auto-edits',
      ticketBranch: branch,
      changes: [change],
    });
    expect(loop.ticketBranch?.headCommit).toBe(SHA2);
    expect(RunDetailDtoSchema.parse({ ...run, ticketBranch: null }).ticketBranch).toBeNull();
    expect(RunDetailDtoSchema.safeParse({ ...run, approvalMode: 'yolo' }).success).toBe(false);
  });

  it('approvals carry the rule that allowed them, optionally', () => {
    const approval = {
      id: 'ap1',
      runId: 'r1',
      agentRunId: 'a1',
      kind: 'tool-use',
      toolName: 'Bash',
      summary: 'Bash npm test',
      status: 'approved',
      decidedBy: 'allowlist',
      requestedAt: T,
      decidedAt: T,
    };
    expect(ApprovalDtoSchema.parse(approval).allowRule).toBeUndefined();
    expect(ApprovalDtoSchema.parse({ ...approval, allowRule: 'command-allowlist' }).allowRule).toBe(
      'command-allowlist',
    );
    expect(ApprovalDtoSchema.parse({ ...approval, allowRule: null }).allowRule).toBeNull();
    expect(ApprovalDtoSchema.safeParse({ ...approval, allowRule: 'lead' }).success).toBe(false);
  });

  it('the owner can send a change back for rework, with a comment', () => {
    const r = (body: object) =>
      ReviewActionRequestSchema.safeParse({ agentRunId: 'a1', ...body }).success;
    expect(r({ action: 'merge' })).toBe(true);
    expect(r({ action: 'discard' })).toBe(true);
    expect(r({ action: 'merge-anyway', reason: 'Flaky.' })).toBe(true);
    expect(r({ action: 'merge-anyway' })).toBe(false);
    expect(r({ action: 'rework', comment: 'Add a test.' })).toBe(true);
    expect(r({ action: 'rework' })).toBe(false);
    expect(r({ action: 'rework', comment: '  ' })).toBe(false);
  });

  it('ticket-branch actions need a reason or a comment where they say so', () => {
    const r = (body: object) => TicketBranchActionRequestSchema.safeParse(body).success;
    expect(r({ action: 'merge' })).toBe(true);
    expect(r({ action: 'discard' })).toBe(true);
    expect(r({ action: 'update-from-base' })).toBe(true);
    expect(r({ action: 'merge-anyway', reason: 'Known flaky test.' })).toBe(true);
    expect(r({ action: 'merge-anyway' })).toBe(false);
    expect(r({ action: 'request-changes', comment: 'Rename the flag.' })).toBe(true);
    expect(r({ action: 'request-changes' })).toBe(false);
    expect(r({ action: 'push' })).toBe(false);
  });

  it('a ticket start may override the mode, reviewer and rounds', () => {
    expect(StartTicketRequestSchema.parse({})).toEqual({});
    expect(
      StartTicketRequestSchema.parse({
        approvalMode: 'manual',
        reviewer: 'lead',
        maxReworkRounds: 0,
      }),
    ).toEqual({ approvalMode: 'manual', reviewer: 'lead', maxReworkRounds: 0 });
    expect(StartTicketRequestSchema.safeParse({ approvalMode: 'yolo' }).success).toBe(false);
    expect(StartTicketRequestSchema.safeParse({ maxReworkRounds: 6 }).success).toBe(false);
    expect(StartTicketRequestSchema.safeParse({ reviewer: 'owner' }).success).toBe(false);
  });

  it('the run workflow may carry review counts', () => {
    const base = { runId: 'r1', stages: [{ stage: 'review', state: 'active', agentRunIds: [] }] };
    expect(RunWorkflowDtoSchema.parse(base).review).toBeUndefined();
    const review = {
      waiting: 1,
      inReview: 1,
      rework: 0,
      needsOwner: 0,
      merged: 2,
      discarded: 0,
      noChanges: 1,
      reworkRounds: 1,
    };
    expect(RunWorkflowDtoSchema.parse({ ...base, review }).review).toEqual(review);
    expect(
      RunWorkflowDtoSchema.safeParse({ ...base, review: { ...review, merged: -1 } }).success,
    ).toBe(false);
  });
});
