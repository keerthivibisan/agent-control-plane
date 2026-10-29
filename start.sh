#!/usr/bin/env bash
# Start Agent Control Plane locally (server on 127.0.0.1:7420, web UI on http://127.0.0.1:5173).
# Usage: ./start.sh [--demo] [--restart] [-h|--help]
#   (no options)  use your real Claude Code data
#   --demo        sample data only, in a separate demo database
#   --restart     stop a copy of this repo's app that already holds port 7420 or 5173,
#                 then start; processes that do not belong to this repo are never touched
#   -h, --help    show this help
# See START.md for what it starts and BUILD.md for the prerequisites.
set -euo pipefail

REQUIRED_NODE="22.21.1"   # matches .nvmrc
REQUIRED_PNPM="10.26.1"   # matches packageManager in package.json
PORTS=(7420 5173)
STOP_WAIT_TENTHS=100      # SIGTERM grace period: 10 seconds

SCRIPT="${BASH_SOURCE[0]}"
case "$SCRIPT" in /*) ;; *) SCRIPT="$PWD/$SCRIPT" ;; esac

say()  { printf '\033[1m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mWarning:\033[0m %s\n' "$*"; }
fail() { printf '\033[31mError:\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  # The help text is the header comment block above (from line 2 to the first non-comment line).
  sed -n '2,/^[^#]/{/^#/s/^# \{0,1\}//p;}' "$SCRIPT"
}

DEMO=0
RESTART=0
for arg in "$@"; do
  case "$arg" in
    --demo) DEMO=1 ;;
    --restart) RESTART=1 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Unknown option: $arg (use --demo, --restart or --help)" ;;
  esac
done

cd "$(dirname "$SCRIPT")"
REPO_DIR="$(pwd -P)"

[ -f package.json ] && [ -f .nvmrc ] || fail "Run this from the agent-control-plane repo root."
command -v git >/dev/null || fail "git is required."

# True when process $1 was started from this repo: its command line mentions the repo directory
# or its working directory is the repo directory or below it.
belongs_to_repo() {
  local pid="$1" cmd cwd
  cmd="$(ps -o command= -p "$pid" 2>/dev/null || true)"
  case "$cmd" in *"$REPO_DIR"/*|*"$REPO_DIR") return 0 ;; esac
  cwd="$(lsof -a -nP -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1 || true)"
  case "$cwd" in "$REPO_DIR"|"$REPO_DIR"/*) return 0 ;; esac
  return 1
}

# Stop process $1 with SIGTERM and wait up to ~10s for it to exit.
stop_process() {
  local pid="$1" i
  kill -TERM "$pid" 2>/dev/null || true
  for ((i = 0; i < STOP_WAIT_TENTHS; i++)); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.1
  done
  return 1
}

check_ports() {
  local port pid cmd
  if ! command -v lsof >/dev/null; then
    warn "lsof not found: skipping the check that ports ${PORTS[*]} are free."
    return 0
  fi
  for port in "${PORTS[@]}"; do
    # More than one process can share a listening socket, so handle every PID.
    while IFS= read -r pid; do
      [ -n "$pid" ] || continue
      cmd="$(ps -o command= -p "$pid" 2>/dev/null || true)"
      if [ "$RESTART" -ne 1 ]; then
        fail "Port $port is already in use by PID $pid (${cmd:-unknown command}). Stop it, or rerun with --restart if it is another copy of this app."
      fi
      belongs_to_repo "$pid" \
        || fail "Port $port is in use by PID $pid (${cmd:-unknown command}), which does not belong to $REPO_DIR. Not touching it; stop it yourself."
      say "Stopping PID $pid on port $port"
      stop_process "$pid" \
        || fail "PID $pid (port $port) did not exit within 10 seconds after SIGTERM. Stop it yourself and rerun."
    done < <(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)
  done
}

# 1. Node 22 (via nvm when available)
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  set +u
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  say "Using Node $REQUIRED_NODE via nvm"
  nvm install >/dev/null   # reads .nvmrc; installs it if missing
  nvm use >/dev/null
  set -u
fi
command -v node >/dev/null || fail "Node.js not found. Install nvm (https://github.com/nvm-sh/nvm), then run this again."
NODE_VERSION="$(node --version | sed 's/^v//')"
NODE_MAJOR="${NODE_VERSION%%.*}"
NODE_MINOR="$(cut -d. -f2 <<<"$NODE_VERSION")"
if [ "$NODE_MAJOR" != "22" ] || [ "$NODE_MINOR" -lt 12 ]; then
  fail "Node $NODE_VERSION found; this project needs Node 22.12 or a later 22.x (recommended $REQUIRED_NODE). Install nvm and rerun."
fi
say "Node $NODE_VERSION"

# 2. pnpm 10.26 (some Node installs ship an older pnpm, which the project refuses)
PNPM_VERSION="$(pnpm --version 2>/dev/null || echo none)"
case "$PNPM_VERSION" in
  10.26.*) ;;
  *)
    say "pnpm $PNPM_VERSION found; installing pnpm $REQUIRED_PNPM for this Node"
    npm install -g "pnpm@$REQUIRED_PNPM" >/dev/null \
      || fail "Could not install pnpm. Run: npm install -g pnpm@$REQUIRED_PNPM (with nvm no sudo is needed)."
    hash -r
    PNPM_VERSION="$(pnpm --version)"
    ;;
esac
say "pnpm $PNPM_VERSION"

# 3. Build tools for the SQLite driver (better-sqlite3 may compile from source)
case "$(uname -s)" in
  Darwin) xcode-select -p >/dev/null 2>&1 || warn "Xcode Command Line Tools missing. If install fails, run: xcode-select --install" ;;
  Linux)  { command -v make && command -v g++ && command -v python3; } >/dev/null 2>&1 \
            || warn "make, g++ or python3 missing. If install fails, run: sudo apt install build-essential python3" ;;
esac

# 4. Ports (checked before the slow install so a clash fails fast)
check_ports

# 5. Dependencies (exact versions from the lockfile)
say "Installing dependencies"
pnpm install --frozen-lockfile

# 6. Claude Code is only needed for agent runs, not for browsing sessions or the demo
command -v claude >/dev/null || warn "Claude Code (claude) not found: you can look around, but ticket runs need Claude Code installed and signed in."

# 7. Start
if [ "$DEMO" -eq 1 ]; then
  export ACP_MODE=demo
  say "Demo mode: sample data only, kept apart from your real data"
fi
say "Starting. Open http://127.0.0.1:5173 (Ctrl+C to stop)"
exec pnpm dev
