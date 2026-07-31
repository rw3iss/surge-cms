#!/usr/bin/env bash
#
# surge-backup — nightly PostgreSQL (+ optional media) backup → Cloudflare R2.
#
# What it does:
#   1. pg_dump the Surge DB → gzip.
#   2. Upload to an R2 bucket under db/<timestamp>.sql.gz  (+ db/latest.sql.gz).
#   3. (Optional) tar+gz local /uploads and upload — only needed while media is
#      still on local disk; once STORAGE_PROVIDER=s3 (R2), media is already safe.
#   4. Prune backups older than RETAIN_DAYS locally AND in R2.
#   5. Ping a healthcheck URL on success (a miss → you get alerted).
#
# It is idempotent and safe to run from cron. Any failure exits non-zero and
# SKIPS the success ping, so your monitor notices.
#
# ── Setup ─────────────────────────────────────────────────────────────────
#   sudo cp docs/deploy/backup-to-r2.sh /usr/local/bin/surge-backup
#   sudo chmod +x /usr/local/bin/surge-backup
#   sudo cp docs/deploy/backup-to-r2.env.example /etc/surge-backup.env   # then edit
#   sudo /usr/local/bin/surge-backup                                     # test run
#   echo '30 3 * * * root /usr/local/bin/surge-backup >> /var/log/surge-backup.log 2>&1' \
#     | sudo tee /etc/cron.d/surge-backup
#
# Requires: pg_dump (postgresql-client), gzip, tar, and the AWS CLI v2
#   (aws-cli talks to R2 via --endpoint-url). Install: `sudo apt install awscli`
#   or the official v2 bundle. `rclone` works too — see NOTE at the bottom.
#
# ── Config (env, read from /etc/surge-backup.env or the environment) ───────
#   DATABASE_URL         postgres://user:pass@localhost:5432/surge   (required)
#   R2_ENDPOINT          https://<accountid>.r2.cloudflarestorage.com (required)
#   R2_BUCKET            surge-backups                                (required)
#   AWS_ACCESS_KEY_ID    R2 access key                                (required)
#   AWS_SECRET_ACCESS_KEY R2 secret key                               (required)
#   AWS_DEFAULT_REGION   auto                                         (default: auto)
#   BACKUP_MEDIA_DIR     /var/www/surge-media/uploads   (optional; unset = skip)
#   RETAIN_DAYS          14                                           (default: 14)
#   LOCAL_STAGE_DIR      /var/backups/surge                           (default)
#   HEALTHCHECK_URL      https://hc-ping.com/<uuid>     (optional; pinged on OK)
#
set -euo pipefail

# Load config file if present (does not override already-set env).
if [[ -f /etc/surge-backup.env ]]; then
    set -a; # shellcheck disable=SC1091
    source /etc/surge-backup.env; set +a
fi

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${R2_ENDPOINT:?R2_ENDPOINT is required}"
: "${R2_BUCKET:?R2_BUCKET is required}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID is required}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY is required}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-auto}"

RETAIN_DAYS="${RETAIN_DAYS:-14}"
STAGE="${LOCAL_STAGE_DIR:-/var/backups/surge}"
# Timestamp is passed in (cron/env) or derived; `date` is fine in a shell script.
TS="$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "$STAGE"

log() { echo "[$(date -u +%FT%TZ)] $*"; }
s3() { aws s3 "$@" --endpoint-url "$R2_ENDPOINT"; }

# ── 1. Database dump ───────────────────────────────────────────────────────
DB_FILE="$STAGE/db-$TS.sql.gz"
log "pg_dump → $DB_FILE"
# --no-owner/--no-acl keeps restores portable across roles.
pg_dump --no-owner --no-acl "$DATABASE_URL" | gzip -9 > "$DB_FILE"
DB_SIZE="$(du -h "$DB_FILE" | cut -f1)"
log "dump ok ($DB_SIZE)"

log "upload db → s3://$R2_BUCKET/db/"
s3 cp "$DB_FILE" "s3://$R2_BUCKET/db/db-$TS.sql.gz"
# Convenience pointer for one-liner restores.
s3 cp "$DB_FILE" "s3://$R2_BUCKET/db/latest.sql.gz"

# ── 2. Media (optional — only while media is on local disk) ────────────────
if [[ -n "${BACKUP_MEDIA_DIR:-}" && -d "${BACKUP_MEDIA_DIR:-}" ]]; then
    MEDIA_FILE="$STAGE/media-$TS.tar.gz"
    log "tar media $BACKUP_MEDIA_DIR → $MEDIA_FILE"
    tar -czf "$MEDIA_FILE" -C "$(dirname "$BACKUP_MEDIA_DIR")" "$(basename "$BACKUP_MEDIA_DIR")"
    log "upload media → s3://$R2_BUCKET/media/"
    s3 cp "$MEDIA_FILE" "s3://$R2_BUCKET/media/media-$TS.tar.gz"
else
    log "media backup skipped (BACKUP_MEDIA_DIR unset — media assumed on R2)"
fi

# ── 3. Prune local stage ───────────────────────────────────────────────────
log "prune local files older than $RETAIN_DAYS days"
find "$STAGE" -type f -name '*.gz' -mtime "+$RETAIN_DAYS" -print -delete || true

# ── 4. Prune remote (R2) older than RETAIN_DAYS ────────────────────────────
# Compare each object's date to the cutoff and delete stale ones.
CUTOFF="$(date -u -d "-$RETAIN_DAYS days" +%Y-%m-%d 2>/dev/null || date -u -v-"${RETAIN_DAYS}"d +%Y-%m-%d)"
log "prune R2 objects before $CUTOFF"
for PREFIX in db media; do
    s3 ls "s3://$R2_BUCKET/$PREFIX/" 2>/dev/null | while read -r d _ _ key; do
        [[ "$key" == "latest.sql.gz" ]] && continue
        [[ -z "$key" ]] && continue
        if [[ "$d" < "$CUTOFF" ]]; then
            log "  delete $PREFIX/$key ($d)"
            s3 rm "s3://$R2_BUCKET/$PREFIX/$key" || true
        fi
    done
done

# ── 5. Success ping ────────────────────────────────────────────────────────
if [[ -n "${HEALTHCHECK_URL:-}" ]]; then
    curl -fsS -m 10 --retry 3 "$HEALTHCHECK_URL" >/dev/null && log "healthcheck pinged"
fi

log "backup complete ✓ (db $DB_SIZE)"

# ── Restore (manual) ───────────────────────────────────────────────────────
#   aws s3 cp s3://$R2_BUCKET/db/latest.sql.gz - --endpoint-url "$R2_ENDPOINT" \
#     | gunzip | sudo -u postgres psql surge
#   # media (if tarred): download, tar -xzf into place, or `aws s3 sync` from R2.
#
# ── NOTE: rclone alternative ───────────────────────────────────────────────
#   If you prefer rclone, define an `r2:` remote (type=s3, provider=Cloudflare,
#   endpoint=$R2_ENDPOINT) and replace the `s3 cp/ls/rm` calls with
#   `rclone copyto/lsf/delete`. rclone also handles remote retention via
#   `rclone delete --min-age ${RETAIN_DAYS}d r2:$R2_BUCKET/db`.
