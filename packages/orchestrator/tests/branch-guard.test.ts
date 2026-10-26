import type { ProjectApprovals } from '@acp/core';
import { describe, expect, it } from 'vitest';
import {
  AGENT_NOTE_LINE,
  BRANCH_RULE_LINE,
  PLAN_BRANCH_LINE,
  PLAN_BRANCH_REFUSAL,
  branchChangedLine,
  branchCommandIn,
  changeSealed,
  changeSummary,
  checkChangeAction,
  helperBrief,
  leadToolCall,
  planBranchCommand,
  recordChangeDecision,
  testerBrief,
  ticketLeadPrompt,
  ticketPlannerPrompt,
} from '../src/index.js';
import type { RunState } from '../src/index.js';
import { LEAD, REGISTERED, agentOf, event, makeCtx, ok, statusOf } from './helpers.js';
import {
  A,
  changeOf,
  createLoopRun,
  effectsOf,
  finishTurn,
  helper,
  leadMessages,
  leadTool,
  loopRunning,
} from './loop-helpers.js';

/**
 * F-1 (2026-10-24, ticket ACPGIT-3): the app owns branches and commits. Synthetic data only.
 */

describe('branchCommandIn: plan text that asks for a branch command', () => {
  it.each([
    ['Run `git fetch origin` then `git checkout -b feature/ACPGIT-3-branding dev`', 'git fetch'],
    ['`git checkout -b feature/x dev`', 'git checkout -b'],
    ['git switch -c feature/x', 'git switch -c'],
    ['Create it with git branch feature/ACPGIT-3 dev', 'git branch'],
    ['git branch -D old', 'git branch'],
    ['Then git commit -m "Brand colours"', 'git commit -m'],
    ['git commit the files', 'git commit'],
    ['Finish with git push origin HEAD', 'git push'],
    ['git reset --hard dev', 'git reset'],
    ['git rebase dev', 'git rebase'],
    ['git merge dev into the branch', 'git merge'],
    ['git stash the edits first', 'git stash'],
    ['git cherry-pick abc123', 'git cherry-pick'],
    ['git update-ref refs/heads/x abc', 'git update-ref'],
    ['git -C packages/web checkout dev', 'git checkout'],
    ['git -c user.name=x commit -m y', 'git commit -m'],
    ['git --no-pager pull', 'git pull'],
    ['(git checkout dev)', 'git checkout'],
    ['"git push"', 'git push'],
    ['git tag v1.0', 'git tag'],
    ['git worktree add ../x', 'git worktree add'],
  ])('%s → %s', (text, command) => {
    expect(branchCommandIn(text)).toBe(command);
  });

  it.each([
    'git status',
    'Check git status and git diff before editing',
    'read git log for the history',
    'git log --grep commit',
    'Use git show HEAD:README.md to compare',
    'git blame src/theme.ts',
    'git merge-base is not needed',
    'git branch',
    'git branch --show-current',
    'git branch -a',
    'the git branch is created by the app',
    'git tag -l',
    'Commit to the design system colours',
    'Merge the two lists into one',
    'Push the button styles into the theme',
    'Reset the form after submit',
    'Checkout page: add the branding header',
    'Switch the logo to the new SVG',
    'Rebase the layout on CSS grid',
    'Stash the old tokens in a comment',
    'Fetch the brand colours from tokens.json',
    'We use Git, not SVN.',
    'digit checkout of the column',
    '',
  ])('%s → allowed', (text) => {
    expect(branchCommandIn(text)).toBeNull();
  });

  it('checks every step title and detail', () => {
    expect(
      planBranchCommand([
        { title: 'Brand header', detail: 'Add the logo.' },
        { title: 'Save', detail: 'Run `git commit -am "Branding"`.' },
      ]),
    ).toEqual({ step: 'Save', command: 'git commit -am' });
    expect(planBranchCommand([{ title: 'git push origin', detail: '' }])).toEqual({
      step: 'git push origin',
      command: 'git push',
    });
    expect(planBranchCommand([{ title: 'Theme', detail: 'Check git diff.' }])).toBeNull();
  });
});

const BRANCHY_PLAN = {
  summary: 'Branding for ACPGIT-3.',
  steps: [
    {
      title: 'Prepare the branch',
      role: 'Frontend',
      detail:
        'Run `git fetch origin` then `git checkout -b feature/ACPGIT-3-branding dev`, then commit.',
    },
    { title: 'Brand header', role: 'Frontend', detail: 'Add the logo.' },
  ],
};

function submit(state: RunState, input: unknown) {
  return leadToolCall(
    state,
    { callerAgentRunId: LEAD, name: 'submit_plan', input, registeredProjectIds: REGISTERED },
    makeCtx(1500, 'p'),
  );
}

function planning(approvals?: ProjectApprovals): RunState {
  const s = ok(createLoopRun(approvals !== undefined ? { approvals } : {})).state;
  return ok(event(s, LEAD, { type: 'started', providerSessionId: 'sess-lead', model: null })).state;
}

