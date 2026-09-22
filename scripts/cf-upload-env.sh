#!/usr/bin/env bash
# Upload the server-side runtime secrets from .env into the Cloudflare Worker.
#
# Run this ONCE after `npx wrangler login`, and again whenever a value rotates.
#
#   bash scripts/cf-upload-env.sh
#
# NEXT_PUBLIC_* vars are deliberately NOT here: Next inlines them into the
# client bundle at build time, so they are baked in by `npm run deploy`.
# Everything below is read at runtime via process.env inside the Worker.
set -euo pipefail

cd "$(dirname "$0")/.."

SECRETS=(
  SUPABASE_SERVICE_ROLE_KEY
  TRUCKER_SESSION_SECRET
  INTERAKT_API_KEY
  INTERAKT_WEBHOOK_SECRET
  TWILIO_ACCOUNT_SID
  TWILIO_AUTH_TOKEN
  TWILIO_WHATSAPP_NUMBER
  WHATSAPP_PROVIDER
  WHATSAPP_FROM
  WHATSAPP_DEFAULT_COUNTRY_CODE
  NEXT_PUBLIC_APP_URL
)

for name in "${SECRETS[@]}"; do
  # Take the first matching line, strip the "KEY=" prefix, keep the value verbatim.
  value="$(grep -m1 "^${name}=" .env 2>/dev/null | cut -d= -f2- || true)"
  if [ -z "$value" ]; then
    echo "skip  $name (not set in .env)"
    continue
  fi
  printf '%s' "$value" | npx wrangler secret put "$name" >/dev/null
  echo "sent  $name"
done

echo
echo "Done. Verify with: npx wrangler secret list"
