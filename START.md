# Running Agent Control Plane

How to start the app, try it with sample data, and run your first ticket. To build and test from
source, see [BUILD.md](BUILD.md); you need its prerequisites (Node 22, pnpm 10.26) here too.

## Quick start

On macOS or Linux, one script does it all:

```bash
./start.sh
```

`./start.sh --demo` starts the same app with sample data.

The script:

1. switches to Node 22.21.1 with nvm (installing it if needed), or checks your Node is 22.12 or a
   later 22.x;
2. installs pnpm 10.26.1 for that Node if an older pnpm is found;
3. warns when the build tools for the SQLite driver or Claude Code are missing;
4. installs the locked dependencies;
5. stops if port 7420 or 5173 is already in use;
6. runs `pnpm dev`.

By hand, the same is:

```bash
pnpm install
```

```bash
pnpm dev
```

`pnpm dev` starts two processes in watch mode:

- **the server** on `127.0.0.1:7420`: the REST API, live updates, the hook receiver and the session
  reader;
- **the web UI** (Vite) on `127.0.0.1:5173`, which forwards every `/api` request to the server on
  port 7420.

Open **http://127.0.0.1:5173**. The first time, you land on **All projects**, where you add your
first project. After that, the app opens the board of the project you used last.

Both processes listen on `127.0.0.1` only, so nothing outside your computer can reach them. Stop
them with Ctrl+C.

> In development the UI always forwards to port 7420 and always uses port 5173. If you change
> `ACP_PORT`, use the built app below instead.

## Running the built app

```bash
pnpm build
```

```bash
pnpm --filter @acp/server start
```

The built server (`node dist/main.js`) serves the API and the built UI from `packages/web/dist` on
the same port, so open **http://127.0.0.1:7420** (or the port in `ACP_PORT`). There is no separate
UI process. If `packages/web/dist` is missing, the server runs the API only.

## Try it with sample data (demo mode)

```bash
ACP_MODE=demo pnpm dev
```

Demo mode shows two sample projects (`demo-api` and `demo-web`) with sample Claude Code sessions,
helper agents and token usage. A banner on every page says you are looking at sample data.

- It uses its own database file, `demo.sqlite`, rebuilt from scratch on every start. Your real
  database (`acp.sqlite`) is never opened.
- It does not read your Claude Code data, accepts no hooks, and starts no agents. Creating and
  running tickets is turned off.

To keep demo data away from your data folder entirely, point it at a temporary one:

```bash
ACP_MODE=demo ACP_DATA_DIR="$(mktemp -d)" ACP_PORT=7451 pnpm --filter @acp/server start
```

(after `pnpm build`), then open http://127.0.0.1:7451.

## Configuration

Set these as environment variables when you start the server. Invalid values stop the server at
start with a message naming the variable.

| Variable               | Default                                | Meaning                                                                              |
| ---------------------- | -------------------------------------- | ------------------------------------------------------------------------------------ |
| `ACP_PORT`             | `7420`                                 | the server's port; it always binds `127.0.0.1`                                       |
| `ACP_DATA_DIR`         | `~/.agent-control-plane`               | where the app keeps its database, hook token and agent workspaces                    |
| `ACP_CLAUDE_DIR`       | `$CLAUDE_CONFIG_DIR`, else `~/.claude` | the Claude Code data folder to read (read-only)                                      |
| `ACP_MODE`             | `live`                                 | `live`, or `demo` for sample data                                                    |
| `ACP_MANAGED`          | on in live mode, off in demo mode      | `off` turns managed agent runs off; the app then only observes sessions              |
| `ACP_POLL_INTERVAL_MS` | `5000`                                 | how often session files are checked for new records                                  |
| `ACP_ACTIVE_WINDOW_MS` | `120000` (2 minutes)                   | a session with activity this recent counts as running                                |
| `ACP_STALE_AFTER_MS`   | `1800000` (30 minutes)                 | a session idle this long counts as inactive; must be at least `ACP_ACTIVE_WINDOW_MS` |
| `ACP_RUN_TIMEOUT_MS`   | `7200000` (2 hours)                    | a managed run still working after this long is stopped                               |

## Where your data lives

Everything the app stores is in `ACP_DATA_DIR` (default `~/.agent-control-plane`, created with
access for your user only):

| Path                                                                      | What                                                                     |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `acp.sqlite` (with `-wal` and `-shm`)                                     | the database: projects, sessions, token usage, tickets, runs             |
| `demo.sqlite`                                                             | demo mode's database, rebuilt on every demo start                        |
| `hook-token`                                                              | the secret that Claude Code hooks must send (readable by your user only) |
| `worktrees/`, `ticket-checkouts/`, `review-checkouts/`, `harness-checks/` | temporary git checkouts for agents and checks                            |

The app makes no automatic backups.

