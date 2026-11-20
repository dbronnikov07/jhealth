#!/bin/bash
# The fast voice helper (scripts/voice-dev.py) in the background, so no Terminal window has to stay open.
#   npm run voice:start    starts it, waits until it is ready, opens /fast-voice in Chrome to turn it on there
#   npm run voice:stop     stops it
#   npm run voice:status   says whether it is running
# It runs until it is stopped or the laptop restarts. Log: ~/jhealth-cache/voice-helper.log
set -u
WEB="$(cd "$(dirname "$0")/.." && pwd)"
PY="$HOME/jhealth-cache/tts/venv/bin/python"
LOG="$HOME/jhealth-cache/voice-helper.log"
PIDFILE="$HOME/jhealth-cache/voice-helper.pid"
SITE="https://motiva-health.vercel.app"

running() { [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; }

case "${1:-status}" in
  start)
    if running; then
      echo "Fast voice is already running."
    else
      cd "$WEB" || exit 1
      nohup "$PY" -I scripts/voice-dev.py > "$LOG" 2>&1 < /dev/null &
      echo $! > "$PIDFILE"
      disown
      printf "Starting fast voice"
      for _ in $(seq 1 90); do
        if curl -s -o /dev/null -m 2 http://127.0.0.1:8799/api/tts; then break; fi
        if ! running; then echo; echo "It stopped. See $LOG"; exit 1; fi
        printf "."; sleep 1
      done
      echo
      curl -s -o /dev/null -m 2 http://127.0.0.1:8799/api/tts || { echo "Not ready after 90 s. See $LOG"; exit 1; }
      echo "Fast voice is on. You can close this window."
    fi
    [ "${2:-}" = "--no-open" ] || open -a "Google Chrome" "$SITE/fast-voice" 2>/dev/null || open "$SITE/fast-voice"
    ;;
  stop)
    if running; then kill "$(cat "$PIDFILE")" && rm -f "$PIDFILE" && echo "Fast voice stopped."; else rm -f "$PIDFILE"; echo "Fast voice was not running."; fi
    ;;
  status)
    if running; then echo "Fast voice is running (log: $LOG)."; else echo "Fast voice is not running. Start it: npm run voice:start"; fi
    ;;
  *) echo "Use: start, stop or status"; exit 1 ;;
esac
