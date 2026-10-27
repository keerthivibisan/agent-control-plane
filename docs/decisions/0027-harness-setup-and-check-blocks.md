# ADR-0027: Harness setup steps and check blocks in the workflow graph

- **Status:** accepted (owner, 2026-10-23: "we are not able to introduce harness in orchestration
  graph"; "write the plan with setup step included"; "i think we can have this as part of 0.3.0")
- **Date:** 2026-10-23
- **Deciders:** project owner (decisions); coordinator (draft)
- **Amends:** ADR-0017 (the harness manifest, the commands the app may run), ADR-0021 §3 (when
  checks run and who decides after a failure), ADR-0023 (the Checks gate becomes a configurable
  block)
- **Plan:** [docs/history/v0.3.0/README.md](../history/v0.3.0/README.md), part 5 (H series)

## Context

ADR-0017 defines the harness as the checks that let agents validate their own work. Since ADR-0021
and ADR-0023 the required checks gate each change's merge into the ticket branch (one fixed Checks
gate in the graph) and the owner's final merge (the tip). The owner cannot choose which checks run
where or what happens on a failure, and a fresh worktree has no dependencies, so checks often fail
for reasons that have nothing to do with the change.

## Decision

1. **Setup steps** in `.acp/harness.json` (still version 1; additive, optional): at most 5, each an
   argument list with an id, name, time limit (1–1800 s), optional `cwd`, optional `network`
   (default false) and optional `outputs` (repository-relative folders). They run with ADR-0017 §3's
   policy (no shell, a bare command name, its own process group, a filtered environment, the
   redacted last 16 KiB of output kept), in an editing agent's new worktree before it starts and in
   a fresh check checkout before its checks; never in the owner's checkout; never for reading roles.
   A failed or timed-out step stops that start or that check run.
2. **Network.** The app does not isolate setup or check processes from the network (as today for
   checks). A step that needs it declares `network: true`; it runs only while the project setting
   "Setup may use the network" (owner-only, off by default) is on; otherwise it is refused with a
   plain reason. Checks keep today's behaviour. This is project code the owner reviewed, run on the
   owner's machine; it is not the app making network calls of its own (AGENTS.md rule 8).
3. **Outputs are never staged.** A step's `outputs` are excluded and unstaged by the seal, like
   `.acp-attachments/`, and a branch whose history touched them is refused.
4. **Labels** on checks (optional slugs) let a block select checks by group.
5. **Check blocks.** The graph's `checks` node gains `select` (`required` | ids | labels) and
   `onFailure` (`lead` | `owner` | `helper`), and may be placed on a helper's change (before its
   review), before the lead's merge (mandatory, one, as today) or on the ticket branch (before the
   owner's merge). `onFailure: helper` needs a `rework` edge from the block to the helper it checks
   (`maxRounds` 0–5); the lead is told each round. Old graphs migrate to the mandatory block with
   `required` and `lead`, unchanged in behaviour.
6. **Invariants kept:** nothing merges automatically; the owner's final merge still needs the
   required checks on the tip, or "Merge anyway" with a reason; only the lead merges changes;
   reading roles never run commands.

## Consequences

- **Time:** setup runs once per editing agent's worktree; slow installs make agents start later.
  A cache keyed on lock files is a follow-up.
- **Migration 0010:** setup runs and the block each check run belongs to. The live database is backed
  up before it is applied.
- **Risk:** setup runs project code with the owner's privileges, like checks (ADR-0017). Mitigations
  as there, plus the explicit network switch.

## Alternatives considered

- **Setup as an agent's job** (the helper installs things itself): each command asks the owner or
  needs the allowlist, costs tokens, and differs per agent. Rejected.
- **Free placement of check blocks anywhere:** harder to validate and to explain; three fixed
  places cover per-change, pre-merge and branch-level checking.
- **Network isolation now:** needs a process sandbox for check commands, which the app does not have
  outside the SDK's own sandbox. Recorded as a follow-up.

## Amendment 2026-10-24: branch-managing checks (F-2)

The command guard runs before the
`run-harness-check` rule, so a harness check (or any command) that is branch-managing git is
never pre-approved for an agent, in any mode. The harness status lists a warning for each check
or setup step that is branch-managing git. The app's own runner never starts one, anywhere it
runs (agent worktrees, tip checkouts, the main branch). A check is recorded `error`, and a setup
step `refused`, which stops the rest of the setup.

## Amendment 2026-10-27: conflict resolution and delegated delivery (ADR-0030, proposed)

§6 "nothing merges automatically": still true for changes into the ticket branch. A conflict
resolution may promote its candidate to the ticket branch, and delegated delivery may merge into an
allowed target, only under the project's explicit policy.
