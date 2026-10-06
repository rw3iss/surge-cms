#!/usr/bin/env bash
# "publish to scale" — install the CURRENT local build onto the Scale demo
# (scale.surgemedia.us) without cutting an npm release.
#
#   bash deploy/scale/publish-to-scale.sh            # build, pack, install, restart
#   bash deploy/scale/publish-to-scale.sh --pack-only  # build + pack locally, touch nothing remote
#
# The normal path is a release (`pnpm release patch`) and then Settings → Admin
# → CMS Version → "Update & restart" in Scale's own admin. This script is the
# exception, for showing unreleased work.
#
# How: pnpm-pack @sitesurge/{types,server,admin,cli} (pnpm rewrites workspace:
# ranges) → rsync the tarballs to /var/www/scale/.publish → `npm install
# --no-save` them → restart scale.service. --no-save keeps package.json on the
# npm ranges, so the admin's "Update & restart" still moves Scale back onto
# the registry's latest. The admin reports the PACKAGE version (e.g. 1.0.0)
# even though the code is newer — Scale runs unreleased code until then.
set -euo pipefail
SSH=${SCALE_SSH:-rw3iss@216.158.233.15}
REMOTE=/var/www/scale
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
say() { printf '\033[1;36m▶ %s\033[0m\n' "$*"; }

cd "$ROOT"
say "Build"
pnpm --filter @sitesurge/types --filter @sitesurge/server --filter @sitesurge/admin --filter @sitesurge/cli run build >/dev/null
say "Pack"
for d in shared api cms cli; do
  (cd "packages/$d" && pnpm pack --pack-destination "$OUT" >/dev/null)
done
ls -1 "$OUT"
[ "${1:-}" = "--pack-only" ] && { echo "pack-only: nothing installed"; exit 0; }

say "Upload"
ssh "$SSH" "rm -rf $REMOTE/.publish && mkdir -p $REMOTE/.publish"
rsync -a "$OUT"/ "$SSH:$REMOTE/.publish/"

say "Install + restart"
ssh "$SSH" "cd $REMOTE && npm install --no-save --no-audit --no-fund --loglevel=error ./.publish/*.tgz && sudo systemctl restart scale"

say "Health"
for i in $(seq 1 30); do
  if curl -fsS -A 'publish-to-scale' https://scale.surgemedia.us/api/v1/health >/dev/null 2>&1; then
    printf '\033[1;32m✓ https://scale.surgemedia.us is healthy\033[0m\n'; exit 0
  fi
  sleep 2
done
echo "Scale did not come back — ssh $SSH 'journalctl -u scale -n 80'" >&2; exit 1
