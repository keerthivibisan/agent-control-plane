# P4-C — Harness: manifest, context files, check runner

> Progress file for P4-C. Only the agent working on P4-C edits this file (coordinator: STATUS.md).
> Protocol: `docs/phase-4/README.md` §9. Scope, owned paths and acceptance: README §8.

| Field   | Value             |
| ------- | ----------------- |
| Status  | review            |
| Owner   | harness agent     |
| Branch  | `wp/p4-c-harness` |
| Started | 2026-10-13        |
| Updated | 2026-10-15        |

## Tasks

- [x] Manifest reader/validator → HarnessStatus with plain-sentence problems
- [x] Context-file reader (realpath inside repo, ≤10 files, ≤32 KiB total)
- [x] Check runner: no shell, bare argv[0], timeouts with kill, output tail ≤16 KiB redacted, filtered env, sequential
- [x] Run on main via temporary detached worktree (uses src/workspace)
- [x] Tests with temp git repos and tiny scripts; pnpm check green (see report §3 for the load caveat)

## Work log (append-only; newest last)

| Date       | What was done                                                                                                                                       | Commit        | Checks                                                                                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-13 | Claimed P4-C; branch `wp/p4-c-harness` created from `main`                                                                                          | (this commit) | —                                                                                                                                                  |
| 2026-10-13 | WIP checkpoint after a usage-limit interruption: harness module source (manifest, context, output tail, runner, main checks); tests not written yet | (this commit) | lint ✓ typecheck ✓ (server); tests pending                                                                                                         |
| 2026-10-15 | Coordinator saved the uncommitted harness tests as `df11548` after a second interruption                                                            | df11548       | not checked                                                                                                                                        |
| 2026-10-15 | 30 s suite timeouts for process-spawning harness tests; tasks done; completion report; status `review`                                              | (this commit) | format ✓ lint ✓ typecheck ✓ test: harness 42/42, server 261/261 standalone, other packages all pass (web 226/226) ✓ build ✓; see report §3 on load |

## Handoff notes

For **P4-D** (everything is exported from `packages/server/src/harness/index.ts`):

- **Harness status:** `readHarness(root)` returns `{ status, manifest }` (`manifest` is null unless
  the status is ready or partial). Cache it in memory per project, as README §6.5 says.
- **Which manifest to use for an agent's checks:** read it from the **project's checkout**
  (`readHarness(projectRoot)`), not from the agent's worktree, and run the checks with
  `root: ws.path`. A manifest the agent edited is code under review. It must not choose what runs
  automatically when the run enters review. ("Run checks now" reads the manifest from the
  committed HEAD in its temporary checkout.)
- **Context:**
  `readContextFiles(projectRoot, contextPathsFor(setup.contextFiles, manifest), { notes: manifest?.notes })`.
  Pass `.context` as `ManagedAgentSpec.context` only when it is non-empty. The whole string is
  ≤ `MAX_CONTEXT_BYTES`. Show `problems` in the setup UI and in diagnostics.
- **Context picker:** `listContextCandidates(projectRoot)` returns `ContextCandidateDto[]` for
  `GET /api/projects/:id/context-candidates`.
- **Agent checks:** create one `createCheckRunner()` per server and share it. It serialises every
  `run()` call, which gives the ADR-0017 "one at a time" rule across runs. Persist each `CheckRun`
  (P4-B `check_runs`), and use `onResult` for SSE progress. Pass the run's `AbortSignal` so Stop
  ends the running check.
- **Run checks now:** `createMainChecks({ dataDir, runner })`. Call `cleanupOrphans()` once at
  start, next to the workspace manager's cleanup.
- **Errors:** `HarnessError` codes are `invalid-root`, `not-a-git-repo`, `no-commits` and
  `git-failed`. A failing check is never thrown; it comes back as a `CheckRun` status.
- **Fresh worktrees have no installed dependencies** (`node_modules`). A manifest whose checks need
  them should start with an install check, e.g. `["pnpm", "install", "--frozen-lockfile"]`.
  Consider adding this hint to `HARNESS_TICKET_TEMPLATE` (P4-0 owns it).

## Blockers / proposed contract changes

_None._

**Note for review (ADR-0017 wording):** checks are started with
`child_process.spawn(argv[0], argv.slice(1), { shell: false, detached: true })`, the primitive
`execFile` itself uses, not with `execFile`. The reasons:

- `execFile` buffers all output up to `maxBuffer` and kills the check when it goes over. We keep
  only a streamed 16 KiB tail instead.
- `execFile` cannot start a process group, so a timeout would leave grandchildren running (test
  workers, for example) and holding the pipes open.

