#!/bin/bash
# The fast voice helper (scripts/voice-dev.py) in the background, so no Terminal window has to stay open.
#   npm run voice:start    starts it, opens a tunnel to it and tells the live site, so every phone and laptop uses it
#   npm run voice:stop     stops all of it (the site goes back to its own, slower speech functions)
#   npm run voice:status   says whether it is running and whether the site knows
# Options for start:  --no-tunnel (this laptop only, as before)   --debug (keep the last utterances as .wav files in
# ~/jhealth-cache/stt-debug, to find out why something was misheard; off by default: recordings are not kept)
# It runs until it is stopped or the laptop restarts. Logs: ~/jhealth-cache/voice-helper.log, voice-tunnel.log
set -u
WEB="$(cd "$(dirname "$0")/.." && pwd)"
PY="$HOME/jhealth-cache/tts/venv/bin/python"
CACHE="$HOME/jhealth-cache"
LOG="$CACHE/voice-helper.log"
TLOG="$CACHE/voice-tunnel.log"
PIDFILE="$CACHE/voice-helper.pid"
TPID="$CACHE/voice-tunnel.pid"
BPID="$CACHE/voice-beat.pid"
SITE="${VOICE_SITE:-https://motiva-health.vercel.app}"

alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }
running() { alive "$PIDFILE"; }
secret() { grep -E '^TTS_SECRET=' "$WEB/.env.local" | head -1 | cut -d= -f2- | tr -d '"\r'; }

# Tell the site where the helper is (url), or that it stopped (empty url). Signed with TTS_SECRET; prints the status code.
announce() {
  local url="$1" exp sig
  exp=$(( $(date +%s) + 120 ))
  sig=$(printf 'helper.%s.%s' "$exp" "$url" | openssl dgst -sha256 -hmac "$(secret)" | awk '{print $NF}')
  curl -s -o /dev/null -w '%{http_code}' -m 10 -X POST "$SITE/api/voice-helper" -H 'Content-Type: application/json' \
    -d "{\"url\":\"$url\",\"exp\":$exp,\"sig\":\"$sig\"}"
}

stop_one() { if alive "$1"; then kill "$(cat "$1")" 2>/dev/null; fi; rm -f "$1"; }

case "${1:-status}" in
  start)
    shift
    TUNNEL=1; DEBUG=""; OPEN=""
    for a in "$@"; do
      case "$a" in --no-tunnel) TUNNEL=0 ;; --debug) DEBUG="$CACHE/stt-debug" ;; --no-open) ;; --open) OPEN=1 ;; esac
    done
    if running; then
      echo "Fast voice is already running."
    else
      cd "$WEB" || exit 1
      [ -n "$DEBUG" ] && mkdir -p "$DEBUG"
      STT_DEBUG_DIR="$DEBUG" nohup "$PY" -I scripts/voice-dev.py > "$LOG" 2>&1 < /dev/null &
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
      echo "Fast voice is on."
    fi
    if [ "$TUNNEL" = 1 ] && ! alive "$TPID"; then
      command -v cloudflared >/dev/null || { echo "cloudflared is not installed: only this laptop will use fast voice."; exit 0; }
      nohup cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8799 > "$TLOG" 2>&1 < /dev/null &
      echo $! > "$TPID"
      disown
      printf "Opening the tunnel"
      URL=""
      for _ in $(seq 1 40); do
        URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TLOG" | head -1)
        [ -n "$URL" ] && break
        printf "."; sleep 1
      done
      echo
      if [ -z "$URL" ]; then echo "No tunnel address after 40 s (see $TLOG): only this laptop will use fast voice."; exit 0; fi
      # The address answers a few seconds after it is printed.
      for _ in $(seq 1 30); do [ "$(curl -s -o /dev/null -w '%{http_code}' -m 4 "$URL/api/tts")" = 204 ] && break; sleep 1; done
      # Keep telling the site while the helper and the tunnel live; say goodbye when either stops.
      nohup bash -c "
        while kill -0 $(cat "$PIDFILE") 2>/dev/null && kill -0 $(cat "$TPID") 2>/dev/null; do
          bash '$0' announce '$URL' >/dev/null 2>&1
          sleep 40
        done
        bash '$0' announce '' >/dev/null 2>&1
      " > /dev/null 2>&1 < /dev/null &
      echo $! > "$BPID"
      disown
      code=$(announce "$URL")
      if [ "$code" = 200 ]; then echo "The live site now uses fast voice on every device ($URL)."; else echo "The site did not accept the address (status $code): only this laptop will use fast voice."; fi
    fi
    [ -n "$OPEN" ] && { open -a "Google Chrome" "$SITE/fast-voice" 2>/dev/null || open "$SITE/fast-voice"; }
    echo "You can close this window."
    ;;
  announce)
    announce "${2:-}"
    ;;
  stop)
    was=0; running && was=1
    stop_one "$BPID"; stop_one "$TPID"; stop_one "$PIDFILE"
    [ "$(announce '')" = 200 ] && told="The site is back on its own speech functions." || told=""
    if [ "$was" = 1 ]; then echo "Fast voice stopped. $told"; else echo "Fast voice was not running. $told"; fi
    ;;
  status)
    if running; then
      echo "Fast voice is running (log: $LOG)."
      if alive "$TPID"; then echo "Tunnel: $(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TLOG" | head -1)"; else echo "No tunnel: only this laptop uses it."; fi
    else
      echo "Fast voice is not running. Start it: npm run voice:start"
    fi
    ;;
  *) echo "Use: start, stop or status"; exit 1 ;;
esac
