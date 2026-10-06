# Setup Wizard — Design

## Goal
Turn this CMS into a generic, easy-to-install app. On first run, if no installation is detected, show a `/setup` wizard. The wizard collects all configuration the app needs, runs a setup routine (validate inputs, provision DB if requested, run migrations + seed, optionally create an admin user, persist config), and transitions the app into running mode.

## Non-goals
- No automated multi-tenant install. Single instance per process.
- No web-based env editing after install (settings UI handles runtime tweaks; .env edits remain a manual ops task).
- Not a Docker / hosting wizard — only application-level config.

## Architecture

### Three operational modes
The backend always starts. Mode is decided post-config-load.

| Mode | Trigger | Behavior |
|---|---|---|
| **Setup** | `.env` missing required bootstrap vars **or** DB unreachable **or** `installed` flag absent | Mounts only `/api/v1/setup/*`. All other routes return `503 { needsSetup, stage }`. |
| **Running** | Bootstrap env complete, DB reachable, `installed=true` | Full route set. Crons start. |

A future third mode (maintenance) could pause non-setup writes; not in scope.

### Installation detector (`services/installation/detector.ts`)
Returns `{ needsSetup, stage, detected }`. Cached in-process; mutations during setup invalidate.

```
stage:
  'env'     → DATABASE_URL missing or JWT_SECRET < 32 chars
  'db'      → env present but pool can't connect (2s timeout)
  'install' → DB up but no `installed=true` row in site_settings
  'ready'   → all good
```

`detected` includes whether the existing env points at a usable DB, redis, admin count, etc., so the wizard can show "✓ already configured" hints.

### Config storage — hybrid
- **`.env` file** — bootstrap secrets and 3rd-party API keys: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `PORT`, `FRONTEND_URL`, `CORS_ORIGINS`, plus Stripe/Patreon/AWS/social keys.
- **`site_settings` table** (already exists) — runtime-tweakable: site name, upload limits, storage provider, allowed types, plus new `installed`, `installed_at`, `setup_version`.

Wizard writes both. `.env` write happens **last** (point of no return); all earlier steps idempotent or rollback-safe.

### Restart strategy
After successful install:
1. Server returns `{ ok: true, restartNeeded: true }`.
2. `services/lifecycle.ts → transitionToRunning()` is called.
3. **Today (option A):** `process.exit(0)` after a short delay. tsx-watch (dev) / PM2 (prod) restart.
4. **Tomorrow (option B):** body becomes `loadConfig() → resetPool() → remountRoutes('running') → start crons`.
5. Frontend polls `/api/v1/setup/status` until `needsSetup: false`, then redirects to `/admin`.

The single-function seam is deliberate so we can swap A → B without touching call sites.

## Backend layout

```
backend/src/
├── core/                                 NEW
│   ├── errors/                           AppError, ValidationError, NotFoundError, etc.
│   ├── result/                           Result<T,E> helpers
│   └── types/                            Cross-cutting types: InstallationState, ValidationIssue
├── config/
│   ├── schema.ts                         zod schema (split out)
│   ├── loader.ts                         loadConfig(), getConfig() — never process.exit
│   └── index.ts                          public API (re-exports)
├── db/
│   ├── client.ts                         REFACTORED: lazy pool, initPool(), resetPool()
│   ├── migrator.ts                       NEW: runMigrations() callable (extracted from migrate.ts)
│   ├── seeder.ts                         NEW: runSeed() callable (extracted from seed.ts)
│   ├── migrate.ts                        EXISTING CLI wrapper, calls migrator
│   └── seed.ts                           EXISTING CLI wrapper, calls seeder
├── services/
│   ├── installation/
│   │   ├── detector.ts                   getInstallationState(), invalidate()
│   │   └── index.ts                      public API
│   ├── setup/
│   │   ├── installer.ts                  Orchestrator: iterates InstallStep[]
│   │   ├── steps/
│   │   │   ├── InstallStep.ts            interface
│   │   │   ├── databaseStep.ts           probe / create-db
│   │   │   ├── migrationStep.ts          runMigrations
│   │   │   ├── seedStep.ts               runSeed (idempotent)
│   │   │   ├── adminUserStep.ts          create admin if requested
│   │   │   ├── siteSettingsStep.ts       write site_settings rows + installed flag
│   │   │   └── envWriteStep.ts           atomic .env write — LAST
│   │   ├── testers/
│   │   │   ├── ConnectionTester.ts       interface
│   │   │   ├── postgresTester.ts
│   │   │   ├── redisTester.ts
│   │   │   ├── smtpTester.ts
│   │   │   └── s3Tester.ts
│   │   ├── stores/
│   │   │   ├── ConfigStore.ts            interface (get/set/setMany/has)
│   │   │   ├── envFileStore.ts           impl
│   │   │   └── dbSettingsStore.ts        impl over site_settings table
│   │   ├── validators/
│   │   │   ├── installInput.ts           top-level zod
│   │   │   └── sections/
│   │   │       ├── general.ts
│   │   │       ├── database.ts
│   │   │       ├── adminUser.ts
│   │   │       ├── redis.ts
│   │   │       ├── storage.ts
│   │   │       ├── security.ts
│   │   │       └── email.ts
│   │   └── index.ts                      public surface: runInstallation(input)
│   └── lifecycle.ts                      transitionToRunning() seam
├── http/                                 NEW
│   └── policies/
│       └── setupGate.ts                  pure: shouldBlock(state, path) -> 503-or-pass
├── middleware/
│   └── setupGate.ts                      Express adapter wrapping policy
├── routes/
│   └── setup.ts                          GET /status, POST /test-db|test-redis|generate-jwt|install
├── app.ts                                REFACTORED: mountRoutes(mode)
└── index.ts                              REFACTORED: tolerant boot
```

