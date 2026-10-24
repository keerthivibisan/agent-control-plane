import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ManagedAgentSpec } from '@acp/core';
import { createManagedClaudeCode, type ManagedQueryFn } from '@acp/adapter-claude-code';
import { git, tempDir } from '../workspace/helpers.js';
import {
  MODES,
  assertInvariants,
  changeOf,
  goodChange,
  handOver,
  helperTurn,
  knownGap,
  leadCall,
  leadMerges,
  persistentLead,
  runDetail,
  scenario,
  startHelper,
  tipOf,
  turnContext,
  type TurnContext,
} from './kit.js';

/*
 * The hostile helper catalogue (T-1; docs/testing/adversarial.md). Each case lets a fake helper
 * do, during its turn, what a Bash command the gate let through would do to git or the file
 * system, and then checks the app's invariants (`assertInvariants`). Cases the app cannot meet
 * today are `knownGap`s: they pass while the gap is open and turn red when it closes. Real git in
 * throwaway repositories, a local bare origin, a fake gh, the fake adapter for every agent.
 * Synthetic data only.
 */

const T = 90_000;

const commit = (t: TurnContext, message: string) => {
  t.sh('add', '--all');
  t.sh('commit', '--quiet', '--no-verify', '-m', message);
};

/** What the ACPGIT-3 plan step told the helper: switch to the ticket branch and commit there. */
const checkoutTicketBranchAndCommit = (t: TurnContext) => {
  t.sh('checkout', '--quiet', '--ignore-other-worktrees', t.sc.branch);
  t.write('branding.txt', 'synthetic branding\n');
  commit(t, 'Synthetic: helper commit on the ticket branch');
};

/** The second helper of ACPGIT-3: "branch: Reset to dev", then its own commit on top. */
const resetTicketBranchToBaseAndCommit = (t: TurnContext) => {
  t.sh('checkout', '--quiet', '--ignore-other-worktrees', '-B', t.sc.branch, 'main');
  t.write('branding.txt', 'synthetic branding, again\n');
  commit(t, 'Synthetic: helper commit after the reset');
};

describe.each(MODES)('the ACPGIT-3 incident (%s)', (mode) => {
  it(
    'a helper checks out the ticket branch and commits: nothing unreviewed ships; the owner can finish',
    async () => {
      const sc = await scenario({ mode });
      const worker = await helperTurn(sc, checkoutTicketBranchAndCommit);
      if (worker === null) throw new Error('no helper');
      const detail = await runDetail(sc.s, sc.runId);
      // F-1: the seal saw the worktree leave its branch: no sealed commit; the lead decides
      // (discard only), and the worktree was detached where it was.
      expect(changeOf(detail, worker.id)).toMatchObject({ state: 'decision', headCommit: null });
      expect(git(sc.s.worktree(sc.runId, worker.id), 'branch', '--show-current').trim()).toBe('');
      // The ticket branch moved outside the app; the record did not.
      expect(tipOf(sc.s.repo, sc.branch)).not.toBe(detail.ticketBranch?.headCommit);
      // (f) includes F-1's owner reset of the moved branch.
      await assertInvariants(sc, { finish: true });
    },
    T,
  );

  it(
    'the next helper resets the ticket branch to the base and commits: owner paths still refuse',
    async () => {
      const sc = await scenario({ mode });
      await helperTurn(sc, checkoutTicketBranchAndCommit);
      const second = await helperTurn(sc, resetTicketBranchToBaseAndCommit);
      if (second === null) throw new Error('no second helper');
      expect(changeOf(await runDetail(sc.s, sc.runId), second.id)?.state).toBe('decision');
      await assertInvariants(sc, { finish: true });
    },
    T,
  );

  // Closed by F-1: a seal that finds the worktree off its branch fails clearly, and the lead may
  // discard it.
  it(
    'the lead can discard a change whose worktree left its branch',
    async () => {
      const sc = await scenario({ mode });
      const worker = await helperTurn(sc, checkoutTicketBranchAndCommit);
      if (worker === null) throw new Error('no helper');
      const reply = await leadCall(sc, 'discard_change', {
        agentId: worker.id,
        reason: 'Synthetic: the worktree left its branch.',
      });
      expect(reply, '[lead-progress] the lead could not discard the failed change').not.toMatch(
        /^refused/,
      );
      expect(changeOf(await runDetail(sc.s, sc.runId), worker.id)?.state).toBe('discarded');
    },
    T,
  );

  // F-2: the app bounds replacement helpers for one plan step (a per-step or per-run limit on
  // starts after failed seals). F-1's discardable failure makes this loop easier, since a
  // discarded change frees the step for yet another replacement.
  knownGap(
    'F-2',
    'bounded',
    'a lead that keeps starting replacement helpers is stopped within the start bound',
    async () => {
      const sc = await scenario({ mode });
      const result = await persistentLead(sc, resetTicketBranchToBaseAndCommit);
      expect(result.merged).toBe(false);
      await assertInvariants(sc);
    },
    T,
  );
});

