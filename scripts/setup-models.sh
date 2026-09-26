#!/usr/bin/env bash
# Registers every provider in config/providers.txt on a running TrueForge server (idempotent).
# A model is addressed as <provider>/<slug(model id)>; slug = lowercase, non-alphanumerics to "-".
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a

API="${TRUEFORGE_URL:-http://localhost:8790}/api/v1/settings/model-providers"
slug() { echo "$1" | tr 'A-Z' 'a-z' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g'; }
trim() { echo "$1" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g'; }

while IFS='|' read -r name url keyenv tier models; do
  name=$(trim "${name:-}"); case "$name" in ''|'#'*) continue ;; esac
  url=$(trim "$url"); keyenv=$(trim "$keyenv"); tier=$(trim "$tier")
  key="none"
  if [ -n "$keyenv" ]; then
    key="${!keyenv:-}"
    [ -z "$key" ] && { echo "$name: $keyenv not set, skipped"; continue; }
  fi
  if [ "$tier" = free ] && [ "$name" != ollama ]; then
    for m in $(echo "$models" | tr -d ' ' | tr ',' ' '); do
      case "$m" in *:free|openrouter/free) ;; *) echo "$name: refusing non-free model $m"; exit 1 ;; esac
    done
  fi
  [ "$name" = ollama ] && ! curl -sf "${url%/v1}/api/tags" >/dev/null && { echo "ollama: not running, skipped"; continue; }

  list=$(echo "$models" | tr ',' '\n' | while read -r m; do m=$(trim "$m"); [ -n "$m" ] && jq -n --arg id "$m" --arg n "$(slug "$m")" '{model_id:$id,name:$n,properties:{}}'; done | jq -s .)
  if [ "$name" = openai ]; then
    body=$(jq -n --arg k "$key" --argjson m "$list" '{manifest:{type:"openai",auth:{api_key:$k},models:$m}}')
  else
    body=$(jq -n --arg n "$name" --arg u "$url" --arg k "$key" --argjson m "$list" '{manifest:{type:"custom",name:$n,base_url:$u,auth:{api_key:$k},models:$m}}')
  fi
  code=$(curl -s -o "${TMPDIR:-/tmp}/sm.out" -w '%{http_code}' -X PUT "$API" -H 'Content-Type: application/json' -d "$body")
  echo "$name: HTTP $code"; [ "$code" = 200 ] || cat "${TMPDIR:-/tmp}/sm.out"
done < config/providers.txt
