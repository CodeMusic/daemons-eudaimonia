#!/usr/bin/env bash
# daemons-eudaimonia: EUDAIMONIA's first pieces, on port 4741 -- THE DASHBOARD, sign-in and the accounts, and THE
# EASTER EGG (E-1, C-436, C-437) -- beside the DAEMONS playground on 4740: the game in a browser, the companion
# beside it, what's new in each release. The egg's carts play in the playground's player.
#
#   ./bindEudaimonia.sh                 both: the playground (the latest ROM RELEASE) and EUDAIMONIA
#   ./bindEudaimonia.sh --build         the playground plays DAEMONS' engineGba build instead
#   ./bindEudaimonia.sh --port 8000     the playground's port
#   ./bindEudaimonia.sh --companion URL the COMPANION tab's site (default: its own export; http://localhost:8081/ is Metro's)
#   ./bindEudaimonia.sh --no-companion  no companion of the playground's own: the tab shows its site's own server
#   ./bindEudaimonia.sh --companion-port 4731   the first of its own companions' four ports (4731-4734)
#   ./bindEudaimonia.sh site [--port N] EUDAIMONIA alone (Node 22.18 or newer; 4741 unless told, or $EUDAIMONIA_PORT)
#   ./bindEudaimonia.sh playground ...  the playground alone, with the options above
#   ./bindEudaimonia.sh always          keep both running: started at login, started again if they stop (a login agent)
#   ./bindEudaimonia.sh never           stop doing that
#   ./bindEudaimonia.sh replica [--port N]  PRAXIS's always-on replica alone, mirroring Redmine (E-9; roverbyteseer, 4742)
#   ./bindEudaimonia.sh replica always|never  keep the replica running as a login agent, or stop doing that
#   ./bindEudaimonia.sh sandbox scope|run --lane L --ticket T-n [...] -- command   an agent in its sandbox (E-15)
#
# It reads the ROMs from DAEMONS beside this repository (../DAEMONS, or $DAEMONS_ROOT) and answers only this machine,
# a private network and the tailnet. The COMPANION tab is a companion of the playground's own, one for each build,
# started when a game of that build first asks for it -- daemons-companion's server (DAEMONS/companion, or
# $COMPANION_ROOT) with its own database and the browser's save, under data/. Its site is the playground's own as well:
# exported from the companion's app as committed (expo export, Node 24) into data/companion-site/ as this starts, and
# again whenever its HEAD moves -- no Expo dev server needed. EUDAIMONIA keeps its accounts in data/eudaimonia/; the
# first is admin, its password admin, taken only from home and changed at once. Ctrl-C stops them all.
set -euo pipefail
cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")"
case "${1:-}" in -h|--help|help) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;; esac

# -- always / never: the playground's server as a login agent (2026-10-28: it had stopped, and a tester's link went nowhere).
# launchd starts it at login and again if it stops; its output goes to data/playground.log, where a tester's device
# reports what went wrong. The PATH is this shell's python3 and Node 24 (the companions and the site's export need it).
# It does not keep the Mac awake: the playground answers while the Mac does.
AGENT="$HOME/Library/LaunchAgents/ca.codemusic.daemons-eudaimonia.plist"
if [[ "${1:-}" == always ]]; then
  shift
  [[ $(uname -s) == Darwin ]] || { echo "bindEudaimonia: 'always' is a Mac login agent" >&2; exit 64; }
  mkdir -p data "$(dirname "$AGENT")"
  py="$(dirname "$(command -v python3)")"
  args=""; for a in "$@"; do args+="<string>$a</string>"; done   # what it is started with, e.g. --build
  cat > "$AGENT" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>ca.codemusic.daemons-eudaimonia</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$PWD/bindEudaimonia.sh</string>$args</array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$PWD/data/playground.log</string>
  <key>StandardErrorPath</key><string>$PWD/data/playground.log</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$py:/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
</dict>
</plist>
PLIST
  plutil -lint "$AGENT" >/dev/null
  launchctl bootout "gui/$(id -u)" "$AGENT" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENT"
  echo "bindEudaimonia: it now runs whenever you are logged in, and starts again if it stops."
  echo "                If one was already running in a terminal, stop that one: this takes over within 30 seconds."
  echo "                Log: data/playground.log   Undo: ./bindEudaimonia.sh never"
  exit 0
fi
if [[ "${1:-}" == never ]]; then
  launchctl bootout "gui/$(id -u)" "$AGENT" 2>/dev/null || true
  rm -f "$AGENT"
  echo "bindEudaimonia: it no longer starts by itself. Start it with ./bindEudaimonia.sh when you want it."
  exit 0
fi