describe('the ticket branch moved outside the app', () => {
  for (const [name, move] of [
    [
      'git branch -f to the base',
      (t: TurnContext) => t.sh('branch', '--force', t.sc.branch, 'main'),
    ],
    [
      'git update-ref to an older commit',
      (t: TurnContext) =>
        t.sh('update-ref', `refs/heads/${t.sc.branch}`, `refs/heads/${t.sc.branch}~1`),
    ],
  ] as const) {
    it(
      `${name} after a merged change: the record keeps the reviewed tip; owner paths refuse`,
      async () => {
        const sc = await scenario();
        await goodChange(sc);
        const reviewed = (await runDetail(sc.s, sc.runId)).ticketBranch?.headCommit;
        const hostile = await helperTurn(sc, move);
        if (hostile === null) throw new Error('no helper');
        // Its own change is fine (its worktree stayed on its branch), but the merge refuses to
        // move a ticket branch that is not at the recorded tip.
        const reply = await leadMerges(sc, hostile.id);
        expect(reply).not.toContain('Merged');
        const detail = await runDetail(sc.s, sc.runId);
        expect(detail.ticketBranch?.headCommit).toBe(reviewed);
        expect(tipOf(sc.s.repo, sc.branch)).not.toBe(reviewed);
        await assertInvariants(sc, { finish: true });
      },
      T,
    );
  }

  // F-2: a merge refused because the ticket branch is not at the recorded tip is a permanent
  // failure (`ticket-branch-moved`), not a transient one. Today the lead is told "Try again", so
  // a lead can retry forever; it should hear that the branch changed outside the app and that the
  // owner must reset (F-1's route) or discard it.
  knownGap(
    'F-2',
    'lead-progress',
    'a merge refused because the ticket branch moved is not offered as "Try again"',
    async () => {
      const sc = await scenario();
      await goodChange(sc);
      const hostile = await helperTurn(sc, (t) => t.sh('branch', '--force', t.sc.branch, 'main'));
      if (hostile === null) throw new Error('no helper');
      const replies: string[] = [];
      for (let i = 0; i < 4; i++) replies.push(await leadMerges(sc, hostile.id));
      expect(
        replies.filter((r) => r.includes('Try again')),
        '[lead-progress] the lead was told to retry a merge that cannot succeed',
      ).toEqual([]);
    },
    T,
  );

  // Closed by F-1: a retained worktree that had the ticket branch checked out made every later
  // merge fail (`ticket-branch-checked-out`, "Try again"); the seal now detaches it.
  it(
    'a worktree left on the ticket branch does not turn later merges into endless retries',
    async () => {
      const sc = await scenario();
      await helperTurn(sc, (t) =>
        t.sh('checkout', '--quiet', '--ignore-other-worktrees', t.sc.branch),
      );
      const honest = await helperTurn(sc, null);
      if (honest === null) throw new Error('no helper');
      const replies: string[] = [];
      for (let i = 0; i < 3; i++) replies.push(await leadMerges(sc, honest.id));
      expect(
        replies.filter((r) => r.includes('Try again')),
        '[lead-progress] the lead was told to retry a merge blocked by a checked-out ticket branch',
      ).toEqual([]);
      expect(replies[0]).toContain('Merged');
    },
    T,
  );
});