The safety properties are the same: an argument array, no shell, and a bare `argv[0]` resolved
through `PATH`. Tests assert `shell: false` and the exact file and argument split. If the
coordinator wants the ADR text to say "spawn/execFile without a shell", that is an ADR-0017
wording amendment. No code change is needed.

## Completion report (AGENTS.md §9)

1. **Summary:** the server harness module is done.
   - The manifest reader and validator turn problems into plain sentences.
   - The context-file reader follows realpath containment, with at most 10 files and 32 KiB in
     total. There is also a context-candidate lister.
   - The check runner uses no shell and a bare argv[0]. It enforces timeouts with a process-group
     kill and runs checks one at a time. It keeps a redacted, ANSI-stripped output tail of at most
     16 KiB and filters out `ACP_*` and `GIT_*` variables.
   - "Run checks now" uses a temporary detached worktree of HEAD and orphan cleanup.
2. **Files** (all created):
   - `packages/server/src/harness/{index,errors,paths,manifest,context,output,runner,main-checks}.ts`;
   - `packages/server/tests/harness/{manifest,context,runner,main-checks}.test.ts`;
   - this progress file (modified).
3. **Commands and results** (Node 22.21.1, pnpm 10.26.1):
   - `pnpm format:check` ✓, `pnpm lint` ✓, `pnpm typecheck` ✓, `pnpm build` ✓.
   - Tests:
     - harness 42/42 ✓;
     - core 233/233 ✓, orchestrator 308/308 ✓, adapter-demo 12/12 ✓, claude-code 252/252 ✓,
       db 117/117 ✓, web 226/226 ✓;
     - server 261/261 ✓ when run alone (load average about 4).
   - Under machine load (load average 16–25), the combined `pnpm check` and some server reruns
     failed in **pre-existing** tests that this WP does not touch:
     - `workspace/manager`, `control/*`, `verification/*` timed out at 5 s;
     - the `smoke.test.ts` ingestion assertion failed. It passed when rerun alone (2/2).

     The web suite also had vitest worker-start timeouts. Nothing in `src/` imports the harness
     module yet, so it cannot affect those tests.

   - One harness test (the output cap) timed out once under that load. The harness suites that
     spawn processes now have a 30 s timeout.
4. **Acceptance:**
   - Manifest reader and validator, with plain-sentence problems: **met** (`manifest.test.ts`, 13
     tests: none, ready, partial, invalid JSON, BOM, schema sentences, untrusted id not quoted,
     symlink escape, oversized file, folder, root errors).
   - Context reader: **met** (`context.test.ts`: order and headers, notes, symlinks out of the repo
     refused, `..` and absolute paths refused, binary files skipped, the 10-file cap, the 32 KiB
     total cap with a cut on a UTF-8 boundary, candidates).
   - Check runner: **met** (`runner.test.ts`):
     - a spawn spy asserts `shell: false` and the exact argv;
     - shell metacharacters reach the check as literal arguments;
     - a path, an absolute path or `"sh -c"` as argv[0] is refused without starting anything;
     - a command missing from PATH is reported;
     - cwd stays inside the checkout (symlink escape refused);
     - the environment is filtered;
     - the output tail is ≤ 16 KiB, redacted, with ANSI codes removed;
     - a timeout kills the grandchild (checked by pid);
     - concurrent calls are serialised;
     - abort stops the running check and skips the rest.
   - Run on main: **met** (`main-checks.test.ts`):
     - it uses the committed HEAD, not the owner's dirty tree, and leaves no build output in the
       owner's tree;
     - it runs in a detached worktree under `<dataDir>/harness-checks`, removed afterwards (also
       when stopped);
     - every git call carries `SAFE_GIT_CONFIG`;
     - it works when the project is a subfolder of its repository;
     - errors are typed;
     - orphan cleanup works.
5. **Assumptions:**
   - "Main branch" means the project repository's current HEAD commit, matching the workspace
     manager's base.
   - None and partial statuses carry an explanatory sentence in `problems`; ready carries none.
   - Context headers count toward the 32 KiB cap, so the result always fits
     `ManagedAgentSpec.context`.
   - `.claude/` files are never offered as candidates.
6. **Contract changes:** none. An optional ADR-0017 wording note on spawn vs execFile is above.
7. **Gaps:**
   - Checks need dependencies installed in fresh worktrees (see the handoff notes).
   - There is no status caching here (that is P4-D's).
   - A process that calls `setsid` to leave the group could survive a timeout; the pipes are
     destroyed after SIGKILL plus a grace period, so the runner never hangs.
8. **Next:** P4-D wires these into the routes and the review flow.
