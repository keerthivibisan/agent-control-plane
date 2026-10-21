#!/usr/bin/env bash
# Start Agent Control Plane locally (server on 127.0.0.1:7420, web UI on http://127.0.0.1:5173).
# Usage: ./start.sh           -> your real Claude Code data
#        ./start.sh --demo    -> sample data only, in a separate demo database
# See START.md for what it starts and BUILD.md for the prerequisites.
set -euo pipefail

REQUIRED_NODE="22.21.1"   # matches .nvmrc
REQUIRED_PNPM="10.26.1"   # matches packageManager in package.json

cd "$(dirname "$0")"

say()  { printf '\033[1m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mWarning:\033[0m %s\n' "$*"; }
fail() { printf '\033[31mError:\033[0m %s\n' "$*" >&2; exit 1; }

case "${1:-}" in
  ""|--demo) ;;
  -h|--help) sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) fail "Unknown option: $1 (use --demo or --help)" ;;
esac

[ -f package.json ] && [ -f .nvmrc ] || fail "Run this from the agent-control-plane repo root."
command -v git >/dev/null || fail "git is required."

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
NODE_MINOR="$(echo "$NODE_VERSION" | cut -d. -f2)"
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

# 4. Dependencies (exact versions from the lockfile)
say "Installing dependencies"
pnpm install --frozen-lockfile

# 5. Ports
for port in 7420 5173; do
  if command -v lsof >/dev/null && lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    fail "Port $port is already in use. Stop whatever is using it (another copy of the app?) and rerun."
  fi
done

# 6. Claude Code is only needed for agent runs, not for browsing sessions or the demo
command -v claude >/dev/null || warn "Claude Code (claude) not found: you can look around, but ticket runs need Claude Code installed and signed in."

# 7. Start
if [ "${1:-}" = "--demo" ]; then
  export ACP_MODE=demo
  say "Demo mode: sample data only, kept apart from your real data"
fi
say "Starting. Open http://127.0.0.1:5173 (Ctrl+C to stop)"
exec pnpm dev
