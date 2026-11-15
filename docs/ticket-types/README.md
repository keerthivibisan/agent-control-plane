# Workflows by ticket type (TT series): plan

Coordinator-owned. Status: [STATUS.md](STATUS.md). Decision:
[ADR-0039](../decisions/0039-workflow-blocks-by-ticket-type.md) (accepted).

## Context

The owner asked for behaviour-driven development (2026-11-15): analyse the behaviour, write the
scenario tests and the code in parallel, and validate the combined work, while bug and fix tickets
skip the analysis and the test writing. Parallel helpers, researchers that run first and a tester
on the merged work already existed; what was missing was a workflow that changes with the ticket
type.

**Owner decisions, 2026-11-15:**

1. A **"Runs for" ticket-type setting per Agent block**, one workflow for every ticket type.
2. In the BDD template, the **tester still runs on bug tickets**, with the tests they have.

**Branch:** `feature/workflow/ticket-types` from `feature/workflow/failure-routing` (PR #23);
the PR is stacked on #23 and goes to `dev` after it.

## How to use (for the owner)

1. On the Workflow page, choose **Templates… → Behaviour-driven (BDD)**, or select any Agent block
   and untick the ticket types it should not run for under **Runs for**. The block then shows a
   chip such as "Feature only".
2. Read **Flow in words**: such a block says "It runs only for feature tickets."
3. If a ticket type would be left with a workflow that cannot run (for example its only helper is
   feature-only), **Problems** says so ("For bug tickets, without …") and the workflow cannot be
   saved until it is fixed.
4. Start a ticket: its run uses only the blocks its type runs. On the BDD template a feature ticket
   runs the Behaviour analyst first, then Scenario tests and Developer at the same time, then the
   Tester on the merged work; a bug ticket runs Lead → Developer → Checks → Tester.

## Work packages

| WP   | Scope                                                                                     |
| ---- | ----------------------------------------------------------------------------------------- |
| TT-0 | ADR-0039, plan and STATUS, AGENTS.md line                                                 |
| TT-1 | Core: `ticketTypes`, `specialiseForTicket`, the per-type rule, words, downgrade, template |
| TT-2 | Server: the ticket start runs the graph of the ticket's type                              |
| TT-3 | Web: "Runs for", the block chip, the template in the picker                               |
| TT-4 | Simulator cases, docs, full `pnpm check`                                                  |

## Verification

Core unit tests (specialising, cascades, chain step-over, When arrows, the per-type rule, the BDD
template for all four types), a server test (bug and feature tickets on the BDD template), web
tests (Runs for, chip, problem), the graph-correctness simulator on the BDD template per ticket
type, and `pnpm check`. A real run of the BDD template needs the owner's consent.
