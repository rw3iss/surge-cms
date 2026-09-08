#!/usr/bin/env bash
# Publish the password-protected static docs at surgemedia.us/fraud.
#
# These are plain HTML with no CMS involvement, so nginx serves them straight
# from disk and does the auth at the edge — the Node app never sees the request.
#
# One-time server setup (already done; here so it can be rebuilt):
#   sudo mkdir -p /var/www/surge-fraud
#   openssl passwd -apr1 '<password>'      # on any machine
#   printf 'surge:<hash>\n' | sudo tee /etc/nginx/surge-fraud.htpasswd
#   sudo chown root:nginx /etc/nginx/surge-fraud.htpasswd && sudo chmod 640 ...
#   # SELinux is ENFORCING on this host and /var/www is labelled var_t, which
#   # nginx may not read — without this the location 403s with correct
#   # credentials, which looks like an auth bug and is not:
#   sudo semanage fcontext -a -t httpd_sys_content_t "/var/www/surge-fraud(/.*)?"
#   sudo restorecon -R /var/www/surge-fraud
#   # then add the /fraud location from deploy/nginx-surge.conf and reload.
set -euo pipefail

SRC="${1:-/home/rw3iss/Sites/others/surge/fraud/docs/html}"
HOST="${FRAUD_HOST:-rw3iss@216.158.233.15}"
DEST="/var/www/surge-fraud"

[ -d "$SRC" ] || { echo "source not found: $SRC" >&2; exit 1; }

echo "▶ Uploading $SRC → $HOST:$DEST"
rsync -az --delete "$SRC/" "$HOST:$DEST/"

# New files inherit the directory's context, but restorecon is cheap and makes
# a fresh upload safe even if the default ever changes.
ssh "$HOST" "sudo restorecon -R $DEST 2>/dev/null || true"

echo "▶ Verifying"
curl -s -o /dev/null -w "  no auth  -> %{http_code} (expect 401)\n" https://surgemedia.us/fraud/
echo "  authed   -> run: curl -u surge:<password> https://surgemedia.us/fraud/"
echo "✓ Published"
