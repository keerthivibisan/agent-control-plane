# F-1: why a sandboxed Full auto helper could move refs (2026-10-24)

## The question

On 2026-10-24 the owner's ticket ACPGIT-3 ran in Full auto with the OS sandbox on. A helper ran
`git checkout -b feature/ACPGIT-3-branding dev` and `git commit` in its worktree. The ticket
branch's reflog showed two commits by helpers, and both helper worktrees ended up on the ticket
branch. The facts came from the app's API and read-only git; the agent that wrote this note did
not look at the owner's data.

ADR-0022's sandbox only allows writes to `[worktree, run temp]`. It denies writes to
`<worktree>/.git` and `<worktree>/.claude`. So how did git write objects and refs into the
repository's real `.git`?

## Method

The checks below are reads only. Real `claude` was not run.

- The SDK's types were read from `node_modules`: `@anthropic-ai/claude-agent-sdk@0.3.296`,
  `sdk.d.ts`.
- The bundled CLI was read too:
  `@anthropic-ai/claude-agent-sdk-darwin-arm64@0.3.296/claude`, a 240 MB Bun-compiled binary.
  It was never executed. Its embedded JavaScript was extracted with `strings -n 8` and searched
  by identifier. Offsets below are into that strings dump. Names are minified, so they are
  quoted only to locate the code.

## Finding 1: Claude Code makes a linked worktree's common git directory writable

The sandbox's filesystem config is built from the settings. The code is near offset 18 852 961.

1. The working directory is `he`, the session's original cwd.
2. `Ze = FHn(he)` is computed (offset 18 897 260).
3. `Ru(he, true, Ze)` calls `me.push(ge)`. Here `me` is the `allowWrite` list and `ge` is the
   value from `FHn`.

`FHn(cwd)` works like this:

1. It reads `<cwd>/.git`. When that is a `gitdir: <path>` pointer, it checks that the target's
   parent folder is named `worktrees` and sits inside a folder ending in `.git`.
2. It reads `<gitdir>/gitdir` and checks that it points back at `<cwd>/.git`.
3. It returns the **common git directory**: the repository's real `.git`.

So for a linked worktree, Claude Code **adds the main repository's `.git` to the sandbox's
writable paths by itself**.

It then calls `Ea(ge, …)`. That adds deny-writes for a fixed list inside that folder:

- `hooks`, `config`, `config.lock`, `config.worktree(.lock)` and `commondir`;
- `objects/info/alternates`;
- each `worktrees/*/config.worktree` and `worktrees/*/commondir`.

Nothing else is denied. These stay writable:

- `HEAD`, `refs/**`, `logs/**`, `objects/**` and `packed-refs`;
- the worktree's private `worktrees/<name>/HEAD` and `index`.

That is exactly what `git checkout -b`, `git switch`, `git commit` and `git reset` need. They
all worked inside the sandbox.

Our `denyWrite: [<worktree>/.git]` only covers the worktree's one-line pointer **file**. It never
covered the repository's `.git`.

Our settings and Claude Code's grant are merged in the sandbox runtime. Our
`filesystem.denyWrite` entries become `denyWithinAllow` (`Cb()` near offset 18 786 355; on macOS
the seatbelt profile from `a5(...)`). So a deny we add for those folders applies inside Claude
Code's own grant.

**Fix (F-1 §1b):**

- The server resolves `git rev-parse --git-dir --git-common-dir` in the worktree at spec time:
  absolute, and also as real paths. The result goes in `FullAutoSpec.gitDirs`.
- The adapter adds both folders to `filesystem.denyWrite` and to `Edit(//<dir>/**)` deny rules.
- Helpers never need to write there, because the app seals (commits) outside the sandbox.

**To confirm in a consented real run:**

- a sandboxed `git commit` in a helper worktree fails with a sandbox violation;
- `git status` and `git diff` still work. Git's optional index refresh fails silently when it
  cannot write `index.lock`.

## Finding 2: PreToolUse hooks run before the permission pipeline, in every mode

These types are in `sdk.d.ts`:

- `Options.hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>`;
- `HookCallbackMatcher { matcher?, hooks: HookCallback[], timeout? }`;
- `PreToolUseHookSpecificOutput.permissionDecision?: 'allow' | 'deny' | 'ask' | 'defer'`.

