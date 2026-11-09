# Project assistant (AS series): plan

Coordinator-owned. Status: [STATUS.md](STATUS.md). Decision:
[ADR-0035](../decisions/0035-project-assistant.md) (accepted). Branch:
`feature/assistant/project-assistant` from `feature/codemap/code-map`.

## Goal

A floating chat on every project page that answers "what is the state of my tickets?" and
questions about the project, and writes skills and agent definitions from the owner's description,
asking follow-up questions when needed. Claude by default, Codex selectable; model and effort
(low, medium, high) selectable; chat kept for the session only; writes in Approve or Auto mode.

## How it works [implemented]

- The server starts one managed agent of the read-only `assistant` role per project, in the
  project's folder, when you send the first message. Opening the panel costs nothing.
- The assistant reads the project's files and uses five tools: `ticket_status`, `project_info`,
  `code_map`, `propose_skill` and `propose_agent`. It cannot edit code, run commands, or start,
  stop or message ticket agents. Every permission request it makes is denied.
- A proposal is one complete `.claude/skills/<slug>/SKILL.md` or `.claude/agents/<slug>.md`. The
  app checks and writes it with the Skills & Agents page's own rules (ADR-0018). No other file is
  ever written.
- The chat lives in the server's memory only. It ends when you end it, start a new one, after 30
  minutes without activity, at 300k tokens, or when the app stops. Nothing about it is stored.
  Token usage is still recorded.

## Using it

1. Open a project page and click the round button at the bottom right.
2. Pick the provider (Claude or Codex), the model and the effort. Changing one starts a new chat.
3. Ask, or click a suggested prompt such as "What’s the status of my tickets?" or "Configure
   agents and skills for this project". The third one fills in a template for your project's
   needs. The assistant may ask follow-up questions first.
4. Choose the write mode in the panel:
   - **Approve** (the default): each proposal shows as a file preview. Click Apply to write it,
     or Discard.
   - **Auto**: the app writes each proposal at once and the chat shows what was written.
5. A replacement of an existing file is marked as one. The app never commits: review the new
   files and commit them yourself.

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
