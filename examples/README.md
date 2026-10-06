# SiteSurge examples

- **[headless-node](headless-node)** — the smallest possible headless consumer:
  fetch posts with `@sitesurge/client`, typed by `@sitesurge/types`. The same
  pattern works in Next/Astro/SvelteKit/etc. — swap the runtime, keep the client.

**Turnkey** (Docker: Postgres + Redis + server) isn't a separate example — scaffold
one with `npm create sitesurge@latest my-site`, or use `config/docker-compose.yml`
at the repo root (`pnpm docker:up`).

> These reference `@sitesurge/*` from npm. Until the first publish they won't
> `npm install` from the registry — see `docs/how-it-works/PUBLISHING.md`.
