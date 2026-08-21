#!/usr/bin/env bash
#
# Deploy the working tree to the CMS DEMO → https://surgecms.ryanweiss.net
#
# This is the DEFAULT target for day-to-day work. Production (surgemedia.us) is
# deployed only on explicit request, with ./deploy/deploy.sh.
#
# Deliberately a separate script rather than a flag on deploy.sh: the two differ
# in server, path, service name AND database, and a single script with a switch
# is one typo away from pushing unreviewed work to a live newsroom.
#
# Usage:  ./deploy/deploy-demo.sh
# Env:    DEMO_SSH     ssh target   (default: rw3iss@162.35.181.92)
#         DEMO_REMOTE  remote path  (default: /var/www/surgecms)
#         DEMO_HOST    public host  (default: surgecms.ryanweiss.net)
#         DEMO_SERVICE systemd unit (default: surgecms)
#
set -euo pipefail

SERVER="${DEMO_SSH:-rw3iss@162.35.181.92}"
REMOTE="${DEMO_REMOTE:-/var/www/surgecms}"
HOST="${DEMO_HOST:-surgecms.ryanweiss.net}"
SERVICE="${DEMO_SERVICE:-surgecms}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

say() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }

say "Syncing source → $SERVER:$REMOTE"
# --delete keeps the remote a faithful mirror. `.env`, uploads and data are
# excluded so the demo keeps its own credentials and content across deploys.
rsync -az --delete \
  --exclude '.git' \
  --exclude 'node_modules' --exclude '**/node_modules' \
  --exclude '**/dist' \
  --exclude '.env' --exclude '**/.env' --exclude '**/.env.local' \
  --exclude 'packages/api/uploads' --exclude 'packages/api/data' \
  --exclude '.playwright-mcp' \
  ./ "$SERVER:$REMOTE/"

say "Building on server"
# pnpm, not npm: the root build is `pnpm -r run build` and relies on workspace
# links that npm does not create here.
ssh "$SERVER" "cd $REMOTE && export CI=true && pnpm install --silent && pnpm run build"

say "Restarting $SERVICE"
# The API runs pending migrations on boot, so a restart applies any new SQL.
ssh "$SERVER" "sudo systemctl restart $SERVICE && sleep 4 && systemctl is-active $SERVICE"

say "Health check"
if curl -fsS --max-time 20 "https://$HOST/api/v1/health" >/dev/null; then
  printf '\033[1;32m✓ https://%s is healthy\033[0m\n' "$HOST"
else
  printf '\033[1;31m✗ https://%s failed its health check\033[0m\n' "$HOST"
  exit 1
fi