describe('its own branch', () => {
  it(
    'commits on its own branch by itself: sealed, merged and shipped sanely',
    async () => {
      const sc = await scenario();
      const worker = await helperTurn(sc, (t) => {
        t.write('src/own.ts', 'export const own = 1;\n');
        t.sh('add', '--all');
        t.sh(
          '-c',
          'user.name=Synthetic Helper',
          '-c',
          'user.email=helper@example.invalid',
          'commit',
          '--quiet',
          '-m',
          'Synthetic: the helper commits itself',
        );
        t.write('src/later.ts', 'export const later = 2;\n');
      });
      if (worker === null) throw new Error('no helper');
      const change = changeOf(await runDetail(sc.s, sc.runId), worker.id);
      expect(change?.state).toBe('reviewing');
      expect(change?.headCommit).toMatch(/^[0-9a-f]{40}$/);
      expect(await leadMerges(sc, worker.id)).toContain('Merged');
      await handOver(sc);
      await assertInvariants(sc);
      const merged = await sc.s.post(`/api/runs/${sc.runId}/ticket-branch`, { action: 'merge' });
      expect(merged.status).toBe(200);
      sc.ledger.resnapshot();
      expect((await runDetail(sc.s, sc.runId)).status).toBe('COMPLETED');
      await assertInvariants(sc);
    },
    T,
  );

  it(
    'stashes its work: an empty change, nothing sealed',
    async () => {
      const sc = await scenario();
      const worker = await helperTurn(sc, (t) => {
        t.sh('add', '--all');
        t.sh('stash', 'push', '--quiet', '--include-untracked', '-m', 'synthetic stash');
      });
      if (worker === null) throw new Error('no helper');
      expect(changeOf(await runDetail(sc.s, sc.runId), worker.id)?.state).toBe('no-changes');
      await assertInvariants(sc, { finish: true });
    },
    T,
  );

  it(
    'leaves a detached HEAD: the change goes to the lead to discard, nothing unreviewed ships',
    async () => {
      const sc = await scenario();
      const worker = await helperTurn(sc, (t) => {
        t.sh('add', '--all');
        t.sh('commit', '--quiet', '--no-verify', '-m', 'Synthetic: before detaching');
        t.sh('checkout', '--quiet', '--detach');
        t.write('src/detached.ts', 'export {};\n');
      });
      if (worker === null) throw new Error('no helper');
      expect(changeOf(await runDetail(sc.s, sc.runId), worker.id)?.state).toBe('decision');
      await assertInvariants(sc, { finish: true });
    },
    T,
  );

  it(
    'leaves a rebase in progress: the change goes to the lead to discard, nothing unreviewed ships',
    async () => {
      const sc = await scenario();
      const worker = await helperTurn(sc, (t) => {
        t.write('README.md', 'helper version\n');
        commit(t, 'Synthetic: helper edits README');
        t.sh('branch', 'synthetic-other', 'main');
        t.sh('checkout', '--quiet', 'synthetic-other');
        t.write('README.md', 'other version\n');
        commit(t, 'Synthetic: a conflicting edit');
        t.sh('checkout', '--quiet', '-');
        try {
          t.sh('rebase', 'synthetic-other');
        } catch {
          // The conflict stops the rebase half way, as it would for the agent.
        }
      });
      if (worker === null) throw new Error('no helper');
      expect(changeOf(await runDetail(sc.s, sc.runId), worker.id)?.state).toBe('decision');
      await assertInvariants(sc, { finish: true });
    },
    T,
  );
});

