# P4-F — Project wizard and settings UI

> Progress file for P4-F. Only the agent working on P4-F edits this file (coordinator: STATUS.md).
> Protocol: `docs/phase-4/README.md` §9. Scope, owned paths and acceptance: README §8.

| Field   | Value                   |
| ------- | ----------------------- |
| Status  | review                  |
| Owner   | frontend agent          |
| Branch  | `wp/p4-f-project-setup` |
| Started | 2026-10-13              |
| Updated | 2026-10-15              |

## Tasks

- [x] Route #/projects/new: 5-step wizard (existing folder or new repo; agent setup; allowlist; context files; harness)
- [x] Route #/projects/:id/settings: AI work environment card, harness card, danger zone
- [x] Run checks now; Create 'Build the harness' ticket
- [x] Fixture tests; screenshots; pnpm check + e2e green

## Work log (append-only; newest last)

| Date       | What was done                                                                                                                                                 | Commit    | Checks                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------- |
| 2026-10-13 | Claimed; branch `wp/p4-f-project-setup` created from `main`                                                                                                   | `f8c0605` | —                                                                 |
| 2026-10-13 | WIP checkpoint after a usage-limit interruption: api client functions, copy, routes, form logic and setup sections; wizard and settings pages not written yet | `092d1c3` | not run (WIP; App.tsx imports pages that don't exist yet)         |
| 2026-10-15 | Coordinator saved the uncommitted wizard, settings, harness panel and tests after a second interruption                                                       | `bd70d3c` | not run                                                           |
| 2026-10-15 | Lint fixes (derived wizard draft, no setState in effects), progress-dot wrap and settings dividers after screenshot review; §9 report; status `review`        | (this)    | format ✓ lint ✓ typecheck ✓ test 1389/1389 ✓ build ✓; e2e 11/11 ✓ |

## Handoff notes

- **Routes:** `#/projects/new` (`NewProjectWizard`) and `#/projects/:id/settings`
  (`ProjectSettings`), in `router.ts` (`project-new`, `project-settings`, `href.newProject`,
  `href.projectSettings`) and `App.tsx`. The Shell highlights Projects for both. The project page
  has a **Settings** button. Nothing links to `#/projects/new` yet: P4-E's board "New project"
  button should use `href.newProject()`.
- **Links into other WPs' routes**, as plain hashes in `features/project-setup/setup-form.ts`:
  Finish goes to `#/board/:projectId` (P4-E), and the created harness ticket links to
  `#/tickets/:ticketId` (P4-G). Replace them with `href.board`/`href.ticket` once those land.
- **Client (`lib/api.ts`, add-only section)**: `createRepoProject`, `getProjectSetup`,
  `updateProjectSetup`, `getHarnessStatus`, `runHarnessChecks`, `createHarnessTicket`,
  `getContextCandidates`, `projectSetupPaths`, `projectSetupSchemas`, `isProjectSetupPath`. Every
  mutation sends `X-ACP-CSRF` (403 → fresh token, one retry), like the control panel. Adding an
  existing folder reuses the Setup page's `useRegisterProject` (POST /api/projects, no CSRF, as
  today).
- **One small non-additive edit in `lib/api.ts`**: `ApiClient` gained `put` (and `request` accepts
  `PUT`), needed for `PUT /api/projects/:id/setup`. Other WPs needing PATCH can widen it the same
  way.
- **Server expectations for P4-D** (assumed, not in the contract): `POST /api/projects/new` refusals
  use `conflict` (folder exists) and `invalid_root`/`not_found` (parent missing), like
  POST /api/projects; anything else reads "The repository couldn't be created." with the server
  message under Technical details. The harness POSTs are sent with an empty JSON body `{}`.
  `GET /setup` must answer for a just-created project (with defaults), since the wizard edits
  that.
- **Wizard behaviour:** the project is created on step 1's button; Back never creates it twice. The
  setup is saved once, on leaving step 4 (PUT). Suggested context files (e.g. CLAUDE.md) are
  pre-selected only while the saved setup has none and the owner hasn't changed the list.
- **Screenshots** (fixture-backed via a temporary, uncommitted Playwright spec that served `dist/`
  and fixture API answers): see §9 item 4.

## Blockers / proposed contract changes

