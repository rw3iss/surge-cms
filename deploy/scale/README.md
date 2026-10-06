# Scale — the SiteSurge CMS demo install (scale.surgemedia.us)

**Scale** is the platform/company name for client sites built on SiteSurge CMS.
`https://scale.surgemedia.us` is its landing page: a working CMS install that
demos the CMS and markets it as a platform to build on. It runs on the
surgemedia.us box, **beside** production, sharing nothing but the machine and
its Postgres/Valkey servers.

| | Production (surgemedia.us) | Scale (scale.surgemedia.us) |
|---|---|---|
| Install kind | **source** checkout (rsync + build) | **npm** install (`@sitesurge/server` from the registry) |
| Directory | `/var/www/surge-media` | `/var/www/scale` |
| Service | `surge.service`, :3001 | `scale.service`, :3010 |
| Database | `surge` | `scale` (role `scale`) |
| Valkey db | 3 | 6 |
| nginx | `/etc/nginx/conf.d/surge.conf` | `/etc/nginx/conf.d/scale.conf` (← `deploy/scale/nginx-scale.conf`) |
| Media | R2 / cdn.ryanweiss.net | local `/var/www/scale/uploads` |
| Mail | AWS SES | **not configured** (no `SMTP_*` in its `.env`) |
| Updates | `bash deploy/deploy.sh` | Admin → Settings → Admin → CMS Version → **Update & restart** |

## Access

- Site: <https://scale.surgemedia.us> — admin: <https://scale.surgemedia.us/admin>
- Admin account: `rw3iss@gmail.com`. The password was generated at install and
  is in `ADMIN_PASSWORD` in `/var/www/scale/.env` on the server (mode 600).
  **Editing `ADMIN_PASSWORD` in `.env` does NOT change the login** — the installer
  reads it once. **Quote the value** (`ADMIN_PASSWORD='…'`) — an unquoted `#` starts a
  comment and silently cuts the password short. Change the password in the admin (profile), or re-hash the
  `.env` value into the DB on the server:
  `cd /var/www/scale && node -e 'require("dotenv").config();const b=require("bcryptjs"),{Client}=require("pg");(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();await c.query("update users set password_hash=$1 where lower(email)=lower($2)",[await b.hash(process.env.ADMIN_PASSWORD,12),process.env.ADMIN_EMAIL]);await c.end()})()'`
- Server: `ssh rw3iss@216.158.233.15`, then `cd /var/www/scale`.
  - Logs: `sudo journalctl -u scale -f` · restart: `sudo systemctl restart scale`
  - Config: `/var/www/scale/.env` (DB URL, JWT secret, Valkey db, URLs).

## Updating Scale

1. **Normal path — a release.** Cut a CMS release (`pnpm release patch`, see
   `docs/how-it-works/PUBLISHING.md`), then in Scale's admin open Settings → Admin →
   CMS Version → **Check for update** → **Update & restart**. It runs
   `npm install @sitesurge/{server,admin,cli}@latest` in `/var/www/scale` and
   exits; systemd (`Restart=always`) starts the new version.
2. **"publish to scale" — unreleased work.** `bash deploy/scale/publish-to-scale.sh`
   builds and packs the local packages, installs them on Scale with
   `npm install --no-save`, and restarts. The admin still shows the last package
   version; the next "Update & restart" puts Scale back on the registry's latest.

## Rebuilding from scratch

`deploy/scale/setup-scale.sh` provisions everything (directory, Postgres role +
DB, `.env` with fresh secrets, `npm install`, the installer, systemd, nginx) and
is idempotent. Copy `setup-scale.sh` + `nginx-scale.conf` to the server and run
`bash setup-scale.sh` there. DNS: `scale` A → 216.158.233.15, proxied (Cloudflare
SSL mode "Full" — the origin cert is the self-signed one production uses).
