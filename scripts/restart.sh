#!/bin/bash
#
# Hartes Restart-Skript fuer den Plesk-/Passenger-Node-Prozess.
#
# Hintergrund: Open-Source-Phusion-Passenger erlaubt kein per-App
# Worker-Cap, und ein `touch tmp/restart.txt` macht nur einen
# „graceful" Restart — d. h. der alte Worker laeuft weiter, bis seine
# offenen Connections geschlossen sind. Bei langen SSE-Streams kann
# das endlos dauern, sodass der neue Worker parallel startet und
# beide gleichzeitig Stashcat-Realtime-Connections aufbauen.
#
# Dieses Skript killt alle Node-Prozesse, die zu DIESER App gehoeren
# (matched auf den App-Pfad), und triggert dann den Passenger-Restart.
# Wirkt nur auf die eigene App — andere Plesk-/Node-Apps auf demselben
# Server bleiben unberuehrt, weil der `pkill -f`-Filter den vollen
# Pfad enthaelt.
#
# Aufruf:
#   ./scripts/restart.sh
# Oder als Plesk-„Run script after deploy"-Hook konfigurieren.

set -euo pipefail

# App-Root automatisch aus dem Skript-Pfad ableiten (1 Ebene ueber scripts/).
APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[restart] App-Root: $APP_ROOT"

# Aktuell laufende Node-Prozesse dieser App identifizieren.
# Match auf den App-Root-Pfad — damit treffen wir nur unsere eigenen
# Worker, keine fremden Apps. Wir matchen sowohl `server-dist/index.js`
# (build) als auch `server/index.ts` (dev), um beide Modi abzudecken.
MATCH_PATTERN="node.*${APP_ROOT}/(server-dist|server)/index"

PIDS=$(pgrep -f "$MATCH_PATTERN" || true)

if [ -z "$PIDS" ]; then
  echo "[restart] No running workers found — nothing to kill."
else
  echo "[restart] Found workers:"
  ps -o pid,etime,cmd -p $PIDS || true

  echo "[restart] Sending SIGTERM…"
  kill $PIDS 2>/dev/null || true

  # Bis zu 5 Sekunden auf sauberes Beenden warten.
  for i in 1 2 3 4 5; do
    sleep 1
    STILL_ALIVE=$(pgrep -f "$MATCH_PATTERN" || true)
    if [ -z "$STILL_ALIVE" ]; then
      echo "[restart] All workers stopped after ${i}s."
      break
    fi
  done

  # Wer dann immer noch laeuft, kriegt SIGKILL.
  STILL_ALIVE=$(pgrep -f "$MATCH_PATTERN" || true)
  if [ -n "$STILL_ALIVE" ]; then
    echo "[restart] Still alive after 5s — sending SIGKILL: $STILL_ALIVE"
    kill -9 $STILL_ALIVE 2>/dev/null || true
    sleep 1
  fi
fi

# Boot-Lock aufraeumen, damit der frische Worker direkt restoren kann
# ohne 10 Min auf Stale-Detection zu warten.
if [ -f "$APP_ROOT/.realtime-boot.lock" ]; then
  echo "[restart] Removing stale boot lock."
  rm -f "$APP_ROOT/.realtime-boot.lock"
fi

# Passenger neu spawnen lassen.
mkdir -p "$APP_ROOT/tmp"
touch "$APP_ROOT/tmp/restart.txt"
echo "[restart] Triggered Passenger respawn via tmp/restart.txt."

# Kurze Wartezeit, dann pruefen ob nur EIN Worker laeuft.
echo "[restart] Waiting 5s for Passenger to bring up the new worker…"
sleep 5

NEW_PIDS=$(pgrep -f "$MATCH_PATTERN" || true)
if [ -z "$NEW_PIDS" ]; then
  echo "[restart] WARNING: No worker spawned yet — Passenger usually spawns on first request."
  echo "[restart] Send a request to the app to trigger spawn."
elif [ "$(echo "$NEW_PIDS" | wc -l)" -gt 1 ]; then
  echo "[restart] WARNING: Multiple workers detected after restart:"
  ps -o pid,etime,cmd -p $NEW_PIDS || true
  exit 1
else
  echo "[restart] Single worker running (PID $NEW_PIDS) ✓"
fi
