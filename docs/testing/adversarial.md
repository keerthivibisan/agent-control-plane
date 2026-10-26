# Adversarial safety tests

The ordinary tests assume agents behave. These tests make fake agents misbehave and check that the
app's guarantees still hold. They were added after the ACPGIT-3 incident (2026-10-24). In that
incident, Full auto helpers switched their worktrees to the ticket branch, committed there and
reset it, and the run looped (T-1, [docs/history/v0.3.0/wp/T-1.md](../history/v0.3.0/wp/T-1.md)).

Everything is synthetic. Git runs in throwaway repositories with a local bare `origin` and a fake
`gh`. The fake managed adapter plays every agent. The real `claude` and the owner's data are never
used.

## Where they are and what each file proves

| File                                                                       | Proves                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/server/tests/adversarial/kit.ts`                                 | The kit: scenarios (auto-edits or Full auto), the fault ledger, the persistent lead, `assertInvariants`, `knownGap`.                                                                                                                                     |
| `packages/server/tests/adversarial/hostile-helper.test.ts`                 | The app's invariants hold after a helper misbehaves in its worktree (real git, routes, fake adapter).                                                                                                                                                    |
| `packages/orchestrator/tests/adversarial/engine-loops.test.ts`             | At the state level, a failed seal and repeated merge failures end, and the deciders keep an action the engine accepts.                                                                                                                                   |
| `packages/orchestrator/tests/adversarial/sim-invariants.ts`                | Invariants added to the graph-correctness simulator: start bounds per agent and per run, lead progress and owner progress.                                                                                                                               |
| `packages/orchestrator/tests/adversarial/simulated.test.ts`                | Those invariants hold for every behaviour of every template (auto-edits and Full auto, with and without a planner) and of generated graphs.                                                                                                              |
| `packages/orchestrator/tests/adversarial/allowlist-commands.test.ts`       | The gate's own rules never auto-approve a hostile git command, even with the loosest allowlist.                                                                                                                                                          |
| `packages/adapters/claude-code/tests/managed/adversarial-commands.test.ts` | For each shell command in a table, what the adapter's own layers decide for a helper or tester in every mode. The layers are the PreToolUse hooks, the Bash deny rules, and `canUseTool` outside auto mode. Ordinary commands must still reach the gate. |

A misbehaviour is the test itself running git or file-system operations in the helper's worktree
during its turn. That is what a Bash command would do once the gate let it through. The server tests
do not ask whether the command would get through, because that is the adapter table's job. They
check what the app must still guarantee afterwards (defence in depth).

## The invariants (`assertInvariants`)

Each failure message starts with its tag. That is how a known gap names the invariant it expects
to break.

- **`[ticket-branch]`**: The ticket branch holds only commits the app recorded. If something
  outside the app moved it, every owner path refuses: Merge, Merge anyway, Push & open PR, and
  Merge pull request. In that case `main` and `origin` do not change, the run is not COMPLETED and
  the ticket is not Done.
- **`[base]`**: A long-lived branch, tag or the stash changes only through a recorded fault or the
  owner. Long-lived means everything outside `acp/`.
- **`[origin]`**: `origin` changes only through a recorded fault or the owner's push.
- **`[sealed]`**: Every sealed change, and the ticket branch, holds only files that were written
  into a worktree. They never hold attachment copies (`.acp-attachments`) or setup outputs.
- **`[bounded]`**: Helper starts stay at or below `plan steps × (1 + rework rounds) + 1`, and no
  helper is left running.
- **`[owner-progress]`** (with `finish: true`): The owner can discard every change that waits for
  them, and then end the run by discarding the ticket branch or stopping the run. A moved ticket
  branch is never merged on the way.
- **`[lead-progress]`**: The lead can decide a change that waits for it, and is not told to retry
  something that cannot succeed.
- **`[sandbox]`**, **`[guard]`** and **`[gate]`**: The launch protections and the command rules (see
  the tables).

The ledger takes each injected fault's ref changes as foreign, so `[base]` and `[origin]` check only
what the app did after the fault.

## Expected-failure policy: `knownGap`

A case the app cannot meet today is written as `knownGap(fix, tag, title, body)` instead of `it`.
`fix` names the work package expected to close it (there are none open since F-2). The wrapper
behaves like this:

- It **passes** while the body fails with a message carrying `[tag]`. That means the gap is still
  open, and it breaks the invariant the test names.
- It **fails** if the body passes. The message says the gap is closed: make it a plain `it()` and
  update this page. This forces the update when the fix merges (F-1 flipped 52 of them, F-2 the
  last 12).
- It **fails** if the body throws anything else, such as a broken setup or another invariant.
  `it.fails` would hide those, which is why the suite does not use it.

This keeps `pnpm check` green today. Assertions are never weakened. `ACP_SHOW_KNOWN_GAPS=1` prints
what each gap breaks. `ACP_T1_LOG=1` prints the app's structured log in the server suite (ids,
codes and counts only).

## Closed by F-1 (merged 2026-10-24, `10239df`)

52 known gaps flipped and are now plain tests with the same assertions:

- **Lead discard after a branch change (server ×4, engine ×1).** A seal that finds the worktree
  off its branch (`workspace-branch-changed`) detaches it and sends the change to the lead
  (`decision`, `sealFailure: 'branch-changed'`). The lead may discard it; merge and rework are
  refused. The cases that expected `needs-owner` for this failure now expect `decision`.
- **A worktree left on the ticket branch (server ×1).** Because of the detach, later merges no
  longer fail with `ticket-branch-checked-out` and "Try again".
- **Full auto sandbox (server ×1).** `denyWrite` now holds the worktree's git directory and the
  repository's common git directory (`FullAutoSpec.gitDirs`).
- **Adapter guard (adapter ×45).** These are the 13 branch-changing commands, 21 of the 22
  disguised spellings, and the 11 other repository writes. F-1's guard is an allowlist, so it
  denies commit, stash, rebase, merge, tag, remote, config and worktree add too. Each row is also
  checked against F-1's own `checkGitCommand`. The workers' and testers' `disallowedTools` must
  hold every `GIT_DENY_RULES` entry.

The owner-progress check (`assertOwnerCanFinish`) now uses F-1's reset. When the ticket branch
moved outside the app, the check expects these steps:

1. `movedOutside.tip` shows the moved tip.
2. POST `/api/runs/:id/ticket-branch/reset` with `{ from: tip }` returns 200.
3. The branch is back at the recorded tip, and `movedOutside` is gone.

The finish then continues as before.

## Closed by F-2 (2026-10-24, `wp/f-2-gaps`)

The last 12 known gaps flipped and are now plain tests with the same assertions
([docs/history/v0.3.0/wp/F-2.md](../history/v0.3.0/wp/F-2.md)):

- **Unbounded replacement helpers (server ×2, engine ×2).** A helper whose change was discarded
  or could not be saved is a lost attempt. A plan step (the helper node a start resolves to, and
  its role) may lose `max(2, 1 + maxReworkRounds)` attempts, 3 by default, times the approved
  plan's steps with that role. The run may lose that many times its plan steps, so renaming the
  role does not help. Past either, `start_agent` is refused (`attempts-exhausted`) with a plain
  message, and the lead hands over. Merged and no-change work never counts; the golden traces are
  unchanged.
- **Retrying a merge that cannot succeed (server ×1, engine ×1).** The server now reports
  `ticket-branch-moved` and `ticket-branch-checked-out` instead of `failed`. The change goes to
  the owner at once, and the lead is told not to retry: only the owner can reset (F-1) or free
  the branch. A merge that fails for a git reason goes to the owner after 3 failures in a row
  (`MAX_FAILED_MERGES`).
- **Lead discard after other seal failures (server ×2, engine ×1).** `sealFailure` adds
  `invalid-workspace` and `not-saved` (a failed seal with no code). The change still waits in
  `needs-owner`; the lead may discard it and never merge or rework it.
- **Planted push URL (server ×1).** Every push for the owner goes to `origin`'s configured
  address, never to the remote name, so no `pushurl` is used. A `pushInsteadOf` rewrite of that
  address is refused, and `ext::` and `fd::` are off (`code-host/push-target.ts`).
- **Harness checks that write (orchestrator ×1).** F-1's command guard (`checkGitCommand`, now in
  `@acp/core`) runs before every allowlist rule, so such a check is never pre-approved. The
  harness status warns about any check or setup step that is branch-managing git. The app's own
  runner never starts one: a check is recorded `error`, and a setup step `refused`.
- **Here-strings (adapter ×1).** The guard reads a shell's input. A here-string or here-document
  fed to a shell is read as a script. A shell that reads a pipe, or input with a command
  substitution, is denied when the command mentions git. `xargs git` with no subcommand is
  denied. Eleven rows of such spellings and four ordinary ones were added.

## Known gaps

None on `release/0.3.0` after F-2. Counts: server 35, orchestrator 44, adapter 81.

Observed and asserted as safe, but worth knowing:

- **Attachment copy without its guard.** A helper can write `.acp-attachments/` without its
  `.gitignore`. The copy is never sealed, but it leaves the worktree "unsealed". Its checks are then
  not run (`commit_changed`), and the lead hears only "a required check failed".
- **Writes into another helper's worktree.** The app cannot tell who wrote such a file. It becomes
  that helper's change and shows in its review (`view_change`).

## What the incident cases show

- Owner paths already refuse a moved ticket branch. Those cases are plain tests: `requireTip` and
  `verifyTicketBranch` do their job.
- Hooks and config planted through the gitdir never run in, or apply to, the app's own git (seal,
  merge, checks, push). The sealed commit keeps the app's identity.
- A pushed unreviewed commit is never forced over. The owner's push is refused (`push-rejected`).

## How to add a case

1. **Server.** Write
   `const sc = await scenario({ mode })`, then `helperTurn(sc, (t) => { … })`, then
   `await assertInvariants(sc, { finish: true })`.
   - In the callback, `t.sh(...)` runs git in the helper's worktree and `t.write(path, text)`
     writes a file there and records it.
   - Write every file through `t.write` or `sc.ledger.write`, or `[sealed]` will flag it.
   - Wrap an extra fault outside a turn in `sc.ledger.fault(name, () => …)`.
   - Call `sc.ledger.resnapshot()` after an owner action that moves refs on purpose, such as a
     merge or a push.
2. **Engine.** Script the server's reports. `sealed(…, null)` is a failed seal with no code.
   `changeSealed(…, { …, failure: 'branch-changed' })` is F-1's seal failure. You can also use
   `changeMergeBlocked`. Check what the lead and the owner may still do with `checkChangeAction`.
3. **Commands.** Add a row to the right list in `adversarial-commands.test.ts`. An ordinary
   command must `pass` in every mode. A hostile one must be `guard`.
4. Anything that fails today goes in a `knownGap` with a comment naming the work package that
   will fix it and what fixes it (widen the `fix` parameter's type to that name). Add it to a
   "Known gaps" list above. The adapter table has no `knownGap` of its own since F-2; copy the
   kit's when a row needs one.

## How to run

On a machine with little memory (8 GB), use two workers:

```bash
pnpm --filter @acp/server exec vitest run tests/adversarial --maxWorkers=2
pnpm --filter @acp/orchestrator exec vitest run tests/adversarial --maxWorkers=2
pnpm --filter @acp/adapter-claude-code exec vitest run tests/managed/adversarial-commands.test.ts
```

The server suite takes about a minute. The others take a few seconds. All of them also run in
`pnpm test`.