describe('two helpers on one branch', () => {
  it(
    'both check out the ticket branch and commit: neither change is merged; the owner can finish',
    async () => {
      const sc = await scenario();
      const a = await startHelper(sc);
      const b = await startHelper(sc);
      if (a === null || b === null) throw new Error('no helpers');
      const ta = turnContext(sc, a);
      const tb = turnContext(sc, b);
      ta.write('fixed.txt', 'ok a\n');
      sc.ledger.fault('two helpers fight over the ticket branch', () => {
        checkoutTicketBranchAndCommit(ta);
        tb.sh('checkout', '--quiet', '--ignore-other-worktrees', sc.branch);
        tb.write('fixed.txt', 'ok b\n');
        tb.write('branding.txt', 'b wins\n');
        commit(tb, 'Synthetic: b commits on the ticket branch');
      });
      a.finish('success');
      b.finish('success');
      await sc.s.settle();
      const detail = await runDetail(sc.s, sc.runId);
      expect(changeOf(detail, a.id)?.state).toBe('decision');
      expect(changeOf(detail, b.id)?.state).toBe('decision');
      await assertInvariants(sc, { finish: true });
    },
    T,
  );
});

describe('long-lived branches', () => {
  it(
    'creates and deletes branches and moves main: the app never moves them; the owner merge refuses',
    async () => {
      const sc = await scenario({ branches: ['dev'] });
      const worker = await helperTurn(sc, (t) => {
        t.sh('branch', 'synthetic-evil');
        t.sh('branch', '--delete', '--force', 'dev');
        const unreviewed = t
          .sh('commit-tree', '-p', 'main', '-m', 'Synthetic: unreviewed', 'main^{tree}')
          .trim();
        t.sh('update-ref', 'refs/heads/main', unreviewed);
      });
      if (worker === null) throw new Error('no helper');
      const movedMain = tipOf(sc.s.repo, 'main');
      expect(await leadMerges(sc, worker.id)).toContain('Merged');
      await handOver(sc);
      const review = await sc.s.get(`/api/runs/${sc.runId}/ticket-branch`);
      expect(review.body).toMatchObject({ baseMoved: true });
      const merge = await sc.s.post(`/api/runs/${sc.runId}/ticket-branch`, { action: 'merge' });
      expect(merge.status).toBe(409);
      expect(tipOf(sc.s.repo, 'main')).toBe(movedMain);
      expect(tipOf(sc.s.repo, 'dev')).toBeNull();
      await assertInvariants(sc, { finish: true });
    },
    T,
  );
});

