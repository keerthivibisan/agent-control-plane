# Adversarial safety tests

The ordinary tests assume agents behave. These tests make fake agents misbehave and check that the
app's guarantees still hold. They were added after the ACPGIT-3 incident (2026-10-24). In that
incident, Full auto helpers switched their worktrees to the ticket branch, committed there and
reset it, and the run looped (T-1, [docs/v0.3.0/wp/T-1.md](../v0.3.0/wp/T-1.md)).

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
`fix` is `F-1` or `follow-up`. The wrapper behaves like this:

- It **passes** while the body fails with a message carrying `[tag]`. That means the gap is still
  open, and it breaks the invariant the test names.
- It **fails** if the body passes. The message says the gap is closed: make it a plain `it()` and
  update this page. This forces the update when F-1 merges.
- It **fails** if the body throws anything else, such as a broken setup or another invariant.
  `it.fails` would hide those, which is why the suite does not use it.

This keeps `pnpm check` green today. Assertions are never weakened. `ACP_SHOW_KNOWN_GAPS=1` prints
what each gap breaks. `ACP_T1_LOG=1` prints the app's structured log in the server suite (ids,
codes and counts only).

## Known gaps on `release/0.3.0` (2026-10-24)

**Expected to close with F-1 (`wp/f-1-branch-guard`):**

- **Lead discard after a branch change (server ×4, engine ×1).** The lead cannot discard a change
  whose seal failed because its worktree left its branch (`workspace-branch-changed`: the ticket
  branch or another branch checked out, or a detached HEAD). Today only the owner can, so the lead
  starts a replacement helper.
- **Full auto sandbox (server ×1).** The sandbox's `denyWrite` names only the worktree's `.git`.
  In a worktree that is a pointer file. The refs, objects and config of the shared repository live
  in the repository's common git directory, which neither list names. This is where ACPGIT-3's
  helpers wrote. Whether writes outside `allowWrite` are refused depends on Claude Code's sandbox
  defaults, which these tests cannot run.
- **Adapter guard (adapter ×35).** The guard should stop 13 branch-changing commands and 22
  disguised spellings of them for a worker and the tester in every mode. Today all of them pass to
  the gate or the classifier.

**Follow-ups (not in F-1's list as briefed):**

- **Unbounded replacement helpers (server ×2, engine ×2).** A lead can start replacement helpers
  for one plan step without limit, after failed seals or by discarding and replacing. Rework rounds
  are bounded. Replacements are not. F-1's discardable failure makes this loop easier.
- **Retrying a merge that cannot succeed (server ×2, engine ×1).** The server reports a merge
  refused because the ticket branch moved (`ticket-branch-moved`), or because it is checked out in
  a worktree (`ticket-branch-checked-out`), as `failed`. The lead is told "Try again" and can retry
  forever.
- **Lead discard after other seal failures (server ×2).** The same as the F-1 gap, for
  `invalid-workspace`: the worktree is gone, or an attachment copy was committed.
- **Planted push URL (server ×1).** The owner's Push & open PR pushes to the remote name `origin`.
  A `remote.origin.pushurl` that a helper planted in the shared config therefore receives the push.
- **Repository writes (adapter ×11).** Other writes to the shared repository are not guarded:
  commit, stash, rebase, merge, cherry-pick, tag, remote add, config, worktree add, and a disguised
  commit. It is F-1's call whether to deny them too. A row that turns red is the signal to decide.
- **Harness checks that write (orchestrator ×1).** A harness check whose command is itself
  `git push` or `git checkout` is auto-approved by `run-harness-check` in auto-edits and Full auto.

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
2. **Engine.** Script the server's reports with `sealed(…, null)` (a failed seal) or
   `changeMergeBlocked`. Check what the lead and the owner may still do with `checkChangeAction`.
3. **Commands.** Add a row to the right list in `adversarial-commands.test.ts`. An ordinary
   command must `pass` in every mode. A hostile one must be `guard`.
4. Anything that fails today goes in a `knownGap` with an `// F-1:` or `// follow-up:` comment
   saying what fixes it. Add it to the list above.

## How to run

Use two workers on this 8 GB machine:

```bash
pnpm --filter @acp/server exec vitest run tests/adversarial --maxWorkers=2
pnpm --filter @acp/orchestrator exec vitest run tests/adversarial --maxWorkers=2
pnpm --filter @acp/adapter-claude-code exec vitest run tests/managed/adversarial-commands.test.ts
```

The server suite takes about a minute. The others take a few seconds. All of them also run in
`pnpm test`.
