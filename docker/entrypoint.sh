#!/usr/bin/env bash
set -Eeuo pipefail

mkdir -p /app/config /app/uploads /srv/frontend /data /config

if [[ -n "${ENV_FILE_PATH:-}" ]]; then
  mkdir -p "$(dirname "$ENV_FILE_PATH")"
  touch "$ENV_FILE_PATH"
fi

for name in DATABASE_URL JWT_SECRET QQ_BRIDGE_TOKEN SMTP_HOST SMTP_USER SMTP_PASS SMTP_FROM; do
  if [[ -v "$name" && -z "${!name}" ]]; then
    unset "$name"
  fi
done

node <<'NODE'
const fs = require("fs");

const config = {
  API_BASE_URL: process.env.FRONTEND_API_BASE_URL || "/api/v1",
};

if (process.env.FRONTEND_BACKEND_PORT) {
  config.BACKEND_PORT = process.env.FRONTEND_BACKEND_PORT;
}

fs.writeFileSync(
  "/srv/frontend/config.js",
  `window.__APP_CONFIG__ = ${JSON.stringify(config, null, 2)};\n`,
  "utf8"
);
NODE

cd /app/backend
node scripts/generate-prisma-client.cjs

node dist/index.js &
backend_pid=$!

caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
caddy_pid=$!

shutdown() {
  local signal="${1:-TERM}"
  kill "-$signal" "$backend_pid" "$caddy_pid" 2>/dev/null || true
  wait "$backend_pid" 2>/dev/null || true
  wait "$caddy_pid" 2>/dev/null || true
}

trap 'shutdown TERM; exit 143' TERM
trap 'shutdown INT; exit 130' INT

set +e
wait -n "$backend_pid" "$caddy_pid"
exit_code=$?
set -e

shutdown TERM
exit "$exit_code"