The tool runner works like this in the binary:

1. `Dsr(...)` (offset 23 422 031) runs the PreToolUse hooks. It yields a `hookPermissionResult`
   of `{ behavior: 'deny', decisionReason: { type: 'hook' } }` for a hook's `deny`.
2. `_Wo(...)` (offset 23 418 506) takes that result. On `e?.behavior === "deny"` it returns the
   denial **before** it calls the permission function. That function holds the mode logic: auto
   mode's classifier, `canUseTool`, and rules.

A hook's `allow` still loses to a deny rule ("Hook returned 'allow' … but deny rule overrides").

Hooks are skipped in only two cases (`iM(tool, bareFork, settingsHooksOff)`):

- internal non-MCP tools;
- isolated side queries (`bareFork` / `settingsHooksOff`).

`settingSources: []` does not turn SDK callback hooks off. They come over the control protocol,
not from settings files.

So a PreToolUse hook that denies applies in `default`, Auto edits and `auto` mode alike.

**Fix (F-1 §1a):** every worker and tester gets three layers.

- A PreToolUse hook on `Bash` that denies branch-managing git commands. It never answers
  `allow`, so the gate still decides everything else.
- The gate (`canUseTool`) denies the same commands without asking the owner. This layer covers
  modes where the request reaches the gate.
- `disallowedTools` prefix deny rules such as `Bash(git checkout:*)`. Deny rules apply in every
  mode, and Claude Code checks each part of a compound command.

**To confirm in a consented real run:** a Full auto helper asked to run `git checkout -b x` gets
the hook's message as the tool error, and the ref does not move.

## What is denied (adapter `managed/branch-guard.ts`)

The guard is an allowlist. Git subcommands are allowed only when they:

- only read: `status`, `diff`, `log`, `show`, `blame`, `grep`, `ls-files`, `rev-parse` and
  similar;
- only change files and the index of the agent's folder: `add`, `rm`, `mv`, `restore`, `clean`,
  `apply`;
- are the listing forms of `branch`, `tag`, `remote`, `config --get/--list`, `worktree list`,
  `stash list/show`, `reflog`, `notes list/show` or `submodule status`.

Everything else is denied. That includes:

- `checkout`, `switch`, `commit`, `reset`, `merge`, `rebase`, `cherry-pick`, `revert` and
  `stash`;
- `push`, `pull` and `fetch`;
- branch and tag writes, `update-ref`, writing `symbolic-ref`, and `worktree add/remove/move`;
- `am`, `bisect`, `gc`, `init` and `clone`;
- any alias, such as `git co`;
- `-c` / `--config-env`, which could name a pager or alias program;
- `GIT_*` environment prefixes, except `GIT_PAGER=cat`.

`gh pr checkout|merge`, `gh repo sync` and `gh api` are denied too.

The command is read the way a shell splits it:

- quotes, escapes, `;`, `&&`, `||`, `|`, `&` and newlines;
- subshells, `$(…)` and backticks;
- `sh -c`, `bash -lc`, `eval` and `watch "…"`;
- env prefixes and wrappers such as `env`, `command`, `exec`, `time`, `nice`, `timeout`, `sudo`
  and `xargs`;
- `find -exec`;
- `git -C x`, `--git-dir`, `--no-pager` and `-P`.

Text it cannot read that mentions git (unbalanced quotes, nesting deeper than 4) is denied.

It does **not** see programs that run git themselves, such as a script, `python -c` or a test
runner. In Full auto the sandbox's git-dir deny covers them (finding 1). In other modes, the
owner approves each command.

## Also changed (F-1)

- **Briefs.** Helpers and the tester get one line: "The app owns branches and commits. …". The
  lead and the planner are told not to plan branch steps. A deterministic check at `submit_plan`
  refuses steps with branch or commit commands, for owner-reviewed and Full auto plans alike.
- **Seal on a switched branch.** The worktree is detached where it is, and no ref moves. The
  change goes to the lead with a plain reason. The lead can discard it and start a fresh helper,
  instead of the incident's owner-only `needs-owner` loop.
- **Ticket branch moved outside the app.** The final step warns. The owner can reset the branch
  to the last reviewed commit by compare-and-swap. This is refused while any worktree has the
  branch checked out.