# -- EUDAIMONIA runs on Node 22.18 or newer, which runs its TypeScript as it is. Its one package is PRAXIS's engine
# (E-9, @daemons/praxis, pinned by tag): fetched by npm the first time, and again whenever the pin moves.
site_node() {
  local n v major minor
  for n in "$(command -v node 2>/dev/null || true)" /opt/homebrew/opt/node@24/bin/node /opt/homebrew/opt/node@22/bin/node; do
    [[ -n "$n" && -x "$n" ]] || continue
    v="$("$n" -p 'process.versions.node' 2>/dev/null)" || continue
    IFS=. read -r major minor _ <<<"$v"
    if (( major > 22 || (major == 22 && minor >= 18) )); then echo "$n"; return 0; fi
  done
  return 1
}
need_engine() {   # the engine npm last installed is the commit the lockfile pins, or it is fetched again
  local npm want have; npm="$(dirname "$NODE")/npm"
  want="$("$NODE" -p 'require("./package-lock.json").packages["node_modules/@daemons/praxis"]?.resolved ?? ""' 2>/dev/null || true)"
  have="$("$NODE" -p 'require("./node_modules/.package-lock.json").packages["node_modules/@daemons/praxis"]?.resolved ?? ""' 2>/dev/null || true)"
  if [[ ! -f node_modules/@daemons/praxis/package.json || -z "$have" || "$want" != "$have" ]]; then
    echo "bindEudaimonia: fetching PRAXIS's engine (npm ci)" >&2
    PATH="$(dirname "$NODE"):$PATH" "$npm" ci --no-audit --no-fund >&2 || { echo "bindEudaimonia: npm ci failed" >&2; return 1; }
  fi
}
REPLICA_AGENT="$HOME/Library/LaunchAgents/ca.codemusic.praxis-replica.plist"
case "${1:-}" in
  sandbox) shift; NODE="$(site_node)" || { echo "bindEudaimonia: the sandbox needs Node 22.18 or newer" >&2; exit 69; }
    exec "$NODE" src/sandbox_main.ts "$@" ;;
  site) shift; NODE="$(site_node)" || { echo "bindEudaimonia: EUDAIMONIA needs Node 22.18 or newer" >&2; exit 69; }
        need_engine; exec "$NODE" src/main.ts "$@" ;;
  replica) shift
        if [[ "${1:-}" == always ]]; then
          mkdir -p data "$(dirname "$REPLICA_AGENT")"
          NODE="$(site_node)" || { echo "bindEudaimonia: the replica needs Node 22.18 or newer" >&2; exit 69; }
          cat > "$REPLICA_AGENT" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>ca.codemusic.praxis-replica</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$PWD/bindEudaimonia.sh</string><string>replica</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$PWD/data/praxis.log</string>
  <key>StandardErrorPath</key><string>$PWD/data/praxis.log</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$(dirname "$NODE"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
</dict>
</plist>
PLIST
          plutil -lint "$REPLICA_AGENT" >/dev/null
          launchctl bootout "gui/$(id -u)" "$REPLICA_AGENT" 2>/dev/null || true
          launchctl bootstrap "gui/$(id -u)" "$REPLICA_AGENT"
          launchctl kickstart "gui/$(id -u)/ca.codemusic.praxis-replica" 2>/dev/null || true   # bootstrapped over ssh, it waits else
          echo "bindEudaimonia: PRAXIS's replica now runs whenever you are logged in. Log: data/praxis.log   Undo: ./bindEudaimonia.sh replica never"
          exit 0
        fi
        if [[ "${1:-}" == never ]]; then
          launchctl bootout "gui/$(id -u)" "$REPLICA_AGENT" 2>/dev/null || true
          rm -f "$REPLICA_AGENT"
          echo "bindEudaimonia: PRAXIS's replica no longer starts by itself."
          exit 0
        fi
        NODE="$(site_node)" || { echo "bindEudaimonia: the replica needs Node 22.18 or newer" >&2; exit 69; }
        need_engine; exec "$NODE" src/replica_main.ts "$@" ;;
  playground) shift; exec python3 server/playground.py "$@" ;;
esac
if ! NODE="$(site_node)" || ! need_engine; then
  echo "bindEudaimonia: EUDAIMONIA needs Node 22.18 or newer and PRAXIS's engine; the playground runs alone" >&2
  exec python3 server/playground.py "$@"
fi

# -- both. The playground is what testers' links reach: when it stops, this stops, and launchd (or you) starts both
# again, as before. EUDAIMONIA is new: when it stops, it starts again by itself ten seconds later, and the playground
# never notices.
pg="" site=""
# THE EASTER EGG's carts play in the playground's player: the site is told which port that is
prev=""; for a in "$@"; do [[ "$prev" == "--port" ]] && export PLAYGROUND_PORT="$a"; prev="$a"; done
trap 'kill $pg $site 2>/dev/null || true; wait 2>/dev/null || true; exit 0' INT TERM
python3 server/playground.py "$@" & pg=$!
"$NODE" src/main.ts & site=$!
while kill -0 "$pg" 2>/dev/null; do
  if ! kill -0 "$site" 2>/dev/null; then
    code=0; wait "$site" 2>/dev/null || code=$?
    echo "eudaimonia: stopped (exit $code); starting again in 10 s" >&2
    sleep 10
    "$NODE" src/main.ts & site=$!
  fi
  sleep 2
done
code=0; wait "$pg" 2>/dev/null || code=$?
kill "$site" 2>/dev/null || true
wait "$site" 2>/dev/null || true
exit "$code"
