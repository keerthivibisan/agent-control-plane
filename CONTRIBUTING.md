# Contributing

Thanks for helping. This project is built by humans and AI coding agents working in parallel. The
process below keeps that safe.

## Before you start

1. Read [AGENTS.md](AGENTS.md). It holds the binding rules for everyone, not just agents.
2. Pick a work package (WP) from [docs/implementation-plan.md](docs/implementation-plan.md), or an
   issue linked to one. For work not in the plan, open an issue first.
3. Set up the toolchain: [docs/development.md](docs/development.md).

## Workflow

1. **Branch** from `main`. Use `wp/<wp-id>-<slug>` for planned work, for example
   `wp/p1-b-persistence`. Use `fix/<slug>` or `docs/<slug>` otherwise. For concurrent agents, use one
   git worktree per branch.
2. **Stay in scope.**
   - Edit only the paths your WP owns.
   - Shared files (root configs, lockfile, dependency lists, v1 contracts, migrations, ADRs) change
     only through the coordinator (AGENTS.md §5).
3. **Test.**
   - Every behavior has a test.
   - Fixtures are sanitized (`test-fixtures/claude-code/README.md`).
   - Never use real `~/.claude` data in tests.
4. **Check.** `pnpm check` must pass locally. CI runs the same steps.
5. **Commit at each checkpoint**, meaning each finished WP task with `pnpm check` passing. Use
   Conventional Commits with a package scope (`feat(core): …`, `fix(db): …`, `docs: …`). The body
   says what changed, why, which WP task it implements, the tests added, and a `Checks:` line with
   the actual results.
6. **Open a pull request** using the template. Include the completion report from AGENTS.md §9.

## Pull request requirements

- [ ] Linked WP or issue.
- [ ] `pnpm check` passes; the output summary is in the PR.
- [ ] Docs updated, with **[planned]** changed to **[implemented]** only for verified behavior.
- [ ] No shared-file changes, unless approved by the coordinator.
- [ ] No conversation content, credentials, or real transcripts committed.
- [ ] New provider facts are documented with version and evidence.

## Architectural decisions

A decision that is costly to reverse, or that constrains other packages, needs an ADR:

1. Copy `docs/decisions/0000-template.md` to the next number, with status `proposed`.
2. Include context with evidence, the decision, alternatives, and consequences.
3. The coordinator (a maintainer) accepts or rejects it. Implementation waits for acceptance.

## Reporting security issues

Don't open a public issue. See [SECURITY.md](SECURITY.md).

## Code of conduct

[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) applies to all project spaces.
