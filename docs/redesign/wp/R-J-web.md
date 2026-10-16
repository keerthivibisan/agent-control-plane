# R-J (web) — The lead's chat after the lead ends

> Progress file for the web part of R-J. Only the agent working on R-J web edits it (coordinator:
> `docs/redesign/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with redesign paths. Spec:
> `docs/redesign/README.md` §6b ("Web" row), ADR-0020, ADR-0015. Contract: `861d380`
> (`RunDetailDto.followUp`, `ChatMessageDto.followUp`). The backend (engine, server, adapter) is a
> separate branch (`wp/r-j-follow-up`).

| Field   | Value          |
| ------- | -------------- |
| Status  | in-progress    |
| Owner   | frontend agent |
| Branch  | `wp/r-j-web`   |
| Started | 2026-10-16     |
| Updated | 2026-10-16     |

## Tasks

- [ ] 1. Chat box on ended runs: `available` (box + short line), `running` (box disabled, "The lead
      is answering…"), `unavailable` (a note per reason); unchanged when `followUp` is absent
- [ ] 2. The run being viewed (current or an earlier one from the run picker); the lead's chat tab
      reachable when the lead ended
- [ ] 3. Bubbles: "Follow-up" tag next to the speaker; "After the run ended" divider before the first
      follow-up message
- [ ] 4. Tests: component (each state, tag, divider, send via `sendChat` with CSRF, refused while
      running), e2e (completed run with `followUp` available, message round-trip), screenshots

## Work log (append-only; newest last)

| Date       | What was done                    | Commit | Checks    |
| ---------- | -------------------------------- | ------ | --------- |
| 2026-10-16 | Claimed R-J web on `wp/r-j-web` | (this) | docs only |
