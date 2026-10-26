# G-E

> Progress file for G-E. Only its agent edits it. Plan: [../README.md](../README.md), Part 2;
> decision: [ADR-0025](../../decisions/0025-code-hosting-and-branching.md) §7.

| Field  | Value          |
| ------ | -------------- |
| Status | review         |
| Branch | wp/g-e-connect |

## Tasks

- [x] E1 Server: `POST /api/projects/:id/code-host/repository` (CSRF, `CreateRepositoryRequest`)
      in `code-host/service.ts` (`createRepository`), `code-host/github.ts` (`login`,
      `createRepository`), the board service (`createCodeHostRepository`) and
      `routes/board.ts`. Answers the fresh `CodeHostStatusDto`.
- [x] E2 Server: `POST /api/projects/:id/code-host/remote` (CSRF, `ConnectRepositoryRequest`):
      `connectRepository`, `connectCodeHostRepository`. Answers the fresh `CodeHostStatusDto`.
- [x] E3 Server tests: `tests/code-host/connect.test.ts` (fake `gh` in memory, local bare
      repositories for pushes), `tests/code-host/remote-runner.test.ts` (the real runner with a
      fake `gh` script recording argv, env and cwd), `tests/board/code-host-connect.test.ts`
      (routes).
- [x] E4 Web: the GitHub card in Settings (`features/branching/CodeHostCard.tsx`, new
      `ConnectRepository.tsx`, rules in `code-host.ts`), `lib/api.ts` and `lib/copy.ts`
      (`CODE_HOST_CONNECT_COPY`), additions only.
- [x] E5 Web tests: `tests/features/branching-logic.test.ts`, `tests/features/branching.test.tsx`,
      `e2e/github.spec.ts` (two new specs, one updated), screenshots with `ACP_SCREENSHOT_DIR`.
- [x] E6 Progress file, report.

## What the server runs

All argument arrays through `execFile` (no shell). `gh` with `GH_PROMPT_DISABLED=1`,
`GIT_TERMINAL_PROMPT=0` and the other no-prompt flags of `cliEnv`, a time limit each
(`GH_TIMEOUTS`); git through the workspace runner (`GIT_TERMINAL_PROMPT=0`, 120 s) with
`SAFE_GIT_CONFIG` (`core.hooksPath=/dev/null`, no fsmonitor, no submodule recursion).

Create (in this order; everything that can refuse runs before the repository exists):

1. `git remote` in the project root: `origin` listed → 409 `origin_exists`; not a repository →
   409 `not_a_git_repository`.
2. `gh --version` and `gh auth status --hostname=github.com` (exit codes only) → 409
   `code_host_not_ready` with the step to take.
3. With `push: true`: `git symbolic-ref --quiet --short HEAD` (fails → 409 `detached_head`) and
   `git rev-parse --verify --quiet HEAD^{commit}` (fails → nothing to push, the push is skipped).
4. Owner absent: `gh api --hostname=github.com user --jq=.login`, checked with
   `GitHubOwnerSchema` (else 502 `gh-failed`).