## Setup endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/setup/status` | Always available. Returns `InstallationState`. |
| POST | `/api/v1/setup/test-db` | Probe Postgres connection without persisting. |
| POST | `/api/v1/setup/test-redis` | Probe Redis URL. |
| POST | `/api/v1/setup/test-smtp` | Probe SMTP (optional). |
| POST | `/api/v1/setup/test-s3` | Probe S3 bucket access (optional). |
| POST | `/api/v1/setup/generate-jwt` | Server-side `crypto.randomBytes(32).toString('hex')`. |
| POST | `/api/v1/setup/install` | Full setup transaction. |

**Install flow** (in `services/setup/installer.ts`):
1. Re-check installation state. If `ready`, return `409 AlreadyInstalled`.
2. Run validators across all sections; aggregate `ValidationIssue[]`.
3. Build `InstallContext` (in-memory config snapshot, db pool to-be).
4. Iterate `InstallStep[]`, calling `isApplicable` then `execute`. On error: call `rollback?` for completed steps in reverse order; surface stage + error.
5. The step list (in order):
   `databaseStep → migrationStep → seedStep → adminUserStep → siteSettingsStep → envWriteStep`
6. Return `{ ok: true, restartNeeded: true }`.
7. After response flushes: `lifecycle.transitionToRunning()`.

## Error contract

```ts
// failure
{
  ok: false,
  errors: Array<{
    section: 'database' | 'admin-user' | ... | '_global',
    field?: string,           // dotted path within section, e.g. 'host'
    message: string,
    code?: string             // 'EmailExists', 'ConnectionRefused', etc.
  }>,
  stage?: 'validate' | 'database' | 'migrate' | 'seed' | 'admin-user' | 'site-settings' | 'env-write'
}
```

Frontend: errors with `section + field` go inline; bare `_global` errors go in a top alert.

## SOLID / extensibility seams

- **`InstallStep`** — Open/Closed: add a new section by adding one step file + one validator + one wizard component. No central edit.
- **`ConnectionTester<TInput>`** — same shape across all probes; new probe = new file.
- **`ConfigStore`** — Dependency Inversion: services depend on the interface, not on whether config lives in env or DB.
- **Policies as pure functions** (`setupGate`) — testable without HTTP framework; Express adapter is one wrapper line. Fastify port = swap the adapter.

## Frontend layout

### UI kit (`frontend/src/components/ui/`)
New primitives, all using existing `styles/variables.scss`:
- `Button.tsx` / `.scss` — variants: primary | secondary | ghost | danger; sizes; loading state
- `Input.tsx` / `.scss` — text/number/email/url; label, hint, error, prefix/suffix
- `PasswordInput.tsx` — Input + show/hide toggle + optional generate button
- `Select.tsx`
- `Toggle.tsx` / `.scss` — switch; used for "enable this section"
- `Radio.tsx` + `RadioGroup.tsx`
- `Checkbox.tsx`
- `FormField.tsx` — label + control + hint + error wrapper for vertical rhythm
- `FormSection.tsx` / `.scss` — collapsible card; optional toggle in header (controls a `disabled` state for the body)
- `Alert.tsx` — info | success | warning | error
- `Spinner.tsx`
- `Tabs.tsx` — for the database section's "Existing DB | Create new" tabs

### Setup page (`frontend/src/pages/Setup.tsx`)
- Routes: `/setup` (single-page wizard, sections stacked vertically)
- Top: detection summary (Welcome card)
- Body: 8 collapsible sections, each a small component in `pages/setup/sections/`
- Bottom: sticky Install button + global alert area
- After install: full-screen "Setting up… please wait" overlay, polls `/setup/status` until ready, then redirects to `/admin/login`

### Top-level redirect
- `App.tsx` calls `getInstallationStatus()` on mount. If `needsSetup` and current path ≠ `/setup`, redirect.
- API client interceptor: any 503 with `{ needsSetup: true }` triggers redirect.

## Open questions / future work
- **Hot-reload (option B)**: design supports it via `transitionToRunning()` and `resetPool()`; can flip without API changes.
- **DB superuser flow** for "create new database" — handled, but production deploys typically pre-create the DB; superuser creds are not persisted, only used in-flight.
- **Wizard authentication**: the `/setup` endpoints are unauthenticated **only** while the install state is `needsSetup`. After install, all `/setup/*` routes return 410 Gone or are de-mounted. (Implemented as a guard inside the routes themselves.)
