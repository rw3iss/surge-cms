#!/usr/bin/env bash
# Provision the "Scale" demo install (scale.surgemedia.us) on the surgemedia.us
# box, ALONGSIDE production. Idempotent: re-running keeps the existing DB,
# .env and admin. Run ON the server as rw3iss (sudo needed for postgres,
# systemd and nginx):
#
#   bash setup-scale.sh            # ADMIN_EMAIL=... to override the admin
#
# Layout — an npm-consumer install, NOT a source checkout, so the admin's
# Settings → Admin → CMS Version → "Update & restart" works on it:
#   /var/www/scale            package.json (@sitesurge/server + cli), src/index.js, .env, uploads/
#   systemd scale.service     node src/index.js on :3010 (firewalled; nginx proxies), Restart=always
#   postgres                  role + database "scale"
#   valkey                    db 6 (production uses 3, PIX 5)
#   nginx                     /etc/nginx/conf.d/scale.conf (deploy/scale/nginx-scale.conf)
set -euo pipefail

DIR=/var/www/scale
PORT=3010
REDIS_DB=6
DOMAIN=scale.surgemedia.us
ADMIN_EMAIL=${ADMIN_EMAIL:-rw3iss@gmail.com}
HERE=$(cd "$(dirname "$0")" && pwd)

say() { printf '\033[1;36m▶ %s\033[0m\n' "$*"; }

say "Directory $DIR"
sudo mkdir -p "$DIR/src" "$DIR/uploads" "$DIR/data"
sudo chown -R rw3iss:rw3iss "$DIR"
cd "$DIR"

if [ ! -f package.json ]; then
  cat > package.json <<'JSON'
{
  "name": "scale",
  "private": true,
  "description": "Scale — SiteSurge CMS demo/marketing install (scale.surgemedia.us)",
  "scripts": {
    "migrate": "sitesurge migrate",
    "doctor": "sitesurge doctor",
    "start": "node src/index.js"
  },
  "dependencies": {
    "@sitesurge/server": "^1.0.0",
    "@sitesurge/cli": "^1.0.0"
  }
}
JSON
fi
[ -f src/index.js ] || cat > src/index.js <<'JS'
// Scale (scale.surgemedia.us) — SiteSurge CMS booted from npm.
const { startServer } = require('@sitesurge/server');
startServer();
JS

say "Postgres role + database"
FRESH_DB=0
if ! sudo -u postgres psql -Atc "select 1 from pg_roles where rolname='scale'" | grep -q 1; then
  DBPASS=$(openssl rand -hex 24)
  sudo -u postgres psql -qc "create role scale login password '$DBPASS'"
  FRESH_DB=1
fi
sudo -u postgres psql -Atc "select 1 from pg_database where datname='scale'" | grep -q 1 \
  || sudo -u postgres psql -qc "create database scale owner scale"

if [ ! -f .env ]; then
  [ "$FRESH_DB" = 1 ] || { echo "Role 'scale' exists but .env is missing — set its password by hand." >&2; exit 1; }
  ADMIN_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)
  cat > .env <<ENV
# Scale (scale.surgemedia.us) — SiteSurge npm install. Keep secrets secret.
NODE_ENV=production
PORT=$PORT
DATABASE_URL=postgresql://scale:$DBPASS@localhost:5432/scale
REDIS_URL=redis://localhost:6379/$REDIS_DB
JWT_SECRET=$(openssl rand -hex 48)
FRONTEND_URL=https://$DOMAIN
CORS_ORIGINS=https://$DOMAIN
UPLOAD_DIR=$DIR/uploads
DATA_DIR=$DIR/data
PLUGINS_DIR=$DIR/plugins
# Used once by the installer (sitesurge setup --from-env):
SITE_NAME=Scale
SITE_TAGLINE="Build on SiteSurge CMS"
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_NAME=Admin
ADMIN_PASSWORD=$ADMIN_PASSWORD
ENV
  chmod 600 .env
  echo "ADMIN_PASSWORD (also in $DIR/.env): $ADMIN_PASSWORD"
fi

say "npm install"
npm install --omit=dev --no-audit --no-fund --loglevel=error

if [ ! -f data/.installed ]; then
  say "Installer (schema, seed, admin)"
  set -a; . ./.env; set +a
  # --env-path: keep our hand-written .env; the installer writes its own copy aside.
  npx sitesurge setup --from-env --env-path "$DIR/data/installer.env"
  touch data/.installed
fi

say "systemd scale.service"
sudo tee /etc/systemd/system/scale.service >/dev/null <<UNIT
[Unit]
Description=Scale (SiteSurge CMS demo) — scale.surgemedia.us
After=network.target postgresql.service valkey.service

[Service]
User=rw3iss
WorkingDirectory=$DIR
# No EnvironmentFile: SELinux (enforcing) denies systemd reading files under
# /var/www. The server loads .env from WorkingDirectory itself (dotenv).
ExecStart=/usr/bin/node src/index.js
# Restart=always: the admin's "Update & restart" exits after npm install and
# relies on systemd to start the new version.
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now scale.service
sudo systemctl restart scale.service

say "nginx"
sudo cp "$HERE/nginx-scale.conf" /etc/nginx/conf.d/scale.conf
sudo nginx -t && sudo systemctl reload nginx

say "Health"
for i in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$PORT/api/v1/health" >/dev/null 2>&1 && { echo "scale is up on :$PORT"; exit 0; }
  sleep 2
done
echo "scale did not answer on :$PORT — see: journalctl -u scale -n 80" >&2; exit 1