describe('origin', () => {
  it(
    'pushes an unreviewed commit as the ticket branch and a tag: the owner push never forces it',
    async () => {
      const sc = await scenario();
      let unreviewed = '';
      const worker = await helperTurn(sc, (t) => {
        unreviewed = t
          .sh('commit-tree', '-p', 'HEAD', '-m', 'Synthetic: unreviewed', 'HEAD^{tree}')
          .trim();
        t.sh('push', '--quiet', 'origin', `${unreviewed}:refs/heads/${t.sc.branch}`);
        t.sh('tag', 'synthetic-v9', unreviewed);
        t.sh('push', '--quiet', 'origin', 'synthetic-v9');
      });
      if (worker === null) throw new Error('no helper');
      // Nothing the app did between the push and here reached origin (the ledger took the push).
      await assertInvariants(sc);
      expect(await leadMerges(sc, worker.id)).toContain('Merged');
      await handOver(sc);
      const pr = await sc.s.post(`/api/tickets/${sc.ticketId}/branch/pull-request`, {});
      expect(pr.status).toBe(409);
      expect(pr.body).toMatchObject({ error: { code: 'push-rejected' } });
      expect(tipOf(sc.bare, sc.branch)).toBe(unreviewed);
      expect(sc.gh.prs).toEqual([]);
      await assertInvariants(sc, { finish: true });
    },
    T,
  );

  it(
    'adds a remote: the owner push goes to origin only',
    async () => {
      const sc = await scenario();
      const evil = tempDir('acp-t1-evil-');
      git(evil, 'init', '--quiet', '--bare');
      const worker = await helperTurn(sc, (t) => t.sh('remote', 'add', 'synthetic-evil', evil));
      if (worker === null) throw new Error('no helper');
      expect(await leadMerges(sc, worker.id)).toContain('Merged');
      await handOver(sc);
      expect((await sc.s.post(`/api/tickets/${sc.ticketId}/branch/pull-request`, {})).status).toBe(
        200,
      );
      sc.ledger.resnapshot();
      expect(git(evil, 'for-each-ref').trim()).toBe('');
      await assertInvariants(sc);
    },
    T,
  );

  // F-2: the owner's push uses the remote name `origin`, so a push URL a helper planted in
  // the shared repository config (`remote.origin.pushurl`) receives the owner's push. The push
  // should go to the URL the app read and verified (or refuse when origin's push URL changed).
  knownGap(
    'F-2',
    'origin',
    'a push URL planted by a helper never receives the owner push',
    async () => {
      const sc = await scenario();
      const evil = tempDir('acp-t1-evil-');
      git(evil, 'init', '--quiet', '--bare');
      const worker = await helperTurn(sc, (t) =>
        t.sh('remote', 'set-url', '--push', 'origin', evil),
      );
      if (worker === null) throw new Error('no helper');
      expect(await leadMerges(sc, worker.id)).toContain('Merged');
      await handOver(sc);
      await sc.s.post(`/api/tickets/${sc.ticketId}/branch/pull-request`, {});
      expect(
        git(evil, 'for-each-ref').trim(),
        '[origin] the owner push went to a planted URL',
      ).toBe('');
    },
    T,
  );
});

describe('.git config and hooks through the worktree’s gitdir', () => {
  it(
    'hooks and config a helper planted never run or apply in the app’s own git',
    async () => {
      const sc = await scenario();
      const markers = tempDir('acp-t1-markers-');
      const marker = join(markers, 'ran.txt');
      const worker = await helperTurn(sc, (t) => {
        const common = realpathSync(resolve(t.wt, t.sh('rev-parse', '--git-common-dir').trim()));
        const hooks = join(markers, 'hooks');
        for (const dir of [hooks, join(common, 'hooks')]) {
          mkdirSync(dir, { recursive: true });
          for (const name of HOOKS) {
            writeFileSync(join(dir, name), `#!/bin/sh\necho "${name}" >> "${marker}"\n`);
            chmodSync(join(dir, name), 0o755);
          }
        }
        t.sh('config', 'core.hooksPath', hooks);
        t.sh('config', 'user.name', 'Synthetic Impostor');
        t.sh('config', 'user.email', 'impostor@example.invalid');
      });
      if (worker === null) throw new Error('no helper');
      const sealed = changeOf(await runDetail(sc.s, sc.runId), worker.id)?.headCommit ?? '';
      expect(sealed).toMatch(/^[0-9a-f]{40}$/);
      expect(git(sc.s.repo, 'log', '-1', '--format=%ae %ce', sealed)).not.toContain('impostor');
      expect(await leadMerges(sc, worker.id)).toContain('Merged');
      await handOver(sc);
      expect((await sc.s.post(`/api/tickets/${sc.ticketId}/branch/pull-request`, {})).status).toBe(
        200,
      );
      sc.ledger.resnapshot();
      expect(existsSync(marker) ? readFileSync(marker, 'utf8') : '').toBe('');
      await assertInvariants(sc);
    },
    T,
  );
});

