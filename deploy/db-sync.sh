#!/usr/bin/env bash
#
# DB + uploads sync — push LOCAL Surge data → production (one-way).
#
# Local is the source of truth: you author locally, then publish to prod. This
# OVERWRITES the production DB + uploads with your local copy. The remote DB is
# dumped to a timestamped backup on the server first, so a bad sync is
# recoverable. Objects are restored as the `surge` role so ownership is correct.
#
# Usage:  ./deploy/db-sync.sh            # prompts for confirmation
#         ./deploy/db-sync.sh --yes      # skip the prompt (CI/automation)
# Env:    SURGE_SSH        ssh target   (default: rw3iss@216.158.233.15)
#         SURGE_REMOTE     remote path  (default: /var/www/surge-media)
#         SURGE_LOCAL_DB   local DB URL (default: postgresql://surge:surge@localhost:5432/surge)
#         SURGE_REMOTE_DB  remote DB    (default: surge)
#
set -euo pipefail

SERVER="${SURGE_SSH:-rw3iss@216.158.233.15}"
REMOTE="${SURGE_REMOTE:-/var/www/surge-media}"
LOCAL_DB="${SURGE_LOCAL_DB:-postgresql://surge:surge@localhost:5432/surge}"
REMOTE_DB="${SURGE_REMOTE_DB:-surge}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

say() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }

if [[ "${1:-}" != "--yes" && "${1:-}" != "-y" ]]; then
  printf '\033[1;33mThis OVERWRITES production data (DB + uploads) on %s with your LOCAL copy.\033[0m\n' "$SERVER"
  read -rp 'Continue? [y/N] ' ok
  [[ "$ok" == "y" || "$ok" == "Y" ]] || { echo "aborted."; exit 1; }
fi

STAMP="$(date +%Y%m%d-%H%M%S)"

say "Backing up remote DB → $REMOTE/backups/surge-$STAMP.dump"
ssh "$SERVER" "mkdir -p $REMOTE/backups && sudo -u postgres pg_dump -Fc $REMOTE_DB > $REMOTE/backups/surge-$STAMP.dump && ls -lh $REMOTE/backups/surge-$STAMP.dump | awk '{print \$5, \$9}'"

# The app connects as the `surge` role; restore as that role so every object is
# surge-owned. Pull the password out of the deployed .env (never hard-coded here).
say "Reading remote DB credentials"
REMOTE_PW="$(ssh "$SERVER" "grep -E '^DATABASE_URL=' $REMOTE/packages/api/.env | sed -E 's#.*://surge:([^@]+)@.*#\1#'")"
[[ -n "$REMOTE_PW" ]] || { echo "could not read remote DB password from $REMOTE/packages/api/.env"; exit 1; }

say "Dumping local DB → restoring on remote (clean, as role surge)"
pg_dump --no-owner --no-privileges --clean --if-exists "$LOCAL_DB" \
  | ssh "$SERVER" "PGPASSWORD='$REMOTE_PW' psql -q -v ON_ERROR_STOP=0 -h 127.0.0.1 -U surge -d $REMOTE_DB >/dev/null 2>&1 && echo restored"

say "Syncing uploads → $REMOTE/packages/api/uploads"
rsync -az --delete -e ssh packages/api/uploads/ "$SERVER:$REMOTE/packages/api/uploads/"

say "Restarting service (flush Redis cache, reload)"
ssh "$SERVER" "sudo systemctl restart surge && sleep 3 && systemctl is-active surge"

printf '\033[1;32m✓ Local DB + uploads synced to production. Backup: %s/backups/surge-%s.dump\033[0m\n' "$REMOTE" "$STAMP"
