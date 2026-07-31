# SiteSurge on a single InterServer VPS + Cloudflare — setup guide

> Target: one InterServer VPS running the whole stack (Surge CMS + PostgreSQL +
> Redis + nginx), Cloudflare in front for CDN / edge-cache / TLS / DDoS, and
> Cloudflare R2 for media + off-site backups. Sized for a news+shop site
> averaging ~100 concurrent users with occasional ~5k spikes.
>
> Why this shape (the math): see `docs/infra-sizing.md` summary — Surge's
> isolated idle footprint is ~1 GB; the only real load is anonymous page-view
> spikes, which Cloudflare's edge cache absorbs so the origin barely notices.
> A 6 GB / 2-core box behind Cloudflare is comfortably enough, at ~$9/mo.

---

## 0. What you're building

```
            ┌─────────────── Cloudflare (free) ───────────────┐
 visitors → │  DNS · TLS · edge cache (HTML+assets) · WAF/DDoS │
            │  "Always Online" · R2 media via cdn.<domain>     │
            └───────────────┬─────────────────────────────────┘
                            │ origin (HTTPS, Cloudflare Origin cert)
                    ┌───────▼─────────  InterServer VPS  ──────────────┐
                    │ nginx :443 → Surge (Node) :3001                  │
                    │ PostgreSQL (local)   Redis (local)               │
                    │ fail2ban · node_exporter · nightly R2 backup     │
                    └──────────────────────────────────────────────────┘
                                     │ media (S3 API) + backups
                             Cloudflare R2 bucket
```

**Recommended box:** InterServer **3 slices — 6 GB RAM / 120 GB / $9/mo**.
The 4 GB / $6 tier works (idle ~1.3 GB), but 6 GB is the comfort sweet spot with
Postgres + Redis + Node + mail worker + monitoring co-resident. CPU is ~2 vCPU;
that's fine **because Cloudflare absorbs spikes** — don't pay for more cores
unless you later see sustained *uncacheable* load.

**OS:** Ubuntu 24.04 LTS (commands below use `apt`). Fedora works too — the
current surge box is Fedora 44; substitute `dnf` and `systemctl` is identical.

---

## 1. Base server hardening (do this first)

SSH in as root, then:

```bash
# 1a. A non-root sudo user (replace 'deploy')
adduser deploy && usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh

# 1b. Lock down SSH: key-only, no root login
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/;s/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh

# 1c. Firewall — only SSH + HTTP/HTTPS
apt update && apt install -y ufw
ufw default deny incoming && ufw default allow outgoing
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp
ufw enable

# 1d. Swap — a safety valve so a burst never OOM-kills the app.
#     4 GB is a good size on a 6 GB box.
fallocate -l 4G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' >> /etc/sysctl.conf

# 1e. Automatic security updates + fail2ban (brute-force protection)
apt install -y unattended-upgrades fail2ban
systemctl enable --now fail2ban
```

`fail2ban` ships a working `sshd` jail by default. (Cloudflare's WAF handles the
web side; fail2ban mainly protects SSH here.)

---

## 2. Install the stack

```bash
# Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# PostgreSQL + Redis + nginx
sudo apt install -y postgresql redis-server nginx
sudo systemctl enable --now postgresql redis-server nginx

# pnpm (repo uses it) + the CMS CLI later
sudo npm i -g pnpm
```

### 2a. Create the database

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE surge LOGIN PASSWORD 'CHANGE-ME-strong-password';
CREATE DATABASE surge OWNER surge;
SQL
```

`DATABASE_URL` becomes `postgres://surge:CHANGE-ME@localhost:5432/surge`.

### 2b. Tune Postgres + Redis for a 6 GB box

`/etc/postgresql/16/main/conf.d/surge.conf` (create it):

```
shared_buffers = 1GB
effective_cache_size = 3GB
work_mem = 16MB
maintenance_work_mem = 256MB
max_connections = 100
```

Redis — cap memory so it can never starve Postgres/Node. In
`/etc/redis/redis.conf`:

```
maxmemory 512mb
maxmemory-policy allkeys-lru
```

```bash
sudo systemctl restart postgresql redis-server
```

---

## 3. Deploy Surge CMS

Two supported paths — pick one.

### Option A — Docker (simplest, matches the published image)

```bash
sudo apt install -y docker.io && sudo systemctl enable --now docker
sudo usermod -aG docker deploy   # re-login for this to take effect

docker run -d --name surge --restart unless-stopped \
  --network host \
  --env-file /var/www/surge-media/.env \
  ghcr.io/rw3iss/sitesurge-server:latest
```

(`--network host` lets the container reach the host's Postgres/Redis on
localhost. Alternatively use a bridge network + `host.docker.internal`.)

### Option B — npm/systemd (matches the current surge box)

```bash
sudo mkdir -p /var/www/surge-media && sudo chown deploy:deploy /var/www/surge-media
# Ship the built dist here (rsync from CI or `deploy.sh`), or:
#   npm create sitesurge@latest --node   # scaffolds a thin npm-server repo
# then `npm i` + `npm run build`.
```