5. `gh repo create <name> --private|--public` (owner given: `<owner>/<name>`; a name starting
   with `-` goes as `<account>/<name>` so it can't read as an option). Never `--source`,
   `--push` or `--clone`. Run in the OS temp folder, not the project root, so gh can't see the
   checkout. Output not read: exit 0 is success; non-zero → 422 `repository_create_failed`
   ("GitHub refused to create the repository: it may already exist, or the name is not
   allowed."); timeout → 504 `timeout`; not found → 409 `code_host_not_ready`.
6. `git remote add origin https://github.com/<owner>/<name>.git` (`gitHubRemoteUrl`, https).
   Failure → 500 `remote_add_failed` ("GitHub created <owner>/<name>, but the app could not set
   it as origin. In the project folder, run: git remote add origin …"); an `origin` added
   meanwhile → 409 `origin_exists`, left as it is.
7. With a branch to push: the existing hook-free push, `git -c push.recurseSubmodules=no push
--set-upstream --no-verify origin refs/heads/<b>:refs/heads/<b>` (the same as
   `git push --no-verify -u origin <b>`, written so the branch can't read as an option). Failure
   keeps its code (`push-rejected` 409, `timeout` 504) with "GitHub created <owner>/<name> and it
   is now the project's origin, but pushing <b> did not work." before the reason.
8. The status, as `GET …/code-host`.

Connect: `parseGitHubRepository` (null → 422 `invalid_repository`, before git runs), `git remote`
(→ `origin_exists` / `not_a_git_repository`), `git remote add origin <gitHubRemoteUrl(parsed)>`
(the address rebuilt from owner and name, in the protocol typed; never the typed text), then the
status. Nothing is pushed and `gh` isn't needed. A body outside the request schema is 400
`invalid_request` (zod, as every route).

## Work log

| Date       | What                                          | Commit    | Checks                                                                                          |
| ---------- | --------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------- |
| 2026-10-23 | Server: create and connect, tests             | `43a8fa7` | typecheck(server) ✓ lint ✓ prettier ✓ vitest code-host + board connect + pull-request 66/66 ✓   |
| 2026-10-23 | Web: the Settings card, api, copy, tests, e2e | `cf73853` | typecheck(-r) ✓ lint ✓ prettier ✓ vitest branching ×2 + invalidation 82/82 ✓ e2e github 10/10 ✓ |
| 2026-10-23 | Progress file, status review                  | this one  | docs only                                                                                       |

## Decisions and findings

- **Order of the card's steps:** the CLI first (install, then sign in), then origin. A project
  with a GitHub origin and no `gh` shows the install step; connecting an existing repository
  would work without `gh`, but the brief puts installing first and the pull request needs it
  anyway. Check again stays on every step (an origin added in a terminal shows on it).
- **No owner → `<name>` alone,** as the brief says, with the account read first (step 4) so the
  `origin` address never comes from gh's free-form output, and a failure to read it leaves
  nothing created.
- **gh runs in the temp folder** for `api user` and `repo create`; the status checks keep running
  in the project root as before.
- **Push now** reuses the pull request push (same flags, hooks off); a detached HEAD is refused
  before the repository is created, an unborn branch is simply not pushed.
- **Codes:** the G-E codes are snake_case as named in the brief (`origin_exists`,
  `code_host_not_ready`, `invalid_repository`, `repository_create_failed`, `remote_add_failed`,
  `detached_head`, `not_a_git_repository`); the seven G-A codes keep their kebab-case names.
- **Web wording:** each code has its own sentence in `CODE_HOST_CONNECT_COPY.errors`; for
  `remote_add_failed`, `detached_head`, `push-rejected` and `timeout` the server's own sentence
  (the app's words, with the repository and the command) is shown as it comes.
- **After a click** the answered status is shown at once and the status is read again (also after
  a failure: the repository may exist although a later step failed). Focus goes to the error
  alert, or to the connection line on success.
- **Default name:** the project folder's last path part, other characters to `-`, no leading or
  trailing `-`/`.`, no `.git`, at most 100; empty when nothing is left (the owner types one).
- **"Push the current branch now"** says "current branch", not its name: no API tells the web the
  project folder's branch (see the proposal below).

## Proposed (not made)

- `CodeHostStatusDto.originUrlKind` or a boolean `hasOrigin`: today a non-GitHub `origin` and no
  `origin` both read `provider: null`, so the card offers Create/Connect and the server answers
  `origin_exists` (said plainly). A field would let the card say "origin is not on GitHub" up
  front. Affects `@acp/core/api` (coordinator) and G-A/G-B readers; additive.
- `CodeHostStatusDto.currentBranch` (nullable) so the checkbox can read "Push main now".
- `packages/web/DESIGN.md` ("Branching and GitHub") could mention the connect steps; not in G-E's
  paths.
