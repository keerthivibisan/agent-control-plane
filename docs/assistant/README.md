# Project assistant (AS series): plan

Coordinator-owned. Status: [STATUS.md](STATUS.md). Decision:
[ADR-0035](../decisions/0035-project-assistant.md) (accepted). Branch:
`feature/assistant/project-assistant` from `feature/codemap/code-map`.

## Goal

A floating chat on every project page that answers "what is the state of my tickets?" and
questions about the project, and writes skills and agent definitions from the owner's description,
asking follow-up questions when needed. Claude by default, Codex selectable; model and effort
(low, medium, high) selectable; chat kept for the session only; writes in Approve or Auto mode.

## Work packages

| WP   | What                                                                                                                                                                                                       | Owned paths                                                                           | After |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----- |
| AS-0 | ADR-0035, this plan                                                                                                                                                                                        | `docs/decisions/**`, `docs/assistant/**`                                              | —     |
| AS-1 | `assistant` role and tools in core and both adapters; the server's assistant service (sessions in memory, tools, proposals, Approve/Auto writes through the ADR-0018 writer); REST and a chat event stream | core orchestration and api, both adapters, `packages/server/src/assistant/**`, routes | AS-0  |
| AS-2 | Web: the floating button and panel (suggested prompts, provider, model, effort, mode, streaming chat, file previews with Apply and Discard)                                                                | `packages/web/**`                                                                     | AS-1  |
| AS-3 | Safety tests and docs; one consented real check with a lightweight model                                                                                                                                   | tests, `docs/**`                                                                      | all   |

## Verification

- `pnpm check` green at every checkpoint, fakes only in tests.
- Adversarial: a proposal for a path outside the two allowed shapes, a symlinked skills folder, an
  oversized file, an instruction inside repository text, and an attempt to reach ticket agents are
  all refused.
- Session only: nothing about the chat reaches the database or logs.
