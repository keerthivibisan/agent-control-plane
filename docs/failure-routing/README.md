# Failure routing (FR series): plan

Coordinator-owned. Status: [STATUS.md](STATUS.md). Decision:
[ADR-0038](../decisions/0038-failure-routing-with-when-arrows.md) (accepted).

## Context

The AR series (ADR-0037) made workflows a graph of Agent blocks whose roles come from arrows. When something goes wrong, routing is still mostly hard-coded:

- A tester never fixes code. If its tests find a bug, it says so in free text in its final note (`stages.ts:456`), and the lead decides.
- A Checks block's `onFailure: helper` (`check-blocks.ts:182`) sends the failure back to the change's own author. For a tester, that author is the tester itself, which is wrong.
- The lead chooses which helper does a fix from its helper list (`briefs.ts helperBriefLines`). It has no view of the whole workflow and no structured view of the failure.
- Agents never choose where their output goes. The engine routes it by arrows. There is no arrow for "on failure, send to X".

**Owner decisions, 2026-11-14:**

1. Plan the tester-failure route (option 4) and a structured test result (option 2) first, then "When" arrows (option 1).
2. A failure can go **directly to another agent or to the lead**.
3. A fix goes to **the arrow's target, or the author**. "Author" means ACP finds the helper whose merged change touched the failing files.
4. When a fix goes directly to a helper, the **lead is notified with the full context and can step in**. When the rounds run out, the failure goes to the lead.
5. Triggers: **tests fail, checks fail, a reviewer asks for rework**, and also **a harness failure and a merge conflict**. Any rework scenario should be designable.
6. The **lead must know the whole workflow structure**, so it can use the right agents.
7. On any failure, **the lead gets the context** so it can analyse it and pass it on.
8. The flow must stay **easy for a person to understand and design**.

**Branch:** `feature/workflow/failure-routing` from `feature/workflow/arrows`, after the pending AR follow-up is committed (see Step 0). PR to `dev` after #22 merges, or stacked on #22.

## Step 0: finish the pending AR follow-up (part of PR #22)

The paused agent left uncommitted work in `.claude/worktrees/arrows`. Resume it:

- fix the quote syntax error in `orchestrator/src/arrow-notes.ts`;
- wire the arrow notes into `lead-tools`, `loop`, `check-blocks`, `review-tool`, `draft.startStage`, `commands` and `briefs`;
- add the EdgePanel "who receives this" hint;
- add tests and docs, commit (UI move and purpose delivery separately), and push to #22.

The per-agent receiver table is already designed: the implement purpose goes to the helper, review to the reviewer, findings to the lead, rework to the editor, test or final flow to the tester or final reviewer, and plan to the planner.

## Design

**FR-A. Structured test result (option 2).** A new tool for testers, `report_test_results`:

- `status: passed | failed`;
- `failed[]` (at most 50 items: `test`, `file?`, `message` up to 500 characters);
- `summary` up to 2000 characters.

It is stored as a ticket comment of kind `test-results` (text is stored, as with review findings, ADR-0021 §6), and kept in engine state. The tester's brief says to call it once before `report_work`. A free-text bug note alone no longer counts as the result.

**FR-B. Failure context.** A new core type, `FailureContext`. It is built by the engine for every failure event:

