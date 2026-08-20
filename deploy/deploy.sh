#!/usr/bin/env bash
#
# Manual deploy — Surge Media production → https://surgemedia.us
#
# Ships the current working tree of THIS project to the production server:
# rsync source → build on server → restart the systemd service → health-check.
# Code only; DB + uploads are data (see db-sync.sh).
#
# Usage:  ./deploy/deploy.sh
# Env:    SURGE_SSH   ssh target      (default: rw3iss@216.158.233.15)
#         SURGE_REMOTE remote path    (default: /var/www/surge-media)
#         SURGE_HOST  public host     (default: surgemedia.us)
#
set -euo pipefail

SERVER="${SURGE_SSH:-rw3iss@216.158.233.15}"
REMOTE="${SURGE_REMOTE:-/var/www/surge-media}"
# The health check MUST target the host this script actually deploys to.
# It used to default to surge.ryanweiss.net, which resolves to the LEGACY box
# (162.35.181.92) — a different server entirely — so the check passed by
# reaching an unrelated instance and told us nothing about the deploy.
HOST="${SURGE_HOST:-surgemedia.us}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

say() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }

say "Syncing source → $SERVER:$REMOTE"
rsync -az --delete \
  --exclude '.git' \
  --exclude 'node_modules' --exclude '**/node_modules' \
  --exclude '**/dist' \
  --exclude '.env' --exclude '**/.env' --exclude '**/.env.local' \
  --exclude 'packages/api/uploads' --exclude 'packages/api/data' \
  --exclude '.pageloop' --exclude '.agents' --exclude '.continue' \
  --exclude 'skills' --exclude 'skills-lock.json' --exclude 'pageloop.json' \
  -e ssh ./ "$SERVER:$REMOTE/"

say "Installing deps + building on server (dependency-ordered)"
ssh "$SERVER" "cd $REMOTE && export CI=true && pnpm install --silent && pnpm run build"

say "Restarting service"
# The API runs migrations on boot (bootRunningMode), so a restart applies any
# new SQL migrations that shipped with this deploy.
ssh "$SERVER" "sudo systemctl restart surge && sleep 4 && systemctl is-active surge"

say "Health check"
if curl -fsS --max-time 20 "https://$HOST/api/v1/health" >/dev/null; then
  printf '\033[1;32m✓ https://%s is healthy\033[0m\n' "$HOST"
else
  printf '\033[1;31m✗ health check failed — check: ssh %s "journalctl -u surge -n 60 --no-pager"\033[0m\n' "$SERVER"
  exit 1
fi
