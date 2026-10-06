# Deploying Surge CMS

The **server** (`@sitesurge/server`, `packages/api`) is one Node process that
serves the REST API, the SSR/public site, **and** the admin UI (bundled from
`packages/cms/dist`). You can run it two ways — pick either:

- **[Docker](#docker-turnkey)** — one command, Postgres + Redis + server.
- **[Native](#native-no-docker)** — `node` on a host you manage (systemd, pm2,
  etc.). This is how the reference deployments (RW, Surge) run.

Both use the same first-run init (the setup wizard at `/setup`, or the CLI once it
ships). Config comes from environment variables / a `.env` — see
`packages/api/.env.example` for the full list.

---

## Docker (turnkey)

```bash
# from the repo root
docker compose -f config/docker-compose.yml up -d      # or: pnpm docker:up
# open the first-run wizard:
open http://localhost:3001/setup
```

The compose file runs **postgres + redis + server** and passes config via env
(override with a `.env` beside the compose file or shell vars): `DB_NAME`,
`DB_USER`, `DB_PASSWORD`, `PORT`, `JWT_SECRET`, `FRONTEND_URL`, `CORS_ORIGINS`.
**Change `JWT_SECRET`** before any real use. Data persists in named volumes
(`postgres_data`, `redis_data`, `uploads`, `data`).

Build just the image (e.g. to push to a registry):

```bash
docker build -f config/Dockerfile -t sitesurge/server .
docker run --env-file packages/api/.env -p 3001:3001 sitesurge/server
```

The image is multi-stage (`node:22-bookworm-slim`): it builds the whole
workspace — including the admin SPA — then runs `node dist/index.js`.

---

## Native (no Docker)

**Prereqs:** Node ≥ 20, `pnpm`, PostgreSQL; Redis optional (caching degrades
gracefully without it).

```bash
git clone https://github.com/rw3iss/surge-cms && cd surge-cms
pnpm install
pnpm run build                      # dependency-ordered: types → client → mcp → api → admin
```

**Configure** — either run the wizard (below), or create `packages/api/.env` from
`packages/api/.env.example` (at minimum `DATABASE_URL`, `JWT_SECRET`; `REDIS_URL`,
`PORT`, `FRONTEND_URL`, `CORS_ORIGINS` as needed).

**Run:**

```bash
pnpm start                          # = node packages/api/dist/index.js
```

A fresh instance boots into **setup mode** and serves the wizard at
`http://localhost:3001/setup` — it tests your DB/Redis connections, runs
migrations, seeds, and creates the admin user, then restarts into running mode.

### Production (systemd + nginx)

The recommended native prod pattern — a `systemd` unit running `node dist`, behind
nginx for TLS. Example unit:

```ini
# /etc/systemd/system/sitesurge.service
[Unit]
Description=Surge CMS server
After=network.target postgresql.service
Wants=postgresql.service

[Service]
User=youruser
WorkingDirectory=/opt/sitesurge/packages/api
ExecStart=/usr/bin/node dist/index.js
Environment=NODE_ENV=production
# config from /opt/sitesurge/packages/api/.env (dotenv) or EnvironmentFile=…
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now sitesurge
```

nginx just reverse-proxies to the server port (it serves the API, admin, and SPA
itself), e.g. `proxy_pass http://127.0.0.1:3001;` with a Let's Encrypt cert. A
complete, working example — plus `deploy.sh` (rsync → build → restart) and a
`db-sync.sh` — lives in [`deploy/`](../../deploy/README.md) (the RW/Surge setup).

---

## Embed in your own Node app (advanced)

`@sitesurge/server` exposes a programmatic API, so you can mount the CMS inside
your own Express app and add custom routes/middleware:

```ts
import { createApp, startServer, runMigrations } from '@sitesurge/server';

// (a) just run it:
await startServer();

// (b) or take the app and extend it:
const app = createApp('running');
app.use('/webhooks/custom', myRouter);
app.listen(3001);
```

> Today `@sitesurge/server` is consumed from source / the monorepo. Publishing it
> to npm (with the admin UI bundled into the package) is a tracked follow-up; the
> Docker image and native-from-source paths above are the shipping options now.

---

## Headless (bring your own frontend)

Any of the above runs the API + admin. To render your own site instead of the
built-in public SPA, build a frontend in any framework and pull content with
[`@sitesurge/client`](../../packages/cms-client/README.md) (or a custom client typed
against [`@sitesurge/types`](../../packages/shared/README.md)). Issue a scoped API
key in **admin → Settings → API Keys**.
