# R-K — Role tool base sets (adapter)

> Progress file for R-K. Only the agent working on it edits it (coordinator:
> `docs/redesign/STATUS.md`). Protocol: `docs/phase-4/README.md` §9 with redesign paths. Spec:
> ADR-0019 §7 (amendment "a fixed tool base set per role"), with §6 (agent files), ADR-0020
> (follow-up turn) and ADR-0013 §2. Evidence: `docs/research/r-v-real-run-2026-10-16.md`.

| Field   | Value               |
| ------- | ------------------- |
| Status  | review              |
| Owner   | adapter agent       |
| Branch  | `wp/r-k-role-tools` |
| Started | 2026-10-16          |
| Updated | 2026-10-16          |

Owned paths: `packages/adapters/claude-code/**` and its tests,
`packages/server/tests/verification/redesign/**` (only where a test asserts the old SDK options),
`docs/provider-adapters.md` §11, this file.

## Tasks

- [x] 1. Role base sets: an explicit SDK `tools` for every role; agent file and follow-up only
      narrow; `Skill` only with a plugin
- [x] 2. Gate as a second layer: deny built-ins outside the effective base set; Skill gate for the
      run's `acp-skills:*` names only
- [x] 3. The lead is read-only: no edit/shell tools, never asks the owner about them
- [x] 4. Tests (fakes only) and `docs/provider-adapters.md` §11

## Work log (append-only; newest last)

| Date       | What was done                                                                                  | Commit    | Checks                                                        |
| ---------- | ---------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------- |
| 2026-10-16 | Claimed R-K on the branch                                                                      | `666e926` | docs only                                                     |
| 2026-10-16 | Role base sets (`agentToolNames`), gate second layer, Skill gate; tests; provider-adapters §11 | `aa71d9e` | pnpm check ✓: test 2,089/2,089 (claude-code 323); e2e 49/49 ✓ |
| 2026-10-16 | Up to date with `main` (`4991c7f`); completion report; status `review`                         | (this)    | docs only                                                     |

## Decisions and choices (within ADR-0019 §7)

- **`MultiEdit` and `NotebookEdit` stay out** of the worker/tester base set. The R-V worker's
  `system/init` offered `NotebookEdit` but no `MultiEdit`; no stage edits notebooks, and `Edit` and
  `Write` cover the work. `BashOutput`/`KillShell` (background shells) and the older `LS` name are
  out too.
- **Lead:** with the base set it has no `Bash`/`Edit`/`Write`; the gate denies them (and every
  other out-of-set built-in) without asking, even if the lead stage's agent file lists them. A
  lead's `Read`/`Grep`/`Glob` **outside its folder still asks the owner**, as before (ADR-0013 §4):
  no ADR makes that a deny, and it is not an edit. The engine's lead approval path
  (`requestPermission` in `@acp/orchestrator`) is unchanged; it can now only be reached by such
  reads or a non-`acp` MCP tool (none run, `strictMcpConfig`). No deliberate lead edit flow was
  found in tests or ADRs.
- **Lead `disallowedTools`:** still none (only the planner and reviewer have them, as the ADR
  says); the base set already keeps the edit and shell tools out of its context.
- **Skill gate:** an allowed plugin skill runs **without asking**, for every role (including the
  planner and reviewer, which previously fell through to "only reads" denial). The input must
  parse as `{ skill: string }` (extra keys such as `args` are ignored); the name must be exactly
  one of `spec.skillPlugin.skills`, with one leading `/` accepted (slash-command form). Anything
  else is denied with `DENY_SKILL`. The input is never logged.
- **Deny messages:** a role tool the agent file narrowed away keeps "This stage's agent file does
  not list this tool."; an edit/shell tool of a reading role gets "This agent only reads files
  inside its folder."; anything else outside the base set gets the new "This tool is not part of
  this agent's role.".
- **API:** `profileToolNames` (null when not narrowed) is replaced by `agentToolNames` (always a
  list); new exports `roleBaseTools`, `READ_ONLY_BASE_TOOLS`, `EDITING_BASE_TOOLS`, `SKILL_TOOL`,
  `isRunSkillCall`, `DENY_NOT_IN_ROLE`, `DENY_SKILL`. The `Task`/`Agent` alias handling is gone:
  neither name is in any base set. Nothing outside the adapter package used the removed names.

