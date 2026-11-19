#!/usr/bin/env bash
# Saves one secret (an API key, token or app secret) without it ever appearing on screen or in a chat:
# in web/.env.local for the laptop and on Vercel (production, sensitive) for the live site.
# Run from web/:   bash scripts/set-secret.sh WHATSAPP_APP_SECRET
# then paste the value and press Enter. Nothing is shown while you paste. Redeploy afterwards (npm run cloud:deploy).
set -euo pipefail
name=${1:?"Which secret? For example: bash scripts/set-secret.sh WHATSAPP_APP_SECRET"}
[[ "$name" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "Use the variable name in capitals, for example WHATSAPP_APP_SECRET."; exit 1; }
cd "$(dirname "$0")/.."
read -rsp "Paste $name and press Enter (nothing will show): " value; echo
value=$(printf %s "$value" | tr -d '\r\n' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
[ -n "$value" ] || { echo "Nothing pasted; nothing changed."; exit 1; }
umask 077
touch .env.local
tmp=$(mktemp)
grep -v -E "^$name=" .env.local > "$tmp" || true
printf '%s=%s\n' "$name" "$value" >> "$tmp"
mv "$tmp" .env.local && chmod 600 .env.local
echo "Saved in web/.env.local (${#value} characters)."
if command -v vercel >/dev/null && [ -f .vercel/project.json ]; then
  vercel env rm "$name" production --yes >/dev/null 2>&1 || true
  if printf %s "$value" | vercel env add "$name" production --sensitive >/dev/null 2>&1; then
    echo "Saved on Vercel (production, sensitive). Tell Claude to redeploy, or run: npm run cloud:deploy"
  else
    echo "Could not save it on Vercel. Is 'vercel whoami' signed in?"
  fi
fi
