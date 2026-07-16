#!/usr/bin/env bash
#
# Hot-patch the surge.ryanweiss.net deployment WITHOUT publishing new npm
# versions. Builds the packages locally and rsyncs the compiled `dist/`
# folders over the installed @sitesurge/* packages in the server's
# node_modules, then runs migrations and restarts the service.
#
# Use this for rapid iteration between real releases. The installed package
# VERSION numbers stay the same (e.g. server still reports 0.1.13) but the
# code is the latest local build. A subsequent real deploy (deploy.sh →
# git reset + npm install) cleanly restores the published version.
#
# Usage:
#   ./deploy/hotpatch-surge.sh            # build + patch server, admin, types
#   SKIP_BUILD=1 ./deploy/hotpatch-surge.sh   # reuse existing dist/ (no rebuild)
#   SKIP_MIGRATE=1 ./deploy/hotpatch-surge.sh  # don't run migrations
#
# Env overrides: SURGE_SSH, SURGE_REMOTE, SURGE_HOST (match deploy.sh).
set -euo pipefail

SURGE_SSH="${SURGE_SSH:-rw3iss@162.35.181.92}"
SURGE_REMOTE="${SURGE_REMOTE:-/var/www/surge-media}"
SURGE_HOST="${SURGE_HOST:-surge.ryanweiss.net}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NM="$SURGE_REMOTE/node_modules/@sitesurge"

cyan() { printf '\033[1;36m%s\033[0m\n' "$1"; }
green() { printf '\033[1;32m%s\033[0m\n' "$1"; }

cyan "▶ Hot-patch $SURGE_HOST (no version bump)"

if [ "${SKIP_BUILD:-}" != "1" ]; then
  cyan "▶ Building (types → server → admin)"
  pnpm --filter @sitesurge/types build
  pnpm --filter @sitesurge/server build
  pnpm --filter @sitesurge/admin build
fi

# Sync compiled output over the installed packages. --delete keeps the target
# clean (removes stale hashed admin assets, old dist files).
cyan "▶ Syncing dist → $SURGE_SSH:$NM"
rsync -az --delete "$REPO/packages/shared/dist/" "$SURGE_SSH:$NM/types/dist/"
rsync -az --delete "$REPO/packages/api/dist/"    "$SURGE_SSH:$NM/server/dist/"
rsync -az --delete "$REPO/packages/cms/dist/"    "$SURGE_SSH:$NM/admin/dist/"

# Migrations (server dist ships db/migrations) + restart.
if [ "${SKIP_MIGRATE:-}" != "1" ]; then
  cyan "▶ Migrate + restart"
  ssh "$SURGE_SSH" "cd $SURGE_REMOTE && npm run migrate && sudo systemctl restart surge"
else
  cyan "▶ Restart (migrations skipped)"
  ssh "$SURGE_SSH" "sudo systemctl restart surge"
fi

cyan "▶ Health check"
sleep 3
if curl -fsS "https://$SURGE_HOST/api/v1/health" >/dev/null 2>&1; then
  green "✓ https://$SURGE_HOST is healthy"
else
  printf '\033[1;31m✗ health check failed\033[0m\n'
  exit 1
fi