**Open, not blocking the rest:** README §5.4 asks the settings harness card to show each check's
**command (as code) and timeout**, but `HarnessStatusSchema.checks` carries only `id`, `name`,
`required`. The card shows name, id and required/optional, plus the sentence "The exact commands,
time limits and working folders are in .acp/harness.json in the repository." Proposed diff
(coordinator-owned `packages/core/src/workspace/workspace.ts`; affects P4-C, which builds the
status):

```diff
   checks: z.array(
-    z.object({ id: slug, name: z.string().min(1), required: z.boolean() }),
+    z.object({
+      id: slug,
+      name: z.string().min(1),
+      required: z.boolean(),
+      argv: CheckArgvSchema,
+      cwd: RepoRelativePathSchema.optional(),
+      timeoutSec: z.number().int().min(1).max(1800),
+    }),
   ),
```

Once accepted, `HarnessCheckList` (HarnessPanel.tsx) renders `argv.join(' ')` in `<code>` and the
timeout; a ~10-line change.

## Completion report (AGENTS.md §9)

1. **Summary:** the new project wizard (`#/projects/new`, 5 steps: existing folder or new git repo;
   how agents work; pre-approved actions; context files; harness with "Create a ‘Build the
   harness’ ticket") and project settings (`#/projects/:id/settings`: AI work environment form,
   harness card with Run checks now and results, danger-zone note), built against the P4-0 DTOs with
   typed client functions and fixture tests.
2. **Files:**
   - created: `packages/web/src/features/project-setup/{NewProjectWizard,ProjectSettings,SourceStep,SetupSections,HarnessPanel,fields}.tsx`,
     `{setup-form,actions}.ts`; `packages/web/tests/features/project-setup.test.tsx`,
     `project-setup-logic.test.ts`; `packages/web/tests/fixtures/project-setup.ts`;
   - modified (add-only sections / route additions): `src/lib/api.ts` (plus `ApiClient.put`),
     `src/lib/copy.ts`, `src/lib/router.ts`, `src/app/App.tsx`, `src/app/Shell.tsx` (nav match),
     `src/features/project/ProjectPage.tsx` (Settings button); this file.
3. **Checks (2026-10-15):** `pnpm check` exit 0: format ✓ lint ✓ typecheck ✓ test 1389/1389 ✓ (core 233, orchestrator 308, demo 12, claude-code 252, db 117, web 248, server 219) build ✓. E2E: `ACP_E2E_PORT=7511 ACP_E2E_CONTROL_PORT=7521 pnpm --filter @acp/web test:e2e` → 11 passed.
4. **Acceptance:**
   - both creation paths → met (tests "adds an existing folder…", "creates a new repository…",
     refusal test);
   - agent setup (helpers 1–6, depth 1–2, budget, model, ticket prefix; plan first fixed on) → met;
   - allowlist → met (with the "takes effect once the project has a harness" note);
   - context-file picker with the 10-file / 32 KB limits counted live → met;
   - harness status with explanation and problems; "Create 'Build the harness' ticket" → met;
   - settings: same sections editable with Save/Undo, harness card, Run checks now with results
     (status word, duration, exit code, output tail), danger zone → met, **except** commands and
     timeouts in the check list (contract gap above);
   - sentence validation; mutations with CSRF → met (tests assert the header);
   - screenshots light/dark at 1440 and 1024 → taken and reviewed:
     a temp scratch folder (`p4f-shots/`)
     (`wizard-{1-source,2-agents,3-allowlist,4-context,5-harness}-{light,dark}-{1440,1024}.png`,
     `settings-{light,dark}-{1440,1024}.png`).
5. **Assumptions:** error codes for `POST /api/projects/new` and the `{}` bodies (handoff notes);
   the wizard saves the setup once on leaving step 4; the danger zone is a note only, because no
   remove-project route exists (it says so, rather than showing a button that can't work).
6. **Contract changes proposed:** the harness check fields above. Shared-file edit made: `put` on
   `ApiClient` in `lib/api.ts`.
7. **Gaps:** command/timeout display (contract); `#/board` and `#/tickets` links depend on P4-E/G;
   nothing links to the wizard until P4-E adds "New project"; the server routes are P4-D's, so
   the pages are verified against fixtures only.
8. **Next:** P4-D implements the routes; P4-H's e2e drives the wizard (create a repo → setup →
   harness ticket).