Then a systemd unit — `/etc/systemd/system/surge.service`:

```ini
[Unit]
Description=Surge Media (SiteSurge CMS) — API + SPA + admin
After=network.target postgresql.service redis-server.service

[Service]
Type=simple
User=deploy
WorkingDirectory=/var/www/surge-media
EnvironmentFile=/var/www/surge-media/.env
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now surge
sudo journalctl -u surge -f          # watch boot; migrations run automatically
```

### 3c. The `.env` (at `/var/www/surge-media/.env`)

Minimum for production. See `packages/api/.env.example` for the full list.

```ini
NODE_ENV=production
PORT=3001
CORS_ORIGINS=https://surge.ryanweiss.net
DATABASE_URL=postgres://surge:CHANGE-ME@localhost:5432/surge
REDIS_URL=redis://localhost:6379
JWT_SECRET=<64+ random chars>          # openssl rand -hex 48
# Stripe keys can live here as a fallback, but you now set them in-app
# (Admin → Settings → Payments). See docs/… payments.
# Media on R2 — see §5.
STORAGE_PROVIDER=s3
AWS_REGION=auto
AWS_ACCESS_KEY_ID=<R2 access key id>
AWS_SECRET_ACCESS_KEY=<R2 secret access key>
S3_BUCKET=surge-media
S3_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
S3_CDN_URL=https://cdn.ryanweiss.net
```

Run migrations/seed once if not using the auto-migrate-on-boot:
`sitesurge migrate` (installed with `@sitesurge/cli`).

---

## 4. nginx reverse proxy + origin TLS

Get a **Cloudflare Origin Certificate** (Cloudflare dashboard → SSL/TLS → Origin
Server → Create Certificate; 15-year cert). Save the cert + key to
`/etc/ssl/cloudflare/surge.pem` and `surge.key`.

`/etc/nginx/sites-available/surge`:

```nginx
# Real client IP from Cloudflare (so logs/rate-limits see the visitor, not CF).
# Refresh the CF ranges periodically: https://www.cloudflare.com/ips/
set_real_ip_from 173.245.48.0/20;   # … add all CF ranges (v4 + v6)
real_ip_header CF-Connecting-IP;

server {
    listen 443 ssl http2;
    server_name surge.ryanweiss.net;

    ssl_certificate     /etc/ssl/cloudflare/surge.pem;
    ssl_certificate_key /etc/ssl/cloudflare/surge.key;

    client_max_body_size 50m;            # media uploads

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}

# Optional: block direct-to-origin traffic that skips Cloudflare by only
# trusting CF IPs at the firewall (ufw), or check CF-Connecting-IP presence.
server {
    listen 80;
    server_name surge.ryanweiss.net;
    return 301 https://$host$request_uri;
}
```