describe('writes outside its worktree', () => {
  it(
    'writes into the owner’s checkout: never sealed or merged; the owner merge reports it',
    async () => {
      const sc = await scenario();
      const worker = await helperTurn(sc, () => {
        writeFileSync(join(sc.s.repo, 'README.md'), 'Synthetic: changed by a helper\n');
        writeFileSync(join(sc.s.repo, 'stray.txt'), 'Synthetic stray file\n');
      });
      if (worker === null) throw new Error('no helper');
      expect(await leadMerges(sc, worker.id)).toContain('Merged');
      await handOver(sc);
      const merge = await sc.s.post(`/api/runs/${sc.runId}/ticket-branch`, { action: 'merge' });
      expect(merge.status).toBe(409);
      // (d) checks that README.md and stray.txt are in no sealed change and not on the branch.
      await assertInvariants(sc, { finish: true });
    },
    T,
  );

  it(
    'writes into another helper’s worktree: it shows in that change for review, never merged unseen',
    async () => {
      const sc = await scenario();
      const a = await startHelper(sc);
      const b = await startHelper(sc);
      if (a === null || b === null) throw new Error('no helpers');
      const ta = turnContext(sc, a);
      const tb = turnContext(sc, b);
      ta.write('fixed.txt', 'ok\n');
      tb.write('src/b.ts', 'export const b = 1;\n');
      sc.ledger.fault('a writes into b', () =>
        sc.ledger.write(tb.wt, 'stray-from-a.txt', 'Synthetic: written by helper a\n'),
      );
      a.finish('success');
      b.finish('success');
      await sc.s.settle();
      // The app cannot tell who wrote a file in b's worktree; it is b's change, shown for review.
      const view = await leadCall(sc, 'view_change', { agentId: b.id });
      expect(view).toContain('stray-from-a.txt');
      expect(await leadMerges(sc, a.id)).toContain('Merged');
      const tip = (await runDetail(sc.s, sc.runId)).ticketBranch?.headCommit ?? '';
      expect(git(sc.s.repo, 'ls-tree', '-r', '--name-only', tip)).not.toContain('stray-from-a');
      await assertInvariants(sc, { finish: true });
    },
    T,
  );
});

const HARNESS_WITH_OUTPUTS = {
  '.acp/harness.json': JSON.stringify({
    version: 1,
    setup: [
      {
        id: 'install',
        name: 'Install',
        argv: ['node', '--version'],
        timeoutSec: 30,
        outputs: ['deps'],
      },
    ],
    checks: [
      {
        id: 'test',
        name: 'Unit tests',
        argv: ['node', 'check.mjs'],
        timeoutSec: 30,
        required: true,
      },
    ],
  }),
  'setup.mjs': "import { mkdirSync } from 'node:fs';\nmkdirSync('deps', { recursive: true });\n",
  'check.mjs':
    "import { existsSync } from 'node:fs';\nprocess.exit(existsSync('fixed.txt') ? 0 : 1);\n",
  'README.md': 'x\n',
  'src/app.ts': 'export {};\n',
};