- the `event`;
- the source agent and node;
- the change;
- the **authors**, meaning the helpers whose merged changes touched the failing files (from the merged changes' file lists and the failing test files and paths);
- the failed items (tests, checks with an output tail capped as today, review findings, conflicting files);
- rounds used and rounds left.

It is rendered as quoted data. **The lead always gets it** (decision 7), and a fix target gets the same packet.

**FR-C. Tester failure route (option 4).** A tester's failing tests or checks never go back to the tester. Without a When arrow, they go to the lead with the context, which names the likely authors. `onFailure: helper` on a tester's Checks block means "the author".

**FR-D. "When" arrows (option 1).** A new arrow type, `when`, in graph v3:

- **Fields:**
  - `on`: one or more events from `tests-failed`, `checks-failed`, `review-rework`, `harness-failed`, `merge-conflict`;
  - `maxRounds` (1 to 5, default 2);
  - optional `label` and `purpose`, as on every arrow.
- **From:** the block where the event happens:
  - a tester, for `tests-failed`;
  - a Checks block, for `checks-failed` or `harness-failed` (a harness that cannot run, as opposed to a check that failed);
  - a change reviewer, for `review-rework`;
  - ticket-merge, for `merge-conflict`.
- **To:** a helper block, the **lead**, or a new **Author** block. Author is a small routing block, not an agent: "whoever wrote the failing code". At most one per graph.
- **Rules:**
  - Each (source, event) pair has at most one route. Without one, the event goes to the lead, as today.
  - A When arrow never gives its target a role. Its target must already be a helper, the lead or Author. The validator checks this.
- **Run time:**
  - The engine starts a **fix turn** for the target: a rework of the change if it isn't merged yet, otherwise a new change from the ticket branch, using the target node's settings. The fix turn gets the `FailureContext` plus the arrow's purpose.
  - The lead is notified with the context and "X is fixing it". It can step in with a new `reroute_fix` lead tool, or stop the fix.
  - After `maxRounds` failed rounds, the failure goes to the lead.
- **Existing settings:** they become sugar for the new arrows. The `rework` arrow and `onFailure` (`lead`, `helper`, `owner`) map to `when` arrows on read (a v3 graph migration), so there is one way to express failure routing.

**FR-E. The lead knows the workflow.** The lead's brief gets a generated **"Your workflow"** section:

- every agent block with its role, provider, model and description;
- every arrow as a sentence, for example "When tests fail at Tester → Author fixes (2 rounds), then you decide", with the owner's label and purpose quoted.

A new read-only lead tool, `view_workflow`, returns the same section. The text is built from the compiled program in one function, which the web reuses for the human summary (FR-F).

**FR-F. Easy to read and design (web).**

- **Editor:**
  - a **When** arrow with event checkboxes and rounds;
  - an **Author** block in the palette;
  - When arrows drawn red and dashed, labelled with their events.
- **A "Flow in words" panel** beside the canvas lists the same sentences as the lead's brief, so the owner reads exactly what the lead reads. Unrouted events show "→ Lead decides (default)".
- **Live run graph:** a failure that travels along a When arrow lights it, with the round count.
- **Ticket activity:** shows the failure context and who is fixing it.

## Work packages (in order; `pnpm check` green and a commit at each)

| WP   | Scope                                                                                                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FR-0 | ADR-0038 "Failure routing with When arrows" (amends ADR-0037, ADR-0028 onFailure and ADR-0023 rework), plan and STATUS in `docs/failure-routing/`, AGENTS.md §1 line                                                     |
| FR-1 | `report_test_results` (core tool schema, both adapters, engine, server storing `test-results` comments, web rendering) and the tester brief                                                                              |
| FR-2 | `FailureContext` and author detection (core types; engine builder; server provides changed-file lists per merged change); the lead gets the context on every failure event, including harness failure and merge conflict |
| FR-3 | Tester-failure route to the author or the lead (option 4); `onFailure: helper` on a tester means the author                                                                                                              |
| FR-4 | Core: the `when` arrow, the Author block, validation, compile (`program.failureRoutes`), migration of `rework` and `onFailure` into When arrows, the shared "flow in words" text builder                                 |
| FR-5 | Engine: event → route → fix turn; lead notice; `reroute_fix` and `view_workflow` tools; round limits; escalation; the "Your workflow" section in the lead's brief                                                        |
| FR-6 | Web: When arrow, Author block, event checkboxes, Flow-in-words panel, live graph and activity                                                                                                                            |
| FR-7 | Adversarial tests, docs, and one consented real run                                                                                                                                                                      |

## Verification

- **Unit and engine tests** for each event type:
  - with a route to a helper, to Author and to the lead;
  - without a route (goes to the lead);
  - rounds running out (escalates to the lead);
  - the lead's reroute;
  - the context reaching the lead every time.
- Author detection with one, several and zero touching helpers.
- **Migration:** existing `rework` arrows and `onFailure` settings give the same behaviour (graph-correctness simulator, golden runs).
- **Adversarial:**
  - a When arrow can't give a role or edit rights, and can't target a read-only agent;
  - failure text (test messages, check output) reaches agents only as quoted data;
  - no fix loops beyond `maxRounds`;
  - a forged `reroute_fix` is refused.
- **Web:** drawing a When arrow; the Flow-in-words text matches the lead's brief text, since both come from one function.
- `pnpm check` at every checkpoint. E2E for the editor.
- **One consented real run** on a throwaway repo, with a deliberately failing test: tester → When(tests-failed) → Author fixes → passes.
- No push without you asking. The PR goes to `dev` with the `keerthivibisan` account.