describe('submit_plan refuses a step with a branch command', () => {
  it('owner-reviewed plan: refused with the plain message, nothing filed', () => {
    const s = planning();
    const r = submit(s, BRANCHY_PLAN);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.code).toBe('invalid-input');
    expect(r.refusal.message).toContain('Step "Prepare the branch"');
    expect(r.refusal.message).toContain('git fetch');
    expect(r.refusal.message).toContain(PLAN_BRANCH_REFUSAL);
    expect(s.plans ?? []).toHaveLength(0);
  });

  it('a Full auto run refuses it before the automatic approval too', () => {
    const s = planning({ mode: 'full-auto', commands: [] });
    const r = submit(s, BRANCHY_PLAN);
    expect(r.ok).toBe(false);
    expect(s.run.status).toBe('PLANNING');
    // Without the step, the same Full auto plan is approved automatically.
    const fixed = ok(submit(s, { ...BRANCHY_PLAN, steps: BRANCHY_PLAN.steps.slice(1) }));
    expect(fixed.state.run.status).toBe('RUNNING');
  });

  it('the same plan without the branch step is accepted', () => {
    const s = planning();
    const r = submit(s, { ...BRANCHY_PLAN, steps: BRANCHY_PLAN.steps.slice(1) });
    expect(r.ok).toBe(true);
  });
});

describe('the briefs tell agents that the app owns branches', () => {
  const ticket = {
    key: 'ACPGIT-3',
    title: 'Branding',
    type: 'chore' as const,
    priority: 'medium' as const,
    description: 'To start the work checkout a branch from dev.',
  };
  const limits = { maxConcurrentHelpers: 3, maxDepth: 1 };

  it('the lead and the planner get the planning line', () => {
    expect(ticketLeadPrompt(ticket, limits)).toContain(PLAN_BRANCH_LINE);
    expect(ticketLeadPrompt(ticket, limits, { fullAuto: true })).toContain(PLAN_BRANCH_LINE);
    expect(ticketPlannerPrompt(ticket, limits)).toContain(PLAN_BRANCH_LINE);
  });

  it('a helper brief is the task, the branch rule, then the note line', () => {
    expect(helperBrief('Build it', true)).toBe(
      `Build it\n\n${BRANCH_RULE_LINE}\n\n${AGENT_NOTE_LINE}`,
    );
    expect(helperBrief('Build it', false)).toBe(`Build it\n\n${BRANCH_RULE_LINE}`);
  });

  it('a started helper gets it; so does the tester', () => {
    const s = loopRunning();
    const r = ok(leadTool(s, 'start_agent', { role: 'API builder', task: 'Build the API' }, 'wa'));
    const start = effectsOf(r.effects, 'start-agent')[0];
    expect(start?.prompt).toBe(`Build the API\n\n${BRANCH_RULE_LINE}\n\n${AGENT_NOTE_LINE}`);
    expect(testerBrief(s)).toContain(BRANCH_RULE_LINE);
  });
});

describe('a helper that switched its folder to another branch (seal failure)', () => {
  function switched(): { state: RunState; lead: string[] } {
    let s = helper(loopRunning(), 'API builder', 'wa');
    s = ok(finishTurn(s, A)).state;
    const r = ok(
      changeSealed(
        s,
        A,
        { changed: true, headCommit: null, changedFiles: null, failure: 'branch-changed' },
        makeCtx(5000, 'rv'),
      ),
    );
    return { state: r.state, lead: leadMessages(r.effects) };
  }

  it('goes to the lead with a plain reason, not to the owner, and gets no reviewer', () => {
    const { state, lead } = switched();
    expect(changeOf(state, A)).toMatchObject({
      state: 'decision',
      sealFailure: 'branch-changed',
      headCommit: null,
    });
    expect(lead).toEqual([branchChangedLine('API builder', A)]);
    expect(lead[0]).toContain('switched its folder to another branch');
    expect(state.agents.filter((a) => a.kind === 'reviewer')).toHaveLength(0);
    expect(changeSummary(state, agentOf(state, A))).toContain('Not saved');
  });

  it('merge and rework are refused; the lead can discard it and start a fresh helper', () => {
    const { state } = switched();
    expect(checkChangeAction(state, A, 'merge', 'lead')?.message).toContain(
      'switched its folder to another branch',
    );
    expect(checkChangeAction(state, A, 'rework', 'lead')?.code).toBe('change-not-decidable');
    expect(checkChangeAction(state, A, 'merge-anyway', 'owner')?.code).toBe('change-not-decidable');
    expect(checkChangeAction(state, A, 'discard', 'lead')).toBeNull();
    const discarded = ok(
      leadTool(state, 'discard_change', { agentId: A, reason: 'Its folder left its branch.' }, 'd'),
    );
    expect(changeOf(discarded.state, A).state).toBe('discarded');
    expect(statusOf(discarded.state, A)).toBe('CANCELLED');
    expect(effectsOf(discarded.effects, 'discard-change')).toEqual([
      { type: 'discard-change', agentRunId: A },
    ]);
    // No loop: a fresh helper starts, and the lead can hand over once it is decided.
    const fresh = ok(
      leadTool(discarded.state, 'start_agent', { role: 'API builder', task: 'Again' }, 'wb'),
    );
    expect(statusOf(fresh.state, 'wb-1')).toBe('STARTING');
  });

  it('the owner can discard it as well', () => {
    const { state } = switched();
    const r = ok(
      recordChangeDecision(
        state,
        A,
        { decision: 'discard', by: 'owner', comments: 'Branch changed.' },
        makeCtx(9000),
      ),
    );
    expect(changeOf(r.state, A).state).toBe('discarded');
  });

  it('without a live lead it waits for the owner', () => {
    let s = helper(loopRunning(), 'API builder', 'wa');
    s = ok(finishTurn(s, A)).state;
    s = ok(
      event(s, LEAD, { type: 'finished', outcome: 'success', reportedCostUsd: null }, 4500),
    ).state;
    const r = changeSealed(
      s,
      A,
      { changed: true, headCommit: null, changedFiles: null, failure: 'branch-changed' },
      makeCtx(5000, 'rv'),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(changeOf(r.state, A).state).toBe('needs-owner');
    expect(leadMessages(r.effects)).toEqual([]);
  });
});