## Proposed text for coordinator-owned files (not made)

- `docs/redesign/STATUS.md`, R-K row: status `review`, branch `wp/r-k-role-tools`, note "base sets
  per role + gate second layer + Skill gate; fake-query tests only; consented `system/init`
  re-check pending".
- ADR-0019 §7: no change needed. Optionally add under "Kept as before": "A lead's read outside its
  folder still asks the owner (ADR-0013 §4). `MultiEdit` and `NotebookEdit` were not added (the
  R-V `init` offered no `MultiEdit`)."

## Completion report — R-K

1. **Summary:** every managed agent now gets an explicit SDK `tools` base set per role (ADR-0019
   §7). Agent files and the follow-up only narrow it. `Skill` is added only with a plugin. The
   gate denies any built-in outside the set, never asks about lead edits, and allows `Skill` only
   for the run's `acp-skills:*` names.
2. **Files changed:**
   - created `packages/adapters/claude-code/tests/managed/base-sets.test.ts`,
     `docs/redesign/wp/R-K.md`;
   - modified `packages/adapters/claude-code/src/managed/{permissions,adapter,index}.ts`,
     `packages/adapters/claude-code/tests/managed/{permissions,profile,follow-up}.test.ts`,
     `packages/server/tests/verification/redesign/{agent-files,stages}.test.ts`,
     `docs/provider-adapters.md` (§11.1).
3. **Commands run and actual results:** `pnpm check`: format ✓, lint ✓, typecheck ✓, test
   2,089/2,089 ✓ (core 249, demo 12, orchestrator 451, claude-code 323, db 168, web 470,
   server 416), build ✓. `ACP_E2E_PORT=7951 ACP_E2E_CONTROL_PORT=7961 pnpm --filter @acp/web
test:e2e`: 49 passed.
4. **Acceptance criteria:**
   - role base sets exact per role → met (`base-sets.test.ts` "gives each role exactly its base
     set");
   - `Skill` only with a plugin → met ("adds Skill only when the run has a skills plugin");
   - agent file narrows, never widens, per role → met ("an agent file narrows … never widens it",
     profile tests, R-V stages and agent-files tests);
   - follow-up unchanged → met (follow-up tests unchanged and passing; "leaves the follow-up turn
     as it was");
   - gate denies unlisted built-ins (`SendMessage`, `CronCreate`, `WebFetch`, `Task`, `Agent`, …)
     for every role without asking → met ("denies every extra built-in for every role");
   - Skill gate: plugin names only; bundled skills and malformed input denied → met (two Skill
     gate tests);
   - lead edits denied without asking → met ("denies the lead edits and shell commands …", R-V
     stages test on the real gate);
   - `allowedTools` never set; `settingSources: []`, `permissionMode: 'default'`,
     `strictMcpConfig: true`, `mcpServers`, read-only `disallowedTools` unchanged → met;
   - old `tools: undefined` assertions updated → met;
   - `docs/provider-adapters.md` §11 documents the base sets with the real-run evidence → met.
5. **Assumptions:** the `Skill` tool input is `{ skill, args? }` (not in the SDK's
   `sdk-tools.d.ts`; anything else is denied, so a different shape fails closed). Documented here
   and in provider-adapters §11.1.
6. **Contract or shared-file changes needed:** none. Optional ADR-0019 §7 note proposed above.
7. **Known gaps / follow-ups:**
   - Fake-query tests only. A consented real re-check (coordinator) should confirm that each
     role's `system/init` lists exactly its base set (plus `Skill` and `mcp__acp__*`) and that a
     plugin skill call passes the Skill gate. If the real `Skill` input shape differs, the gate
     denies plugin skills (fail closed) and the schema needs adjusting.
   - The §11 header still says "No real run has happened yet (that is P3-F)", which is stale since
     P3-F and R-V; left for whoever owns the section header.
8. **Next recommended task:** the coordinator's consented R-V re-run (`drive.ts`) to check the
   `system/init` tool lists per role, then the v0.0.1 release steps.
