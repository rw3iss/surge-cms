#!/usr/bin/env bash
#
# Hot-patch the surge deployments WITHOUT publishing new npm versions. Builds
# the packages locally and rsyncs the compiled `dist/` folders to each target:
#   - LOCAL surge-media (npm consumer): over node_modules/@sitesurge/*/dist.
#   - REMOTE surge.ryanweiss.net (FULL-SOURCE build): over packages/*/dist,
#     where the box runs `node dist/index.js` in packages/api on :3001.
# Both then run the latest code at the same package version numbers.
#
# Use this for rapid iteration between real releases. Installed package VERSION
# numbers stay the same (e.g. server still reports 0.1.13) but the code is the
# latest local build. A real deploy (deploy.sh → git reset + npm install)
# cleanly restores the published version.
#
# Usage:
#   ./deploy/hotpatch-surge.sh              # build + patch BOTH local & remote
#   LOCAL_ONLY=1 ./deploy/hotpatch-surge.sh # patch only the local surge-media
#   REMOTE_ONLY=1 ./deploy/hotpatch-surge.sh # patch only the remote server
#   SKIP_BUILD=1 ./deploy/hotpatch-surge.sh  # reuse existing dist/ (no rebuild)
#   SKIP_MIGRATE=1 ./deploy/hotpatch-surge.sh # don't run remote migrations
#
# Env overrides: SURGE_SSH, SURGE_REMOTE, SURGE_HOST, SURGE_LOCAL.
set -euo pipefail

SURGE_SSH="${SURGE_SSH:-rw3iss@216.158.233.15}"
SURGE_REMOTE="${SURGE_REMOTE:-/var/www/surge-media}"
SURGE_HOST="${SURGE_HOST:-surge.ryanweiss.net}"
SURGE_LOCAL="${SURGE_LOCAL:-$HOME/Sites/others/surge}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cyan() { printf '\033[1;36m%s\033[0m\n' "$1"; }
green() { printf '\033[1;32m%s\033[0m\n' "$1"; }
red() { printf '\033[1;31m%s\033[0m\n' "$1"; }

# Rsync the three built dist/ folders over a target's node_modules/@sitesurge.
# $1 = rsync destination prefix (local path or user@host:path) for the
# `@sitesurge` dir.
sync_dist() {
  local nm="$1"
  rsync -az --delete "$REPO/packages/shared/dist/" "$nm/types/dist/"
  rsync -az --delete "$REPO/packages/api/dist/"    "$nm/server/dist/"
  rsync -az --delete "$REPO/packages/cms/dist/"    "$nm/admin/dist/"
}

# Rsync the three built dist/ folders into a FULL-SOURCE deployment's
# packages/*/dist (the surge.ryanweiss.net box builds from source and runs
# `node dist/index.js` in packages/api). $1 = ssh dest prefix for the repo root.
sync_dist_source() {
  local root="$1"
  rsync -az --delete "$REPO/packages/shared/dist/" "$root/packages/shared/dist/"
  rsync -az --delete "$REPO/packages/api/dist/"    "$root/packages/api/dist/"
  rsync -az --delete "$REPO/packages/cms/dist/"    "$root/packages/cms/dist/"
}

cyan "▶ Hot-patch surge (no version bump)"

if [ "${SKIP_BUILD:-}" != "1" ]; then
  cyan "▶ Building (types → server → admin)"
  pnpm --filter @sitesurge/types build
  pnpm --filter @sitesurge/server build
  pnpm --filter @sitesurge/admin build
fi

# ─── Local surge-media ───
if [ "${REMOTE_ONLY:-}" != "1" ]; then
  if [ -d "$SURGE_LOCAL/node_modules/@sitesurge" ]; then
    cyan "▶ Syncing dist → local $SURGE_LOCAL"
    sync_dist "$SURGE_LOCAL/node_modules/@sitesurge"
    green "✓ local surge-media patched (restart 'npm start' in $SURGE_LOCAL if it's running)"
  else
    red "! local surge-media not found at $SURGE_LOCAL — skipping local"
  fi
fi

# ─── Remote surge.ryanweiss.net (full-source build) ───
if [ "${LOCAL_ONLY:-}" != "1" ]; then
  cyan "▶ Syncing dist → remote $SURGE_SSH:$SURGE_REMOTE/packages/*/dist"
  sync_dist_source "$SURGE_SSH:$SURGE_REMOTE"

  # The server runs migrations on boot (bootRunningMode), so a restart applies
  # any new SQL migrations that shipped in this dist. (SKIP_MIGRATE is a no-op
  # here — boot always migrates.)
  cyan "▶ Restart (boot-time migrations apply)"
  ssh "$SURGE_SSH" "sudo systemctl restart surge"

  cyan "▶ Health check"
  sleep 3
  if curl -fsS "https://$SURGE_HOST/api/v1/health" >/dev/null 2>&1; then
    green "✓ https://$SURGE_HOST is healthy"
  else
    red "✗ remote health check failed"
    exit 1
  fi
fi