```bash
sudo ln -s /etc/nginx/sites-available/surge /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

**Harden origin:** ideally restrict `ufw` port 443 to Cloudflare's IP ranges so
nobody can hit the origin directly (bypassing the WAF/cache). Script the CF range
list into a ufw rule and refresh it monthly.

---

## 5. Cloudflare — the part that makes the small box scale

### 5a. DNS + TLS
1. Add the domain to Cloudflare (free plan), point the registrar's nameservers
   to Cloudflare.
2. `A` record `surge` → your VPS IP, **proxied (orange cloud)**.
3. SSL/TLS mode → **Full (strict)** (matches the Origin cert on nginx).
4. Enable **Always Use HTTPS**, **HTTP/3**, **Brotli**.

### 5b. Edge cache rules (this is what absorbs the 5k spike)
The origin marks admin/authenticated responses no-cache already; the goal is to
let Cloudflare cache **anonymous** HTML + all static assets.

- **Cache Rule 1 — static assets (always cache):**
  - When: `URI Path matches ^/assets/ or ends with .js .css .woff2 .png .jpg .svg .webp .ico`
  - Then: *Eligible for cache*, **Edge TTL: 1 month**, respect origin for busts.
- **Cache Rule 2 — anonymous HTML (short micro-cache):**
  - When: `URI Path does not start with /admin and not /api and Cookie does not contain access_token`
  - Then: *Eligible for cache*, **Edge TTL: 60 seconds**, **Cache by cookie: bypass on `access_token`**.
  - A 60s micro-cache turns a 5,000-hit burst on a hot article into ~1 origin
    fetch per minute per URL. Tune 30–120s to taste (news freshness vs. shield).
- **Bypass rule — never cache dynamic/authed:**
  - When: `URI Path starts with /api or /admin or /shop/checkout or /shop/cart`
  - Then: **Bypass cache**.

> Purge on publish (optional later): the admin can also POST a Cloudflare cache
> purge from a publish hook. For launch, the 60s TTL is simpler and enough.

### 5c. Protection
- **Always Online** (SSL/TLS → … / Caching) → serves cached pages if the origin
  is down. Enable it — it's your poor-man's HA.
- **WAF → Managed Rules** on, **Bot Fight Mode** on.
- **Rate limiting rule** (free tier allows one): e.g. `/api/*` > 100 req/min per
  IP → challenge. Protects login/checkout/donation endpoints.

### 5d. R2 bucket + public domain
1. R2 → Create bucket `surge-media`.
2. R2 → Manage API Tokens → create an **S3 Auth** token (Access Key + Secret) →
   these become `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`.
   The endpoint is `https://<accountid>.r2.cloudflarestorage.com` → `S3_ENDPOINT`.
   Use `AWS_REGION=auto`.
3. Attach a **public custom domain** to the bucket: `cdn.ryanweiss.net` (R2 →
   bucket → Settings → Public access → Custom domain). That URL → `S3_CDN_URL`.
   Now uploaded media serves from Cloudflare's edge with **zero egress fees**.

> The CMS's S3 provider supports R2 via the `S3_ENDPOINT` + path-style addressing
> added for exactly this. `S3_CDN_URL` is **required** with R2 (the raw endpoint
> isn't publicly servable). Existing local `/uploads` can be one-time copied to
> R2 with `rclone`/`aws s3 sync --endpoint-url …` during migration.

---

## 6. Monitoring + alerting (lightweight)

Netdata is great but ~170 MB RSS. On a small box prefer:

- **node_exporter** (~20 MB) scraped by a free Grafana Cloud / Prometheus, **or**
  netdata's `--minimal`/streaming-to-cloud mode.
- **Uptime + cron-failure alerts:** a free [healthchecks.io](https://healthchecks.io)
  check — the backup script (below) pings it on success; a miss alerts you.
- **Cloudflare** already emails on origin-down (Always Online) and traffic spikes.
- **Disk/mem alert:** a 5-line cron that emails when `df` > 85% or `free` low.

---

## 7. Nightly backups → R2

The script `docs/deploy/backup-to-r2.sh` (in this repo) does:
`pg_dump` the DB → gzip → upload to a **separate** R2 bucket, prune old copies
locally + remotely, and ping a healthcheck. Media already lives in R2, so it's
covered; the script can also snapshot `/uploads` if you're still on local
storage during migration.

Install:

```bash
sudo cp docs/deploy/backup-to-r2.sh /usr/local/bin/surge-backup
sudo chmod +x /usr/local/bin/surge-backup
# Configure via /etc/surge-backup.env (see the script header), then test:
sudo /usr/local/bin/surge-backup

# Cron: nightly at 03:30
echo '30 3 * * * root /usr/local/bin/surge-backup >> /var/log/surge-backup.log 2>&1' | sudo tee /etc/cron.d/surge-backup
```

**Restore drill (do it once so you trust it):**

```bash
# Pull the latest dump from R2 and restore into a scratch DB
aws s3 cp s3://surge-backups/db/latest.sql.gz - --endpoint-url "$R2_ENDPOINT" \
  | gunzip | sudo -u postgres psql surge_restore_test
```

---

## 8. Go-live / migration checklist

- [ ] VPS hardened (§1): non-root user, key-only SSH, ufw, swap, fail2ban.
- [ ] Postgres + Redis installed and tuned (§2).
- [ ] `.env` complete; `JWT_SECRET` fresh; `DATABASE_URL`/`REDIS_URL` local.
- [ ] Surge running under systemd/Docker; `journalctl -u surge` clean; `/health` 200.
- [ ] nginx + Cloudflare Origin cert; `nginx -t` clean.
- [ ] Cloudflare: DNS proxied, Full(strict), cache rules, Always Online, WAF, rate-limit.
- [ ] R2 bucket + `cdn.<domain>` custom domain; `STORAGE_PROVIDER=s3` + R2 keys/endpoint.
- [ ] One-time media copy old `/uploads` → R2 (`aws s3 sync --endpoint-url`).
- [ ] Stripe: keys set in Admin → Settings → Payments; webhook → `https://<domain>/api/v1/payments/webhook`.
- [ ] Backup script installed + cron + **restore drill passed**.
- [ ] Monitoring + healthcheck ping wired.
- [ ] DB migrated from old box: `pg_dump` on surge box → restore on new box, then flip Cloudflare DNS.

**Cut-over (minimal downtime):**
1. Stand the new box up fully and test via its raw IP (edit `/etc/hosts` locally).
2. Lower the Cloudflare DNS TTL a day ahead.
3. Final `pg_dump` from old → restore to new (put old box read-only/maintenance briefly).
4. Flip the Cloudflare `A` record to the new IP. Propagation is seconds (proxied).
5. Watch `journalctl -u surge` + Cloudflare analytics; keep the old box 48h as rollback.

---

## When to graduate off the single box

You're fine here for a long time. Revisit only when you see, sustained (not
spikes Cloudflare eats):
- CPU pinned at 2 cores during normal traffic, or SSR p95 latency climbing →
  add cores (more slices) first; it's cheap.
- Real need for an uptime SLA / no-single-point-of-failure → managed Postgres
  (+~$13/mo for failover + PITR) and/or a second app node behind Cloudflare LB.
- Genuinely huge *uncacheable* (logged-in) concurrency → then, and only then,
  an autoscaling target (ECS/Fargate) starts to earn its ~10–15× cost.
