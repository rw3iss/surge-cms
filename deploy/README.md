# Surge Media — demo deployment

Deploys this project to **https://surge.ryanweiss.net** (a demo of the SiteSurge
CMS). This tree is currently the same repo as the CMS; when the Surge site gets
its own repo, move `deploy/` there.

## Production layout (server `37.27.248.79`, Fedora)

| Piece      | Where |
|------------|-------|
| Code       | `/opt/surge` (rsynced source, built on the server) |
| Runtime    | `systemd` unit `surge.service` → `tsx src/index.ts` in `packages/api`, on **:3003** |
| Env        | `/opt/surge/packages/api/.env` (prod values; not in git) |
| Database   | Postgres 18, db `surge`, role `surge` (localhost only, scram) |
| Cache      | Valkey/Redis on `:6379` db `3` |
| Web        | nginx `/etc/nginx/conf.d/surge.ryanweiss.net.conf` → proxies `:3003`, TLS via Let's Encrypt (webroot, auto-renews) |
| DNS        | `surge.ryanweiss.net` → Cloudflare (proxied) → origin |

The backend serves BOTH the API and the SPA (SSR + static from `packages/cms/dist`),
so nginx just reverse-proxies everything to `:3003`.

## Scripts

```bash
./deploy/deploy.sh      # code: rsync → build on server → restart → health-check
./deploy/db-sync.sh     # data: push local DB + uploads → prod (backs up remote first)
```

Typical loop: author locally → `./deploy/deploy.sh` (if code changed) → `./deploy/db-sync.sh` (to publish content/media).

Overrides via env: `SURGE_SSH`, `SURGE_REMOTE`, `SURGE_HOST`, `SURGE_LOCAL_DB`, `SURGE_REMOTE_DB`.

## Notes
- `db-sync.sh` is a **one-way push** (local → prod) and overwrites prod data; it
  dumps the remote DB to `/opt/surge/backups/` first. It does not merge — prod-only
  data (e.g. live form submissions) is not preserved. Fine for a demo where local
  is authoritative.
- The service runs via `tsx` (not `node dist`) because `@sitesurge/types`'s build
  uses bundler-style directory imports that raw Node ESM can't resolve. A future
  improvement is making the shared package emit Node-resolvable output so prod can
  run `node dist/index.js`.
- Logs: `ssh <server> 'journalctl -u surge -n 100 --no-pager -f'`.