**What it stores.** Ids, names, models, timestamps, statuses and token counts. It does not store
your conversations with Claude Code. The exceptions are text you write in the app or that agents
write for you there: your chat with a run's lead agent, and plans, review findings and lead notes
kept as ticket comments. Diffs and tool output are never stored.

**What it reads.** Claude Code's session files under `~/.claude/projects` (or `ACP_CLAUDE_DIR`),
read-only. It reads the first 64 KB of each session file to find the folder the session ran in,
and reads the rest only for folders you added as projects. It never reads Claude Code's credentials
(`~/.claude/sessions/`), settings files or history, and never changes them. See
[docs/security.md](docs/security.md) and
[docs/provider-adapters.md §3](docs/provider-adapters.md#3-file-access-allowlist-security-critical).

**What it writes in your projects.** Only on your actions: a new repository when you create one,
skill and agent files under `.claude/skills/` and `.claude/agents/` from the Skills & Agents page,
the ticket branch (named by the project's branching strategy, `acp/<KEY>` without one) when you
approve a plan, and the final merge into the ticket's target branch when you merge a ticket (or a
push to `origin` when you open a pull request). Agents never write in your own working folder; each helper works in its own git
worktree under `ACP_DATA_DIR`.

The app makes no network calls of its own: no telemetry and no update checks. Managed runs start
Claude Code, which talks to Anthropic as it always does.

## Optional: live updates through Claude Code hooks

Everything works without hooks. With them, "Waiting for you" and ended sessions show up at once
instead of after the next check. The app never edits your Claude Code settings; you add the hooks
yourself:

1. Print the hook settings (with the same `ACP_PORT` and `ACP_DATA_DIR` as the server):

   ```bash
   pnpm --filter @acp/server hooks:snippet
   ```

2. Paste the printed `hooks` block into your own Claude Code settings file.
3. Set the `ACP_HOOK_TOKEN` environment variable, where Claude Code runs, to the contents of
   `hook-token` in the app's data folder. The command above prints that file's path.
4. Start a new Claude Code session. The app shows "Connected" under **Data health → Connection**
   after the first hook arrives.

The same steps, with copy buttons, are on the **Data health → Connection** page.

## First steps

1. **Add a project.** On **All projects**, choose **New project**. Add a git repository that is
   already on your computer, or let the app create a new, empty one. The setup then asks how agents
   work (ticket prefix, helpers at once, budget per agent, model), which actions are pre-approved,
   which context files agents read, and the harness checks.
2. **Set the workflow.** On **Workflow**, start from a template or draw your own graph: a planner,
   the lead, helpers, reviewers, a tester and Checks blocks. Each agent block has its own model,
   effort, skills, agent file and approval mode (Manual, Auto edits, Auto or Full auto).
3. **Create a ticket.** On **Board**, choose **New ticket** and describe the work.
4. **Start a run.** Use the card's **Move** menu (**Start**), or **Start** on the ticket page.
   **Start with options…** changes the approval mode, reviewer or rework rounds for this run only.
5. **Approve the plan.** The lead agent (or a separate planner, if your workflow has one) proposes a
   plan on the ticket page. Approve it, or ask for changes. Approving creates the ticket's branch,
   and the lead starts helper agents. In Full auto, the plan is approved for you.
6. **Follow the run.** The ticket page shows every agent, each change and its review, and anything
   that needs your decision.
7. **Merge once.** When the run is done, review the combined change on **Files changed** and its
   checks, then merge the ticket branch into its target, or push it and open a pull request.

**GitHub is optional.** Pull requests need the GitHub CLI, `gh`, installed and signed in on this
computer (`gh auth login`). The app uses that login and never reads or stores a token. Connect or
create the project's repository in its **Settings** (the GitHub card), and choose a branching
strategy under **Branches**. Everything else works without `gh`.

**Managed runs need Claude Code's sign-in.** The app starts Claude Code through the Claude Agent
SDK, which uses your own Claude Code login (or API key) on this computer. Runs use your account and
count toward your Claude usage or Anthropic API billing. Sign in to Claude Code before your first
run. To use the app for observing sessions only, set `ACP_MANAGED=off`.

## Stopping and upgrading

- **Stop:** Ctrl+C in the terminal running `pnpm dev` or the server. Running agents are stopped with
  the server. After the next start, nothing relaunches by itself: an interrupted run waits for you
  on its ticket page.
- **Upgrade:**
  1. Stop the app.
  2. Back up the database: copy `acp.sqlite` and, if present, `acp.sqlite-wal` and `acp.sqlite-shm`
     from `ACP_DATA_DIR` to a safe place.
  3. Update the code (`git pull`), then run `pnpm install` and, for the built app, `pnpm build`.
  4. Start the app. Database migrations run automatically on start.

Before 1.0.0, features and data formats may still change between releases; see
[CHANGELOG.md](CHANGELOG.md).