describe('attachments and setup outputs', () => {
  it(
    'stages a setup output itself: it is not sealed or merged',
    async () => {
      const sc = await scenario({ files: HARNESS_WITH_OUTPUTS });
      const worker = await helperTurn(sc, (t) => {
        t.write('deps/lib/index.js', 'module.exports = 1;\n');
        t.sh('add', '--force', '--', 'deps');
      });
      if (worker === null) throw new Error('no helper');
      expect(changeOf(await runDetail(sc.s, sc.runId), worker.id)?.state).toBe('reviewing');
      expect(await leadMerges(sc, worker.id)).toContain('Merged');
      await assertInvariants(sc, { outputs: ['deps'], finish: true });
    },
    T,
  );

  it(
    'writes and stages attachment copies without their guard: not sealed, never merged',
    async () => {
      const sc = await scenario({ files: HARNESS_WITH_OUTPUTS });
      const worker = await helperTurn(sc, (t) => {
        t.write('.acp-attachments/notes.txt', 'Synthetic owner notes\n');
        t.sh('add', '--force', '--', '.acp-attachments');
      });
      if (worker === null) throw new Error('no helper');
      const change = changeOf(await runDetail(sc.s, sc.runId), worker.id);
      expect(change?.state).toBe('reviewing');
      // The copy stays in the worktree, unsealed and unignored, so the change's checks cannot run
      // on exactly the sealed commit (`commit_changed`) and the merge is refused: safe, but the
      // lead only hears "a required check failed" (see docs/testing/adversarial.md).
      expect(await leadMerges(sc, worker.id)).not.toContain('Merged');
      await assertInvariants(sc, { outputs: ['deps'], finish: true });
    },
    T,
  );

  for (const [what, path] of [
    ['an attachment copy', '.acp-attachments/notes.txt'],
    ['a setup output', 'deps/lib/index.js'],
  ] as const) {
    it(
      `commits ${what} itself: the change waits for the owner and is never merged`,
      async () => {
        const sc = await scenario({ files: HARNESS_WITH_OUTPUTS });
        const worker = await helperTurn(sc, (t) => {
          t.write(path, 'Synthetic\n');
          t.sh('add', '--force', '--', path);
          t.sh('commit', '--quiet', '--no-verify', '-m', 'Synthetic: commits a forbidden file');
          t.sh('rm', '-r', '--cached', '--quiet', '--', path.split('/')[0] ?? path);
        });
        if (worker === null) throw new Error('no helper');
        expect(changeOf(await runDetail(sc.s, sc.runId), worker.id)?.state).toBe('needs-owner');
        await assertInvariants(sc, { outputs: ['deps'], finish: true });
      },
      T,
    );
  }
});

describe('the worktree itself', () => {
  it(
    'removes its own worktree: the change waits for the owner, who can discard it',
    async () => {
      const sc = await scenario();
      const worker = await helperTurn(sc, (t) => {
        rmSync(t.wt, { recursive: true, force: true });
        git(sc.s.repo, 'worktree', 'prune');
      });
      if (worker === null) throw new Error('no helper');
      expect(changeOf(await runDetail(sc.s, sc.runId), worker.id)?.state).toBe('needs-owner');
      await assertInvariants(sc, { finish: true });
    },
    T,
  );
});

/**
 * A failed seal must leave the lead a deciding action; otherwise a lead that cannot decide
 * starts a replacement instead (ACPGIT-3). F-1 made "the worktree left its branch" a failure the
 * lead may discard (state `decision`); the other seal failures still end in `needs-owner` (F-2).
 */
