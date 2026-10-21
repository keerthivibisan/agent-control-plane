# v0.3.0: session names and run summaries (S series)

Coordinator-owned plan. The status is in [STATUS.md](STATUS.md), the decision in
[ADR-0024](../decisions/0024-session-names-and-run-summaries.md), and the progress files in
`wp/S-*.md`, one per WP, each edited only by its agent.

## Working rules (owner decisions, binding)

- **Never touch `main`.** All work is on `release/0.3.0`, and the owner raises and merges the PR
  to `main` in GitHub. `release/0.3.0` started from `release/0.2.0` (`259feee`); once the owner
  merges 0.2.0, rebase it onto `main`.
- **Agents start with the Agent tool's `isolation: "worktree"`** and create their branch with `git
switch -c wp/s-<id>-<slug> release/0.3.0`.
- **No `cd` in agent commands;** use paths, `git -C` and `pnpm --filter`. Coordinator merges
  happen in `<repo>/.claude/worktrees/v3-coord` with `git -C … merge --ff-only`.
- **The owner wants finished, verified results.** Agents decide details and record them.
- **Real `claude` runs only with the owner's consent in chat,** batched.

## What we are building

1. **Session titles at start.** The server builds `ManagedAgentSpec.title` from app data, and the
   adapter passes it to the Agent SDK's `title` option (SDK 0.2.113 or later; this repo uses
   0.3.296). Formats are in ADR-0024 §1; follow-ups keep the resumed title.
2. **Names in the app.**
   - `SessionSummaryDto.managed` names the sessions the app started.
   - Untitled helper agents show their type and description.
   - Other untitled sessions show their branch and start time.
3. **The run summary comment** (author `app`).
   - **At handover:** facts from records plus the lead's optional `request_review.summary`
     (at most 1,500 characters, 3 to 6 sentences).
   - **On a run that ends without a handover:** facts only.
   - **After the owner's merge:** "Merged acp/KEY into main at …".

No migration (ADR-0024 §4).

## Contract (S-0, coordinator, done in its commit)

- `TicketCommentAuthorSchema` gains `app`.
- `ManagedAgentSpec.title?`, with `MAX_SESSION_TITLE = 120` (core `orchestration`).
- `SessionSummaryDto.managed?: { runId, agentRunId, ticketKey | null, kind, label }`.
- **Pre-approved for S-A** (added together with the code that uses it, so the lead never sees a
  field that does nothing): `LeadToolInputs.request_review` gains
  `summary?: string` (trimmed, 1 to 1,500 characters), plus the adapter test that pins the lead
  tool inputs.

## Work packages

| WP  | What                                                                                                                                                                                                                                                                 | Owned paths                                                                                                                 | After                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| S-0 | ADR-0024, contract, docs                                                                                                                                                                                                                                             | core contract files above, `docs/v0.3.0/**`, ADR index                                                                      | —                          |
| S-A | Titles built by the server and passed to the SDK by the adapter; `managed` on session DTOs; `request_review.summary` (engine effect, lead brief); the run summary composed by the server; the facts-only summary on runs that end without a handover; the merge line | `packages/{orchestrator,server,adapters/claude-code}/**`, `packages/db/src/repositories/**`, the pre-approved contract edit | S-0                        |
| S-B | Web: session names (managed label, helper and top-level fallbacks) in Sessions and the agent trees; `app` comments rendered as a run summary card; copy                                                                                                              | `packages/web/**`                                                                                                           | S-0 (mocks), then S-A DTOs |
| S-V | Verification: e2e on the real server; a consented real run confirming the title shows; the README, the CHANGELOG `[0.3.0]`, release prep                                                                                                                             | `e2e/**`, `docs/**`, the real-run driver                                                                                    | S-A, S-B                   |

## Acceptance

- **Titles:** every managed agent's SDK `query()` receives a title of the agreed format (adapter
  test with a fake SDK). In a consented real run, Claude Code records it; check how with the least
  reading, for example the app's own session ingestion of the throwaway project.
- **Summary:** a run summary comment after every handover, with facts matching the database and
  the lead's note when given; a facts-only summary on failure or stop; a merge line after the
  owner's merge.
- **Content:** no conversation content in titles or facts, by test.
- **Names in the app:** the Sessions page shows the managed label for app sessions and the
  fallbacks for untitled ones.
- **Checks:** `pnpm check` and the full e2e stay green.
