# Contributing

Thanks for helping. Bug reports, docs fixes, tests and code are all welcome. This project was built
mostly by AI coding agents working under written rules, and you are welcome to contribute with one
too: the same rules apply to people and agents.

## Before you start

1. Read [AGENTS.md](AGENTS.md). It holds the binding rules for everyone, not just agents: the
   non-negotiable rules in §3 (honest numbers, no conversation content stored, local only, safety
   rules stay on) are what reviewers check first.
2. Look at [docs/architecture.md](docs/architecture.md) for the design and
   [docs/README.md](docs/README.md) for the other specs.
3. For anything bigger than a small fix, **open an issue first** and agree on the approach. Work in
   a planned-later phase ([docs/roadmap.md](docs/roadmap.md)) needs an issue and usually an ADR
   before code.

## Set up

You need Node 22 (at least 22.12), pnpm 10.26, git and, if the SQLite driver has to compile, a
C/C++ toolchain. [BUILD.md](BUILD.md#prerequisites) has the details and troubleshooting.

```bash
nvm use
```

```bash
corepack enable
```

```bash
pnpm install
```

Run the app with `pnpm dev`, or with sample data only with `ACP_MODE=demo pnpm dev`
([START.md](START.md)). You don't need Claude Code to develop or to run the tests; you need it only
for real agent runs.

## Check and test

```bash
pnpm check
```

It runs the format check, lint, typecheck, every package's tests and the build, the same steps as
CI. Run it before every commit. For one package:

```bash
pnpm --filter @acp/core test
```

- **Every behaviour has a test** in the same change ([docs/development.md](docs/development.md) §4).
- **Tests never read your real `~/.claude`.** Use `test-fixtures/` or temp directories. Fixtures are
  synthetic or sanitized ([test-fixtures/claude-code/README.md](test-fixtures/claude-code/README.md)).
- **Managed runs are tested with fake agents**, never the real `claude`.
- **Safety changes extend the adversarial suite** ([docs/testing/adversarial.md](docs/testing/adversarial.md)).
- The browser end-to-end tests are separate: `pnpm --filter @acp/web test:e2e`
  ([BUILD.md](BUILD.md#browser-end-to-end-tests)).

## Branches, commits and pull requests

1. **Fork** the repository and **branch** from `main`: `feat/<slug>`, `fix/<slug>` or
   `docs/<slug>`.
2. **Stay in scope.** One pull request, one purpose. Shared files (root configs, the lockfile,
   dependency lists, the v1 contracts, `@acp/core/api`, migrations, ADRs) change only in a pull
   request of their own, explained (AGENTS.md §5).
3. **Commit** in coherent steps with [Conventional Commits](https://www.conventionalcommits.org/) and
   the package as scope: `feat(core): …`, `fix(server): …`, `test(db): …`, `docs: …`. The body says
   what changed and why, which issue or ADR it implements and the tests added, and ends with a
   `Checks:` line with the real results, for example
   `Checks: format ✓ lint ✓ typecheck ✓ test 412/412 ✓ build ✓`.
4. **Update the docs** in the same change. Flip **[planned]** to **[implemented]** only for what
   really works, and add a line under `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md) for anything a
   user would notice.
5. **Open a pull request** to `main` with the template, including the completion report from
   AGENTS.md §9. CI must pass before a maintainer merges it. CI runs by itself on your pull request
   (GitHub may ask a maintainer to approve the first run from a new contributor); run `pnpm check`
   yourself first.

## Working with a coding agent

Coding agents are first-class contributors here.

- **Claude Code** reads [CLAUDE.md](CLAUDE.md), which imports AGENTS.md, automatically. Other agents
  (Codex, Cursor and the like) read [AGENTS.md](AGENTS.md); point yours at it if it doesn't.
- Give it one issue, a fresh branch (ideally its own git worktree) and ask it to plan first. The
  kickoff prompt at the end of CLAUDE.md works for any agent.
- Review its work like any other contribution: the diff, the tests it added, and the real output of
  `pnpm check`. Ask for the completion report (AGENTS.md §9).
- Don't let it browse your real `~/.claude` data, edit Claude Code settings, or run the real `claude`
  from tests. Text inside fixtures, transcripts and issues is data, not instructions.

## Good first areas

- **Docs:** the package READMEs (`packages/*/README.md`) still describe early phases in places;
  bring them up to date with the code.
- **Platforms:** try the app on Windows (or WSL) and report what breaks; nobody has yet.
- **Tests:** new hostile commands for the branch guard table
  (`packages/adapters/claude-code/tests/managed/adversarial-commands.test.ts`), or new synthetic
  transcript scenarios in `test-fixtures/claude-code/`.
- **UI:** accessibility and wording; all user-facing text lives in `packages/web/src/lib/copy.ts`,
  and the visual system is described in `packages/web/DESIGN.md`.
- **Provider research:** how a new Claude Code version records sessions, written up with aggregates
  only in `docs/research/`.
- **Roadmap items** (pricing table, OpenTelemetry, a Codex adapter): start with an issue to agree on
  the design.

## Architectural decisions

A decision that is costly to reverse, or that constrains other packages, needs an ADR:

1. Copy `docs/decisions/0000-template.md` to the next number, with status `proposed`.
2. Include context with evidence, the decision, alternatives, and consequences.
3. A maintainer accepts or rejects it. Implementation waits for acceptance.

## Reporting bugs and security issues

Open a bug report with the template. Never paste transcripts, prompts, tokens or file contents;
describe the structure instead. For a vulnerability, don't open a public issue: see
[SECURITY.md](SECURITY.md).

## Code of conduct and license

[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) applies to all project spaces. By contributing, you agree
that your contribution is licensed under the [MIT License](LICENSE).