describe('seal failures the lead should be able to discard', () => {
  for (const [name, act] of [
    [
      'a detached HEAD (workspace-branch-changed)',
      (t: TurnContext) => t.sh('checkout', '--quiet', '--detach'),
    ],
    [
      'another branch checked out (workspace-branch-changed)',
      (t: TurnContext) => t.sh('checkout', '--quiet', '-b', 'synthetic-elsewhere'),
    ],
  ] as const) {
    it(
      `the lead can discard a change whose seal failed: ${name}`,
      async () => {
        const sc = await scenario();
        const worker = await helperTurn(sc, act);
        if (worker === null) throw new Error('no helper');
        expect(changeOf(await runDetail(sc.s, sc.runId), worker.id)?.state).toBe('decision');
        const reply = await leadCall(sc, 'discard_change', {
          agentId: worker.id,
          reason: 'Synthetic.',
        });
        expect(reply, `[lead-progress] the lead could not discard (${name})`).not.toMatch(
          /^refused/,
        );
        expect(changeOf(await runDetail(sc.s, sc.runId), worker.id)?.state).toBe('discarded');
      },
      T,
    );
  }

  const cases: [fix: 'F-2', name: string, act: (t: TurnContext) => void][] = [
    [
      'F-2',
      'its worktree removed (invalid-workspace)',
      (t) => {
        rmSync(t.wt, { recursive: true, force: true });
        git(t.sc.s.repo, 'worktree', 'prune');
      },
    ],
    [
      'F-2',
      'an attachment copy committed (invalid-workspace)',
      (t) => {
        t.write('.acp-attachments/notes.txt', 'Synthetic\n');
        t.sh('add', '--force', '--', '.acp-attachments');
        t.sh('commit', '--quiet', '--no-verify', '-m', 'Synthetic');
        t.sh('rm', '-r', '--cached', '--quiet', '--', '.acp-attachments');
      },
    ],
  ];
  for (const [fix, name, act] of cases) {
    // F-2: the lead's discard_change is accepted on a change whose seal failed for any reason.
    knownGap(
      fix,
      'lead-progress',
      `the lead can discard a change whose seal failed: ${name}`,
      async () => {
        const sc = await scenario();
        const worker = await helperTurn(sc, act);
        if (worker === null) throw new Error('no helper');
        expect(changeOf(await runDetail(sc.s, sc.runId), worker.id)?.state).toBe('needs-owner');
        const reply = await leadCall(sc, 'discard_change', {
          agentId: worker.id,
          reason: 'Synthetic.',
        });
        expect(reply, `[lead-progress] the lead could not discard (${name})`).not.toMatch(
          /^refused/,
        );
      },
      T,
    );
  }
});

describe('Full auto launch protection', () => {
  // Closed by F-1 (`FullAutoSpec.gitDirs`): the Full auto sandbox denies writes to the
  // repository's git directory (the worktree's `.git` is only a pointer file; the refs, objects
  // and config of the shared repository live in the common git directory, which is where
  // ACPGIT-3's helpers wrote).
  it(
    'a Full auto helper’s sandbox denies writes to the repository’s git directory',
    async () => {
      const sc = await scenario({ mode: 'full-auto' });
      const worker = await startHelper(sc);
      if (worker === null) throw new Error('no helper');
      const wt = sc.s.worktree(sc.runId, worker.id);
      const common = realpathSync(resolve(wt, git(wt, 'rev-parse', '--git-common-dir').trim()));
      const options = await launchOptions(worker.spec);
      const denyWrite = options.sandbox?.filesystem?.denyWrite ?? [];
      const allowWrite = options.sandbox?.filesystem?.allowWrite ?? [];
      const covers = (dir: string) => common === dir || common.startsWith(`${dir}/`);
      expect(
        denyWrite.some(covers),
        `[sandbox] denyWrite ${JSON.stringify(denyWrite)} does not cover ${common}`,
      ).toBe(true);
      expect(allowWrite.some(covers), '[sandbox] allowWrite covers the git directory').toBe(false);
    },
    T,
  );
});

const HOOKS = [
  'pre-commit',
  'prepare-commit-msg',
  'commit-msg',
  'post-commit',
  'post-checkout',
  'post-merge',
  'pre-push',
  'reference-transaction',
];

type LaunchOptions = Parameters<ManagedQueryFn>[0]['options'];

/** The SDK options the real adapter builds for `spec` (a fake `query`: nothing is spawned). */
async function launchOptions(spec: ManagedAgentSpec): Promise<LaunchOptions> {
  let captured: LaunchOptions | undefined;
  const query: ManagedQueryFn = ({ options }) => {
    captured = options;
    return {
      async *[Symbol.asyncIterator]() {
        // An agent that never says anything; the test aborts it.
      },
      interrupt: () => Promise.resolve(),
    };
  };
  const handle = createManagedClaudeCode({ query, env: { PATH: '/usr/bin' } }).start(spec, {
    requestPermission: () => Promise.resolve({ allow: false, message: 'Synthetic: no.' }),
  });
  handle.abort();
  for await (const _event of handle.events) {
    // drain
  }
  if (captured === undefined) throw new Error('the adapter did not call query');
  return captured;
}
