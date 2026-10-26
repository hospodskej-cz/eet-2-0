#!/usr/bin/env bash
# Sends one sale to the EET Gateway HTTP API and waits for EET's answer. Needs curl and jq.
#   EET_URL=http://localhost:8080 EET_API_KEY=… examples/curl/send.sh
set -euo pipefail
url=${EET_URL:-http://localhost:8080}
key=${EET_API_KEY:?set EET_API_KEY}
auth="Authorization: Bearer $key"

# Your own unique receipt id doubles as the idempotency key: repeating the request after a
# network error returns the stored result and never registers the sale twice.
receipt="CURL-$(date +%s)"
now=$(date +%Y-%m-%dT%H:%M:%S%z | sed -E 's/([0-9]{2})$/:\1/') # ISO 8601 with offset
sale=$(jq -n --arg r "$receipt" --arg t "$now" \
  '{porad_cis: $r, dat_trzby: $t, celk_trzba: "123,50"}') # eic_popl etc. from the register config

response=$(curl -sS -w '\n%{http_code}' -X POST "$url/v1/sales" \
  -H "$auth" -H "Content-Type: application/json" -H "Idempotency-Key: $receipt" -d "$sale")
code=${response##*$'\n'}
body=${response%$'\n'*}

case $code in
  200) ;; # EET answered: accepted, verification_ok or rejected
  202) # queued or uncertain: the gateway keeps resending; ask for the outcome
    id=$(jq -r .id <<< "$body")
    for _ in $(seq 1 15); do
      sleep 1
      body=$(curl -sS "$url/v1/sales/$id" -H "$auth")
      case $(jq -r .status <<< "$body") in queued | uncertain) ;; *) break ;; esac
    done
    ;;
  409 | 422) # invalid sale or idempotency key reused: nothing was sent
    jq -r '.issues[] | "\(.code) \(.field // ""): \(.message)"' <<< "$body" >&2
    exit 1
    ;;
  *)
    echo "HTTP $code: $body" >&2
    exit 1
    ;;
esac

jq '{id, status, pok, code, message, warnings: [.warnings[] | "\(.code) \(.message)"]} | with_entries(select(.value != null))' <<< "$body"
status=$(jq -r .status <<< "$body")
[ "$status" = accepted ] || [ "$status" = verification_ok ]
