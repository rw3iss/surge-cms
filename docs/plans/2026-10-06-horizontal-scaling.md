# Horizontal scaling: N backend instances + one static frontend

Status: audit + plan (no code changed). Date: 2026-10-06.
Scope: `packages/api` (`@sitesurge/server`) running as many hosts behind a load balancer, with `packages/cms` (`@sitesurge/admin`) published once as static files (CDN / object storage).
Source of truth for every finding: the code at commit `0b90fe99` (v1.0.0). Paths are relative to `packages/api/src/` unless they start with `packages/`, `config/` or `deploy/`.

---

## 1. Summary

The backend is ready for **N processes on ONE host** (`cluster.ts`, Redis rate limiter, Redis presence). It is **not** ready for **N hosts**. The cluster model uses "the primary process on this machine" as the one place for once-only work. With N hosts there are N primaries, so every cron, the mail resumer and the boot migrations run N times.

The main problems, in order of risk:

1. **Duplicate side effects.** Crons run once per host. The merchandise announcement (`services/shop/merchandiseAnnounce.ts:75` select → send → stamp at `:336`) has no claim, so two hosts send the whole mailing list the same announcement. The auto-backup (`services/backup/schedule.ts:107`) has no claim. A booting host's mail resumer resets another host's in-flight `sending` recipients (`services/mail/sendWorker.ts:109` → `repositories/mailSendRecipients.repo.ts:111`), so recipients get the email twice.
2. **Stale in-process caches with no cross-host invalidation.** Permissions catalog, entity type definitions, Stripe credentials, CSP state, plugin modules, notification settings and more (section 3.2). A write on host A refreshes A only. Example: enable a feature on A and its permission keys stay unknown on B. Unknown keys fail closed, so B returns 403 until a restart.
3. **Per-host filesystem state.** This covers plugins (`PLUGINS_DIR`), local uploads, fonts (always local, even with S3), avatars, logs, the setup wizard's `.env`, and backup safety copies. A plugin installed through host A does not exist on host B.
4. **Fleet-unsafe admin operations.** Restore resets only the local pool and memory caches. "Update & restart" runs `npm install` on one host and exits it. The setup wizard writes `.env` on one host.
5. **Boot migrations have no lock** (`db/migrator.ts:141`). Two hosts that boot at the same time race.
6. **The frontend split is mostly an edge-routing question.** The code assumes one origin in many places: CSRF double-submit read through `document.cookie`, host-only `SameSite` cookies, relative `/api` and `/ws/admin` URLs, `'self'` CSP, and `config.frontendUrl` used as the API base. **Recommendation:** keep ONE public origin and route by path at the edge (static files from object storage, everything dynamic to the LB). Then almost no frontend code changes, and SSR/SEO keeps working.

Good news from the audit:

- **Sessions are stateless.** JWT + `user_sessions` live in the DB, and OAuth state is in Redis.
- **Nothing needs sticky sessions today.** The admin WebSocket shares presence through Redis, so a reconnect to any host is correct. There are no chunked uploads, no SSE and no multi-request server-side flows.
- **Affinity is therefore optional.** This plan adds the hooks for it (instance id header, optional affinity cookie, drain) but does not depend on it.

### Target architecture

```
                        ┌──────────────────────────── Edge / CDN (one public origin: www.example.com) ───────────────────────────┐
 Browser / crawler ───► │ /assets/*, /sw.js, /workbox-*, /registerSW.js, fonts/icons in dist  ──► Object storage (frontend build)  │
                        │ everything else (HTML navigations for SSR, /api/*, /ws/admin, /uploads/*, /u/*, /lists/*,            │
                        │ /feed.xml, /sitemap.xml, /robots.txt, /logo.png, /favicon.ico, /icons/*, /manifest.webmanifest) ──┐   │
                        └───────────────────────────────────────────────────────────────────────────────────────────────────┼───┘
                                                                                                                            ▼
                                                              ┌────────────── Load balancer (L7, WS-capable) ──────────────┐
                                                              │ health: GET /api/v1/health/ready  · drain-aware            │
                                                              │ optional affinity cookie ss_aff (off by default)           │
                                                              └───────┬──────────────────┬──────────────────┬──────────────┘
                                                                      ▼                  ▼                  ▼
                                                              ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐
                                                              │ api-1 (web)  │   │ api-2 (web)  │   │ worker-1 (worker)│  ROLE=web|worker|all
                                                              │ HTTP + WS    │   │ HTTP + WS    │   │ job leases, mail │  INSTANCE_ID per host
                                                              │ local caches │   │ local caches │   │ sends, crons     │  (not behind LB, or
                                                              └──────┬───────┘   └──────┬───────┘   └────────┬─────────┘   behind it with ready=503)
                                                                     │   invalidation bus (Redis pub/sub + DB generation backstop)
                                                                     ├──────────────────┼────────────────────┤
                                                                     ▼                  ▼                    ▼
                                                     ┌───────────────────────┐  ┌───────────────────┐  ┌─────────────────────────┐
                                                     │ PgBouncer (txn mode)  │  │ Redis (HA:        │  │ Object storage (S3/R2): │
                                                     │   └─► PostgreSQL      │  │ Sentinel/managed) │  │ uploads, fonts, avatars,│
                                                     │ (direct conn for      │  │ cache, rate limit,│  │ plugin packages, backups│
                                                     │  migrations/locks)    │  │ presence, bus     │  │ frontend build          │
                                                     └───────────────────────┘  └───────────────────┘  └─────────────────────────┘
```

---

## 2. Glossary used in this document

- **Host / instance**: one deployed copy of `@sitesurge/server`. It can contain several cluster workers (`CLUSTER_WORKERS`).
- **Process**: one Node process (the cluster primary or a worker).
- **Fleet**: all instances that share one database.
- **Fleet mode**: the new configuration (`FLEET_MODE=true`, or the system detects more than one live instance). In fleet mode the server refuses or reroutes single-node-only operations.

---

## 3. Current-state audit

Severity: **C** = critical (wrong data, duplicate emails, money, or security), **H** = high (feature broken across hosts), **M** = medium (stale for a bounded time, or operational pain), **L** = low.

### 3.1 Background work and once-only work

| # | Area | Location | Current behaviour | Problem when N>1 hosts | Sev | Proposed fix |
|---|---|---|---|---|---|---|
| B1 | Once-only gating | `lib.ts:64-200`, `cluster.ts:64-104` | `runOnceOnlyWork = role !== 'worker'`. The primary of each host runs migrations, crons and the mail resumer. | Each host has a primary, so all once-only work runs N times. | C | Replace with fleet-wide job leases (section 6). `ROLE=worker` instances run jobs and `ROLE=web` never do. |
| B2 | Cron registry | `services/cron.ts:35-179` | In-process `node-cron` timers. The only gate is `CRON_ENABLED` (`:97`). | Every job runs on every host. The status list (`list()` `:147`, `services/dev.ts`) shows only the answering process. | C | A DB-backed `job_schedules` table + lease claim. Status comes from the DB. |
| B3 | Merchandise announce | `services/shop/merchandiseAnnounceCron.ts:14-19` (hourly), `services/shop/merchandiseAnnounce.ts:75,336` | Selects pending products, sends, then stamps `merch_announced_at`. No claim. | Two hosts send the same announcement to the whole list. | C | Claim with `UPDATE … SET merch_announce_claim = $instance … WHERE merch_announced_at IS NULL AND claim IS NULL RETURNING`, or run it under the job lease (one runner) plus a per-batch advisory xact lock. |
| B4 | Auto-backup | `services/backup/cron.ts:22-37` (every minute), `services/backup/schedule.ts:93-148` | Advances `nextRunAt` with a plain settings write, then runs `pg_dump`. | Two hosts can both see the job as due and run two dumps. | H | A job lease and a conditional `UPDATE … WHERE next_run_at = $seen`. |
| B5 | Scheduled publisher | `services/scheduledPublisher.ts:10-43` (`*/5`) | A set-based `UPDATE … WHERE status='scheduled' AND publish_at <= NOW()`. | The update itself is idempotent, but N hosts flush caches N times. | L | Job lease. |
| B6 | Printify sync | `services/printify/cron.ts:14,51` (`*/15`) | Full catalogue sync. Variants are upserted on `external_id`. | Concurrent syncs race on archive and upsert, and API quota is used N times. | M | Job lease. |
| B7 | Mail schedules | `services/mail/scheduleCron.ts:26-28`, `services/mailSchedules.ts:321-334` | `FOR UPDATE SKIP LOCKED` + clears `next_run_at`. | Already safe across hosts. N hosts just poll N times. | L | Keep the claim and add a job lease to cut the polling. |
| B8 | Social crons | `services/socialCrons.ts:22-23,75-99`; started by `connections.completeOAuth` (`services/connections.ts:535`), stopped by `disconnect` (`:298`) | `registerAndStart` runs inside whichever process handled the OAuth callback, which can be a web worker. `unregister` stops the job only in that process. | The job runs on a random host, and a disconnect does not stop it on other hosts. | H | Store the provider sync schedule as rows in `job_schedules`. Connect/disconnect write rows and do not touch timers. |
| B9 | Events reminders | `services/events/notifications.ts:160` `runReminderSweep` | **Nothing calls it.** No cron registers it. It is idempotent through the `event_notifications_sent` ledger. | (Pre-existing gap: reminders never send.) | M | Register it as a leased job (`*/5`). |
| B10 | Mail send worker | `services/mailSend.ts:132,191` → `services/mail/sendWorker.ts:98` `kickJob` via `setImmediate` | The send loop runs in the process that created the job. Recipients are claimed atomically (`claimBatch`, SKIP LOCKED). | **`kickJob` → `resetStaleSending(jobId)`** (`sendWorker.ts:109`) sets every `sending` row back to `pending`, even rows that another live host is sending now. A host that boots during a send causes duplicate emails. A web host that dies mid-send leaves the job stuck until some primary reboots. | C | Add a job lease (`owner_instance`, `lease_until`, heartbeat) on `mail_send_jobs` and `claimed_at` on recipients. Requeue only rows whose lease has expired. The worker role polls for unleased jobs; web instances only insert. |
| B11 | Mail resumer | `lib.ts:192-199`, `sendWorker.ts:260-273` | Runs on every host's primary at boot. | Same as B10. | C | Delete it. The worker poll loop (B10) replaces it. |
| B12 | Revisions debounce | `services/revisions.ts:63` (`SETTLE_MS=4000`), `:278` `pending` Map, `:291` `markDirty`, `:348` `flushAll` | In-process timers. Flushed on graceful shutdown. | Writes that reach different hosts each start a timer, which gives 2+ revisions per save. `snapshot` uses `MAX(version)+1 … ON CONFLICT DO NOTHING` (`:191-229`), so a race drops one. `cancelPending` (used by restore) cancels local timers only. A crash loses the pending snapshot. | M | Keep the local debounce, but make `snapshot` take `pg_advisory_xact_lock(hashtext('rev:'||type||id))` (its `content_hash` dedupe then folds duplicates). Phase 4: a `revision_dirty(entity, id, dirty_at)` table swept by the worker role, so a crash cannot lose history. |
| B13 | Boot migrations | `db/migrator.ts:141-190` | No advisory lock. Each file runs in its own transaction plus a UNIQUE insert into `schema_migrations`. Errors are swallowed at boot (`lib.ts:80-83`). | Two hosts that boot together race. The loser fails, logs the error and serves traffic against a schema it thinks is old. | H | `pg_advisory_lock(hashtext('sitesurge:migrate'))` on a dedicated **direct** connection (not PgBouncer txn mode). Fleet mode: `MIGRATE_ON_BOOT=false`, and migrations run as a one-shot release step (`sitesurge migrate`, `db/migrate.ts`). `/health/ready` reports "schema behind" (section 8). |
| B14 | Feature install / uninstall DDL | `features/migrations.ts:52`, `services/featureUninstall.ts:51`, `entities/tableGenerator.ts:129`, `plugins/loader.ts:253` | `pg_advisory_xact_lock(hashtext(...))` per feature, entity or plugin. | The DDL itself is safe. Other hosts' **caches** do not learn of it (section 3.2). | H | Publish bus events after commit. |

### 3.2 In-process state (caches, registries, singletons)

| # | State | Location | Filled / invalidated | Problem when N>1 | Sev | Fix |
|---|---|---|---|---|---|---|
| S1 | Permissions catalog | `services/permissions/index.ts:36` `catalogCache` | Filled lazily. `invalidatePermissionCache()` runs at `:193,271,307,326` and `features/lifecycle.ts:58`. No TTL. | A new feature's permission keys are unknown on other hosts. Unknown keys deny, so those hosts return 403 until restart. Permission edits are stale on other hosts until restart. | C | Bus event `permissions.changed` → local invalidate. Backstop: generation check. |
| S2 | Entity type definitions | `entities/entityManager.ts:15` (comment `:7-9`: "single-instance"). `invalidate()` `:56` is called from `services/entityTypes.ts:69,123,139` and `entities/coreDescriptors.ts:238`. | No TTL. Not reloaded after `uninstallFeature`, even locally. | A new entity type or field (with its new `ce_*` table) is unknown on other hosts, so they return 404 or reject the field. After uninstall, other hosts still query dropped tables. | C | `entityTypes.changed` event → `load()`. Also invalidate after uninstall. |
| S3 | Entity data providers | `entities/dataProviders.ts:23`; registered only at boot `lib.ts:111-116` | Registered only if `shop` was enabled at boot. | Bug on one host too: enabling shop at runtime gives no product media/variants until restart. | M | Register on `features.changed` (and at boot). Unregister on disable. |
| S4 | Contacts optional columns | `services/contacts.ts:90`; `invalidateOptionalFields` `:109` has no callers | Never invalidated. | Stale after any `ce_contact` schema change, even on one host. | L | Invalidate on `entityTypes.changed`. |
| S5 | Stripe credentials + SDK clients | `services/payment/credentials.ts:57` (`refreshStripeCredentials` `:110`, boot `lib.ts:133`, write `:235`); `services/payment/stripe.ts:22` `_clients` | Refreshed only in the process that saved them. `PUT /settings/:key` (`routes/settings.ts:791` → `services/settings.ts:739`) skips the refresh entirely. | Other hosts charge with OLD keys, and webhooks verify with the old secret. | C | `payments.credentials.changed` → refresh. Route the raw-key path through the same hook. |
| S6 | CSP state | `middleware/csp.ts:40` pluginOrigins, `:46` analyticsGaId, `:79` cached middleware; `syncAnalyticsCsp` (`services/analyticsCsp.ts:15`, `services/features/cascade.ts:186`); `refreshPluginCsp` (`services/plugins.ts:517`) | Local only. | Other hosts serve a CSP without the new GA or plugin origins, so the gtag or plugin widget is blocked there. Behaviour varies by request. | H | `csp.changed` → resync from the DB. |
| S7 | Plugin modules + hooks | `plugins/loader.ts:23,107-118` (require cache), `services/plugins.ts:246-288,473-501` | `onEnable`/`onLoad`/`onDisable` run only in the process that handled the request. `update` busts the require cache on one host. | Plugin code, version and side effects differ by host. | H | `plugins.changed{name,action,version}` → each host re-materialises the package (section 10) and re-runs `onLoad`/`onDisable` locally. Lifecycle DDL stays single-run (leader = requester). |
| S8 | Notification settings | `services/notifications/index.ts:24` (no TTL), invalidated from `services/features/cascade.ts:205` only | Local. | Admin alert recipients are stale on other hosts until restart. | M | `settings.changed{keys}` → invalidate. |
| S9 | SSR site meta / nav | `services/ssr/routes.ts:59-61,163-174` (60 s TTL), cleared by `cache.invalidateSettingsCache()` (`services/cache.ts:286-295`) | The Redis part is shared and the memo part is local. | Another host can re-render with stale meta or nav for up to 60 s and **write it back into the shared Redis `ssr:html:*`**, where it lives for the full SSR TTL. | M | `settings.changed` → clear the memo. Stamp each SSR cache entry with the settings generation and reject an entry rendered from an older generation. |
| S10 | SSR template variables | `services/ssr/templateRuntime.ts:187-188` (60 s) | No invalidator at all. | Up to 60 s stale (bounded). | L | Clear on `settings.changed`. |
| S11 | SSR template + build flush | `services/ssr/index.ts:32-35,46-56,71-88` | `index.html` is cached by **local** mtime. `ensureFreshBuild` flushes the **shared** `ssr:html:*` when the local mtime changes. | Hosts with different mtimes flush each other's cache. During a rolling deploy, old and new hosts write shells with different asset hashes into the same key, so a user can get HTML that points at bundles the CDN no longer has, or does not have yet. | H | Key SSR entries by `buildId` (`ssr:html:<buildId>:<path>`). Load the template from the published frontend (section 9.4), not from local disk. Remove the mtime flush. |
| S12 | Static pre-render hook | `services/ssr/index.ts:145-153` reads `cwd/cache/static-html/*.html` | Nothing writes it. It costs a failed file read per SSR request. | Dead per-host filesystem dependency. | L | Delete, or replace with the object-storage pre-render option (9.4 C). |
| S13 | Site assets memo | `services/siteAssets.ts:33,37,105,145-161`; cleared in `purgeSiteAssetsFromEdge` (`:207`) | Logo/favicon bytes have a 10-min TTL. Square icons have no TTL. `/uploads` sources are read from local disk (`:~69`). | Same URL with new content is stale for up to 10 min, and the icons are stale forever. A local-disk source is missing on other hosts. | M | `siteAssets.changed` event. Read the source through the storage provider. |
| S14 | Revisions retention setting | `services/revisions.ts:94-95` (60 s TTL) | Invalidated locally from `cascade.ts:198`. | Bounded 60 s staleness. | L | `settings.changed`. |
| S15 | Admin-channel idle timeout | `services/adminChannel/config.ts:10-11` (30 s) | Invalidated locally from `cascade.ts:192`. | Bounded. | L | `settings.changed`. |
| S16 | Storage provider singleton | `services/storage/index.ts:9-33` | Chosen from env only. **The DB `media_storage` setting (`services/settings.ts:435,675`) is saved but never read by `getStorageProvider`.** | Media settings in the admin do nothing (bug today). In a fleet, local storage splits uploads across hosts. | C (fleet) | Resolve env → DB → default, cache it, and rebuild on `storage.changed`. Refuse `local` in fleet mode. |
| S17 | Mail provider + SMTP pool | `services/mail/providers/factory.ts:13`, `services/mail/providers/smtp.ts:13,21-37` (`maxConnections:5`) | Per process. Env only. | Total SMTP connections = hosts × processes × 5, which can exceed relay limits (SES rate). | M | Make the pool size configurable. Bulk sends on the worker role only. |
| S18 | Config snapshot | `config/loader.ts:155,325-348` | Built from `process.env` + local `.env`. `loadConfig` re-reads `.env` with `override:true`. | Each host can have different config. There is no shared source. | H | Section 5 config model. |
| S19 | Installation state | `services/installation/detector.ts:22-28` (5 s), `site_settings.installed` | The DB-backed part is good. | Fine, apart from the setup wizard writing `.env` (F7). | L | — |
| S20 | Login rate limiter | `routes/auth.ts:153-169` | Default in-memory `MemoryStore`. | The 50 per 15 min limit is multiplied by hosts × processes, which weakens brute-force protection. | H | Use `RedisRateLimitStore` (as `app.ts:130`). |
| S21 | Admin presence peers | `services/adminChannel/server.ts:209-213`, `peers.ts:63-99` | Enabled **only when `config.clusterWorkers > 1`**. Peer id is `w${NODE_APP_WORKER_ID ?? pid}`. | Several single-worker hosts do NOT share presence. Two containers both have pid 1, so their ids collide and each ignores the other's messages (`peers.ts:95`). | H | Always enable when Redis is configured. Peer id = `${INSTANCE_ID}:${processLabel()}`. |
| S22 | systemUpdate caches/lock | `services/systemUpdate.ts:49` release cache (10 min), `:239` `updateInProgress` | Per process. | The lock does not stop a parallel update on another host. | M | See 11.4. |
| S23 | Redis client | `services/cache.ts:84-103` | Single node URL. `maxRetriesPerRequest:3`. | Redis is a single point of failure for cache, rate limits, OAuth state, presence and (planned) the bus. | H | Sentinel / managed HA. See 7.5. |
| S24 | `delPattern` uses `KEYS` | `services/cache.ts:143-155` | `redis.keys(pattern)` then `del`. | `KEYS` blocks Redis for O(N) and does not work on Redis Cluster. As the keyspace grows with more hosts, every invalidation stalls all hosts. | H | `SCAN` + `UNLINK` in batches. Or use generation-prefixed keys so an invalidation is a single `INCR`. |
| S25 | DB pool | `db/client.ts:25-58`, `config/schema.ts:21-22` (min 2, max 10) | Per process. No `idleTimeoutMillis` or `connectionTimeoutMillis`. | Connections = hosts × (workers+1) × 10. 6 hosts × 3 processes × 10 = 180 > the default Postgres `max_connections=100`. | H | PgBouncer (7.4). Set explicit timeouts. |

### 3.3 Filesystem state

| # | What | Location | Problem when N>1 | Sev | Fix |
|---|---|---|---|---|---|
| F1 | Local uploads | `app.ts:188`, `services/storage/local.ts:15-63`, multer `routes/media.ts:30-49`, `services/media.ts:31-33` | A file uploaded on host A returns 404 on host B. | C | S3-compatible storage required in fleet mode (S16). |
| F2 | Fonts | `services/fonts.ts:36,123-170`, URL hard-coded `/uploads/fonts/…` in `repositories/fonts.repo.ts:29-31` | Always local disk, even when S3 is configured. | H | Go through the storage provider and store the returned URL. |
| F3 | Avatars | `lib.ts:138-139`, `routes/users.ts:20-40`, `services/users.ts:33,51-52,152-182`, `app.ts:189` | Staged on local disk. Legacy `/avatars/*` files are only on the original host. | M | Use multer `memoryStorage` (avatars are small) → sharp → storage provider. Migrate legacy files once. |
| F4 | Plugins | `plugins/loader.ts:64-188`, `services/plugins.ts:191-206,351-468` | Install, zip upload, marketplace copy, uninstall and plugin `.data` storage all write to the local `PLUGINS_DIR`. `rescan` on other hosts marks the plugin "folder missing". | C | Section 10.2. |
| F5 | Logs | `utils/logger.ts:33-50` (file transports in production), `services/serverLogs.ts:29-38` | The admin Server Logs panel shows the answering host's file only. Disks fill up per host. | M | JSON to stdout. The admin panel reads a Redis ring buffer per instance (10.4). |
| F6 | Backup temp + safety copy | `services/backup.ts:135-167,259-368`, `services/backup/destinations.ts:280-299`, `routes/settings.ts:112-115,724-790` | The safety dump stays in this host's tmpdir and is never cleaned up. The S3 restore temp file is never removed. A 4 GB upload goes through the LB into one host's tmp. | H | Section 11.3. |
| F7 | Setup wizard `.env` | `services/setup/stores/envFileStore.ts:64-71,137-139`, `services/setup/steps/envWriteStep.ts:13-73`, `services/lifecycle.ts:47-71` | Writes `.env` on one host, then exits that one process. | H | Fleet mode: bootstrap env comes from orchestration. The wizard writes DB-backed config only (section 5) and never `.env`. |
| F8 | SPA build on API disk | `app.ts:34-42,240-303`, `middleware/ssr.ts:13-65`, `services/ssr/index.ts:71-88` | The backend needs `dist/` locally for SSR and the SPA fallback. | H (for split) | Section 9. |
| F9 | Twitter media from disk | `services/social/twitterMedia.ts` (reads `/uploads/<file>` from `config.upload.dir`) | Local path. | M | Read through the storage provider (fetch the URL). |
| F10 | Social media mirror | `services/social.ts:62-74,343-344` | tmp → storage provider. Fine if the provider is S3. | L | None beyond F1. |

### 3.4 Requests, LB and lifecycle

| # | Area | Location | Current | Problem | Sev | Fix |
|---|---|---|---|---|---|---|
| R1 | Readiness probe | `routes/health.ts:36-47`, `services/health.ts:101-103` | Checks the DB only. | It does not check Redis, boot completion, schema version or drain state. The LB keeps sending traffic to a host that is shutting down or half booted. | H | Section 8.3. |
| R2 | Graceful shutdown | `lib.ts:288-362` | Closes the server, **destroys all open sockets at once**, and force-exits after **3 s**. | In-flight requests are cut off on every deploy. No LB deregistration delay. WebSockets drop with no close frame. | H | Section 8.4 drain sequence. |
| R3 | Server timeouts | `lib.ts:255` plain `app.listen` | Node defaults: `keepAliveTimeout` 5 s, `requestTimeout` 300 s. | The keep-alive is shorter than LB idle timeouts (ALB 60 s, nginx upstream keepalive), which causes intermittent 502s. A 4 GB restore upload goes past 300 s. | H | `keepAliveTimeout = LB_IDLE + 5s`, `headersTimeout = keepAlive + 1s`. Long operations become async jobs (11.3). |
| R4 | `trust proxy` | `app.ts:59` (`1`) | Trusts one hop. | CDN → LB → host is two hops, so `req.ip` is the LB's view. That breaks the rate limiter, bans and audit IPs. | H | `TRUST_PROXY` env (hop count or CIDR list). Document the CF real-IP config already in `deploy/`. |
| R5 | Long synchronous admin requests | Restore `routes/settings.ts:752-790` (≤20 min), destination restore `:532-547`, backup run `:570-590`, update `:700`, plugin install `routes/plugins.ts:83-96` | Work happens inside the HTTP request. | LB idle timeouts (CF 100 s, ALB 60 s default) kill the request while the work goes on. This is the only "needs affinity" pattern found. | H | Turn them into async jobs with a DB status row, and poll from any host (11.3). |
| R6 | Stripe webhook dedupe | `services/payment/webhook.ts:61-71,238-259,365-392` | No event-id table. `charge.refunded` and membership `invoice.payment_succeeded` insert `transactions` rows with no `ON CONFLICT`. `customer.subscription.*` re-sends `notify()` on every retry. | Stripe retries, and parallel deliveries to two hosts, give duplicate refund and payment rows and duplicate notifications. | C | A `stripe_events(id PK, type, received_at, processed_at)` table. Insert first; if it conflicts, return 200 with no action. Process in the same transaction. Fix the two inserts too. |
| R7 | Provider webhooks | `routes/shop.ts:320-350`, `services/shop/providers/webhooks.ts:28-52` | No delivery-id dedupe. | Duplicate fulfilment updates (mostly idempotent UPDATEs). | M | Dedupe where the provider sends an id. |
| R8 | Patreon OAuth state | `routes/auth.ts:175-214` | `state` is generated and **never checked** in the callback. | Security bug (login CSRF), not specific to scaling. | H | Store it with `cache.set(oauthState…)` and check it with an atomic `GETDEL` (also fix `consumeOAuthState`, `services/cache.ts:404-409`, which uses GET then DEL). |
| R9 | WebSocket origin | `services/adminChannel/server.ts:59-63,216-238` | Cookie auth only. No `Origin` check. | Cross-site WebSocket hijacking risk (cookies are `SameSite=Lax`, so a top-level-site WS gets them). | M | Check `Origin` against `corsOrigins`. |
| R10 | Admin "Cron jobs" view | `services/dev.ts:8-12` | Shows this process only. | Misleading in a fleet. | L | Read `job_schedules` + `job_runs`. |

### 3.5 Frontend / same-origin assumptions (full list in section 9.1)

These all break if the SPA moves to a **different origin**. They keep working with **one public origin and path routing at the edge** (the recommendation).

| # | Assumption | Location | Sev (if cross-origin) |
|---|---|---|---|
| U1 | CSRF double-submit read through `document.cookie` | `packages/cms-client/src/core/auth/authManager.ts:76-101`, `packages/cms/src/plugins/host.ts:97`, `middleware/csrf.ts:25-30,82-90` (`SameSite=Strict`, host-only) | C |
| U2 | Auth cookies are host-only, `SameSite=Lax` | `routes/auth.ts:131-150` | C |
| U3 | API base = page origin | `packages/cms/src/services/cmsClient.ts:16-38` | H |
| U4 | WS URL = page host | `packages/cms/src/services/adminChannel.ts:144-174` | H |
| U5 | Relative `/api/...` imports and navigations | `packages/cms/src/plugins/host.ts:63-104`, `pages/admin/PluginConfig.tsx:112`, `services/componentScript.ts:41`, `packages/cms-client/src/modules/components.ts:63-65`, `pages/Join.tsx:20`, `stores/auth.tsx:144`, `SitemapPanel.tsx:58`, `BackupRestorePanel.tsx` | H |
| U6 | CSP `'self'` covers the API and is attached by the API | `middleware/csp.ts:56-91`, `app.ts:86` | H |
| U7 | `config.frontendUrl` used as the **API** base | OAuth callback `services/connections.ts:353-357`; provider webhook URLs `routes/shopProviders.ts:30-31,107,121`; email `/u/` and `/lists/` links `services/mail/sendWorker.ts:94-147`, `services/mailingLists.ts:269`; `/logo.png` in `services/donationReply.ts:86` | H |
| U8 | SSR reads `dist/index.html` from local disk | `services/ssr/index.ts:71-88` | H |
| U9 | Canonical / JSON-LD from `window.location.origin` | `pages/Home.tsx`, `Post.tsx`, `DynamicPage.tsx`, shop pages, … | L (correct if the public origin is the site) |
| U10 | Backend-generated "static" files referenced by `index.html` | `/favicon.ico`, `/apple-touch-icon.png`, `/manifest.webmanifest`, `/icons/*` (`routes/siteAssets.ts:53-87`); `vite.config.ts:43` lists them in PWA `includeAssets` | M |
| U11 | PWA navigation rule does not exclude `/u/` or `/lists/` | `config/cms/vite.config.ts:92-101` | M (already a bug: the SW can serve the shell for an unsubscribe link) |
| U12 | Dev proxy is missing `/ws/admin` (`ws:true`), `/logo.png`, `/icons`, `/u`, `/lists` | `config/cms/vite.config.ts:146-158` | L |

---

## 4. Design principles

1. **Default behaviour does not change.** A single host with no new env vars behaves exactly as today (`INSTANCE_ROLE=all`, local caches, one primary). Each fleet feature becomes active when `FLEET_MODE=true`, and the server also detects other live instances (section 7.2).
2. **The DB is the source of truth. Redis is fast but lossy.** Every cross-host signal has a DB backstop, so a lost pub/sub message delays a refresh by seconds but cannot lose it.
3. **Claim before acting.** Every side effect that must happen once (email, charge record, DDL, backup) is claimed in Postgres with `SKIP LOCKED`, a conditional UPDATE, a unique insert or an advisory lock.
4. **No per-host files that matter.** Disk is a scratch cache only. Anything the fleet needs lives in Postgres or object storage.
5. **Affinity is a convenience, never a requirement.** No feature may depend on reaching the same host twice.

---

## 5. Configuration model

### 5.1 Bootstrap env (the only per-instance configuration)

These stay in env (or a secrets manager). The server cannot read the DB without them, they are per-instance, or they protect the DB itself.

| Var | Why it stays env | Note |
|---|---|---|
| `DATABASE_URL` | Needed to read everything else. | Point at PgBouncer. |
| `DATABASE_DIRECT_URL` *(new)* | Session-level locks, migrations, LISTEN. Not possible through PgBouncer txn mode. | Defaults to `DATABASE_URL`. |
| `DATABASE_POOL_MIN` / `DATABASE_POOL_MAX` | Per-process sizing depends on the host. | |
| `REDIS_URL` (or `REDIS_SENTINELS` + `REDIS_SENTINEL_NAME` *(new)*) | Cache, bus and limiter connection. | |
| `JWT_SECRET` | Every host must sign and verify the same tokens. Keeping it out of the DB means a DB-only leak cannot forge admin sessions. | Must be identical across the fleet. Add `JWT_SECRET_PREVIOUS` *(new)* for rotation. |
| `CONFIG_ENCRYPTION_KEY` *(new)* | Decrypts secret fields stored in the DB (5.4). | Identical across the fleet. |
| `MAIL_UNSUBSCRIBE_SECRET` | HMAC key. Today it falls back to `JWT_SECRET`. | Could move to DB (encrypted). Keep env for now. |
| `INSTANCE_ID` *(new)* | Identity in logs, presence, leases and headers. | Default `${hostname}-${random4}`. |
| `INSTANCE_ROLE` *(new)* | `web` \| `worker` \| `all`. | Default `all` (today's behaviour). |
| `FLEET_MODE` *(new)* | Turns on the fleet guards (refuse local storage, disable in-app update, no `.env` writes, `MIGRATE_ON_BOOT=false` default). | Default `false`. |
| `MIGRATE_ON_BOOT` *(new)* | Fleet mode: migrations run as a release step. | Default `true` single / `false` fleet. |
| `PORT`, `NODE_ENV`, `CLUSTER_WORKERS` | Process and host shape. | |
| `TRUST_PROXY` *(new)* | Depends on the network path. | Hops or CIDR list. |
| `LB_IDLE_TIMEOUT_MS` *(new)*, `SHUTDOWN_DRAIN_MS` *(new)*, `SHUTDOWN_TIMEOUT_MS` *(new)* | Depend on the LB. | Defaults 60 000 / 10 000 / 30 000. |
| `LOG_LEVEL`, `LOG_FORMAT` | Per-host operations. | Add `LOG_TARGET=stdout\|file`. |
| `DATA_DIR`, `TMP_DIR` | Scratch only in fleet mode. | |
| `AUTOLOGIN_ADMIN_LOCALHOST` | Dev only. | Force false in fleet mode. |
| `FRONTEND_TEMPLATE_URL` *(new, optional)* | Where SSR gets `index.html` when the SPA is not on local disk (9.4). | Can also live in DB. |

### 5.2 Shared config (moves to the DB)

Store in a new keyed `site_settings` row family (`runtime_config:<group>`), or in a dedicated `runtime_config(key, value jsonb, secret bool, updated_at, generation)` table. **Recommendation: a dedicated table.** It needs per-key generations and an encrypted-value column, and `site_settings` rows are also public-projected in places, which is a leak risk for secrets.

| Env var(s) today | Group | Already in DB? | Reload without restart? |
|---|---|---|---|
| `FRONTEND_URL`, `CORS_ORIGINS` | `site` (`publicOrigin`, `apiOrigin`, `extraCorsOrigins`) | No | Yes (rebuild CORS allow-list) |
| `API_VERSION` | — | Stays a code constant | — |
| `CACHE_TTL_SECONDS` | `cache` | No | Yes |
| `JWT_ACCESS_TOKEN_EXPIRES`, `JWT_REFRESH_TOKEN_EXPIRES` | `auth` | No | Yes |
| `PATREON_*` | `oauth.patreon` (secret) | No | Yes |
| `STRIPE_*` | `stripe_credentials` | **Yes** (`services/payment/credentials.ts`, env fallback) | Yes, through the bus (S5) |
| `SMTP_*`, `EMAIL_FROM`, `MAIL_PROVIDER` | `mail.transport` (secret) | `email_defaults` covers the sender only | Yes (rebuild the transport after draining in-flight sends) |
| `MAIL_LIST_FROM`, `MAIL_SEND_CONCURRENCY`, `MAIL_SEND_DELAY_MS` | `mail.bulk` | `mailing_lists_settings` partly | Yes |
| `WEB_PUSH_*` | `webpush` (secret) | No | Yes |
| `CRON_ENABLED` | Replaced by `INSTANCE_ROLE` + `jobs.paused` (fleet-wide pause switch) | No | Yes |
| `PLUGINS_DIR` | Scratch path only (10.2) | — | — |
| `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_PURGE_TOKEN` | `cdn` (secret) | No | Yes |
| `UPLOAD_MAX_SIZE_MB`, `ALLOWED_FILE_TYPES` | `upload` | No | Yes |
| `UPLOAD_DIR`, `STORAGE_PROVIDER`, `AWS_*`, `S3_*` | `media_storage` | **Yes, but unused** (S16) | Yes (bus `storage.changed`) |
| `BACKUP_*` | `backup_settings` | **Yes** (env wins) | Yes |
| `FACEBOOK_*`, `INSTAGRAM_*`, `TWITTER_*`, `YOUTUBE_*`, `TIKTOK_*` | `social.<provider>` (secret) | `social_connections` holds tokens. App credentials are env. | Yes |
| `SHOPIFY_*` | Plugin config (`plugins.config`) | Plugin has its own | Yes |
| `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS` | `ratelimit` | No | Yes (rebuild the limiter; express-rate-limit reads options per call through a function) |
| `ADMIN_EMAILS` | `notifications` (the `messages` module fallback) | Notifications exist | Yes |

### 5.3 Load order and precedence

```
boot:
  1. loadBootstrapEnv()            # config/loader.ts — only 5.1 vars are required
  2. initPool(); waitForDb()
  3. runtimeConfig.load()          # SELECT * FROM runtime_config → decrypt secret rows
  4. snapshot = merge(defaults, db, envOverrides)   # env still wins, as today
  5. config Proxy (config/index.ts) now reads the merged snapshot — no call-site changes
  6. bus.subscribe('config.changed') → runtimeConfig.reload(keys) → swap snapshot atomically
```

- **Precedence stays "env wins".** This matches the existing `media_storage` and `backup_settings` rules. In the admin, a value set by env shows read-only with "set by environment on instance X". Fleet guidance: keep only 5.1 vars in env.
- **Non-reloadable keys** (`PORT`, pool size, `CLUSTER_WORKERS`) are bootstrap-only, so a DB change can never need a restart.
- **The proxy seam already exists.** `config/index.ts` forwards every read to `getConfig()`, so swapping the snapshot is a one-line change. The ~150 `config.*` call sites stay unchanged.
- **Consumers that build long-lived objects from config** (SMTP transport, Stripe clients, storage provider, CORS middleware, rate limiter, CSP) subscribe to their group and rebuild themselves. List: `services/mail/providers/factory.ts`, `services/payment/stripe.ts`, `services/storage/index.ts`, `app.ts:88-149`, `middleware/csp.ts`.

### 5.4 Secrets in the DB

- Today `stripe_credentials`, `media_storage`, `backup_settings`, `plugins.config` and `shop_providers.config` hold **plaintext** secrets, masked to the client only.
- New: `runtime_config.value_enc` = AES-256-GCM(`CONFIG_ENCRYPTION_KEY`, value) with a key id, so keys can rotate (`CONFIG_ENCRYPTION_KEY_PREVIOUS`).
- Migrate the existing plaintext secret fields to the encrypted column (Phase 2 data migration, reversible while the old column is kept).
- The `SECRET_MASK` echo rule (`mergeConfig`) still applies.
- `pg_dump` backups then hold ciphertext. Restoring needs the same key, and the backup UI must say so.

### 5.5 `instance` concept

```ts
// new: src/instance.ts
export interface InstanceInfo {
  id: string;              // INSTANCE_ID
  role: 'web' | 'worker' | 'all';
  process: string;         // processLabel(): primary | worker:N
  version: string;         // @sitesurge/server version
  buildId: string | null;  // frontend build the SSR is using (9.4)
  schemaVersion: string;   // last applied migration filename
  startedAt: string;
  draining: boolean;
}
```

- Heartbeat: every 10 s, `SET instance:<id> <json> EX 30` in Redis, and an `UPSERT instances(...)` row every 60 s as the DB backstop.
- Admin **Settings → Admin → Instances** lists them: version, role, schema and build skew warnings, and Drain / Undrain actions.
- Uses: presence peer ids (S21), job lease owners, the `X-Instance-Id` header, log fields, update rollout status and fleet detection.

---

## 6. Background work

### 6.1 Roles

| Role | Serves HTTP/WS | Claims jobs | Runs mail sends | Behind LB |
|---|---|---|---|---|
| `all` (default) | yes | yes | yes | yes |
| `web` | yes | no | no (inserts the job only) | yes |
| `worker` | health only (`/api/v1/health/*` on the same port) | yes | yes | no, or yes with `ready` always 503 |

- Small installs run 2 × `all`. Leases make that safe.
- Larger installs run N × `web` + 1-2 × `worker`.
- Inside one host, `CLUSTER_WORKERS` still forks. Jobs are claimed **per process** through the same leases, so the special "cluster primary" gating goes away. The primary stays a supervisor only.

### 6.2 Job scheduler (replaces in-process node-cron)

New tables (core migration):

```sql
CREATE TABLE job_schedules (
  name          text PRIMARY KEY,            -- 'scheduled-publisher', 'social-sync:youtube', ...
  cron          text NOT NULL,               -- same expressions as today
  enabled       boolean NOT NULL DEFAULT true,
  feature       text NULL,                   -- skip when feature disabled
  next_run_at   timestamptz NOT NULL,
  lease_owner   text NULL,                   -- INSTANCE_ID:process
  lease_until   timestamptz NULL,
  last_run_at   timestamptz NULL,
  last_status   text NULL,                   -- success | error | skipped
  last_error    text NULL,
  last_duration_ms integer NULL
);
CREATE TABLE job_runs (id bigserial PRIMARY KEY, name text, owner text, started_at timestamptz,
                       finished_at timestamptz, status text, error text);  -- pruned to 30 days
```

Claim loop (every process with role `worker` or `all`; tick every 5 s with ±1 s jitter):

```sql
UPDATE job_schedules j
   SET lease_owner = $me, lease_until = now() + $lease
 WHERE j.name = (
   SELECT name FROM job_schedules
    WHERE enabled AND next_run_at <= now()
      AND (lease_until IS NULL OR lease_until < now())
    ORDER BY next_run_at
    FOR UPDATE SKIP LOCKED LIMIT 1)
RETURNING j.*;
```

- The handler runs. While it runs, a heartbeat extends `lease_until` every `lease/3`.
- At the end: `next_run_at` = the next cron occurrence **strictly after now()`** (the same catch-up policy as mail schedules: a missed window runs once), the lease is cleared and a row goes into `job_runs`.
- A crashed owner's lease expires and another process takes the job. **Jobs must therefore be idempotent or carry their own claims.** Each job below says which.
- The code API stays almost the same: `cronRegistry.register({ name, schedule, handler })` upserts a `job_schedules` row at boot and keeps the handler in a local map. A process with role `web` registers rows but never claims.
- `CRON_ENABLED=false` maps to "this process never claims". A fleet-wide pause is a `runtime_config` flag.

**Why leases and not one elected leader.** A single leader (`pg_try_advisory_lock` on a direct connection, re-tried every few seconds) is simpler. But one stuck job (a 20-min Printify sync) then blocks every other job, and losing the leader's DB session silently stops all crons. Per-job leases spread the work and limit the effect of one failure to that job. A session advisory lock also needs a non-PgBouncer connection. Leases work through PgBouncer txn mode.

### 6.3 Job inventory and where each one goes

| Job | Today | New | Idempotency |
|---|---|---|---|
| `scheduled-publisher` (`*/5`) | primary cron | leased job | Set-based UPDATE. Safe. |
| `mail-schedules` (`* * * * *`) | primary cron | leased job | Already SKIP LOCKED (`services/mailSchedules.ts:321-334`). |
| `merchandise-announce` (`0 * * * *`) | primary cron | leased job **+ per-product claim** | Add `merch_announce_job_id` claim: `UPDATE shop_products SET merch_announce_job_id=$job WHERE id = ANY($ids) AND merch_announced_at IS NULL AND merch_announce_job_id IS NULL RETURNING id`. Send only the returned ids. The manual `POST /shop/merchandise/announce` uses the same claim. |
| `auto-backup` (`* * * * *` check) | primary cron | leased job | Conditional `next_run_at` update. A lease longer than the dump time (30 min). |
| `printify-sync` (`*/15`) | primary cron | leased job | Lease of 20 min. Upserts are keyed. |
| `instagram-token-refresh` + provider syncs | `registerAndStart` in any process | `job_schedules` rows written by connect/disconnect | Provider API calls are reads + keyed upserts. |
| `events-reminders` (missing today) | — | new leased job `*/5` | `event_notifications_sent` claim ledger. |
| `revision-sweeper` (Phase 4) | in-process timers | leased job every 5 s | Per-entity advisory lock + `content_hash` dedupe. |
| `runtime-gc` (new) | — | daily | Prunes `job_runs`, stale `instances` rows and expired temp objects. |
| Mail send jobs | `setImmediate(kickJob)` in the creating process + primary resumer | **work queue**: see 6.4 | Per-recipient claim (already). Job lease (new). |

### 6.4 Mail send worker

- `mail_send_jobs`: add `lease_owner text`, `lease_until timestamptz`. `mail_send_recipients`: add `claimed_by text`, `claimed_at timestamptz`.
- Web processes only `INSERT` the job (status `pending`), then publish `mail.job.created`, a hint to wake a worker now rather than at the next tick.
- Worker processes claim a job:

  ```sql
  UPDATE mail_send_jobs SET lease_owner=$me, lease_until=now()+'60s', status='running'
   WHERE id = (SELECT id FROM mail_send_jobs
                WHERE status IN ('pending','running')
                  AND (lease_until IS NULL OR lease_until < now())
                ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
  RETURNING *;
  ```

  The worker heartbeats the lease every 20 s.
- `resetStaleSending` becomes `… WHERE job_id=$1 AND status='sending' AND claimed_at < now() - interval '5 min'`. It only runs when this process has just **taken over** an expired lease.
- Several workers may share one large job safely, because `claimBatch` is already SKIP LOCKED. Allow `MAIL_JOB_PARALLELISM` lease holders per job later. Not needed in phase 1.
- Remove `resumeRunningJobs` from boot (`lib.ts:192-199`). The claim loop replaces it.
- The SMTP pool per worker process (S17) is sized with `mail.bulk.maxConnections`. Total = workers × that value, which the operator controls.

---

## 7. Cross-instance coordination

### 7.1 Invalidation bus

**Transport: Redis pub/sub** on channel `sitesurge:bus:<dbName>`. The DB name in the channel isolates the demo and production when they share one Redis. Use one dedicated subscriber connection per process; ioredis needs a separate connection in subscribe mode (the pattern already exists in `services/adminChannel/peers.ts:87-99`).

**Why Redis and not Postgres `LISTEN/NOTIFY`.**

- NOTIFY has a real benefit: it is sent on commit, so it can never go out for a rolled-back write.
- But LISTEN needs a dedicated session connection, which PgBouncer txn mode does not support.
- Redis is already a required dependency.

The commit-ordering benefit is kept through the outbox rule below.

**Message:**

```json
{ "v": 1, "id": "01J…ulid", "topic": "permissions.changed", "origin": "api-2:worker:1",
  "gen": 1842, "data": { "keys": ["shop:read"] }, "at": "2026-10-06T12:00:00Z" }
```

**Rules:**

1. **Publish after commit, never inside a transaction.** Use a helper `afterCommit(client, () => bus.publish(...))`. Writes outside a transaction publish right after the query.
2. **Messages are hints, not data.** A receiver reloads from the DB. A duplicate or reordered message costs at most a redundant reload, the same principle as `peers.ts`.
3. **Generation backstop.** The table `cache_generations(topic text PRIMARY KEY, gen bigint)` is incremented in the **same transaction** as the write (`UPDATE … SET gen = gen + 1 RETURNING gen`). Each process keeps the last `gen` it applied per topic. Every 15 s (and on Redis reconnect) a process reads the table, one tiny query, and reloads any topic whose `gen` moved. So a lost pub/sub message, a Redis outage or a process that was mid-boot heals within 15 s.
4. **Self-delivery.** The originating process applies the change locally and synchronously, as today, so read-your-writes holds on the host that answered the request. Its own bus message is then a no-op through `gen`.
5. **Ordering.** No ordering across topics is promised. Within a topic, "reload from DB" makes order irrelevant.

### 7.2 Topics (events)

| Topic | Emitted by (today's local hook) | Receiver action |
|---|---|---|
| `config.changed{groups}` | runtime-config writes (new) | Reload snapshot. Rebuild CORS, limiter, SMTP, storage and Stripe as subscribed. |
| `settings.changed{keys}` | `cache.invalidateSettingsCache` callers (`services/settings.ts:95,121,531,721,754,772`, `cascade.ts:178`, `featureUninstall.ts:100`, `swatches.ts:144`, `shop/settings.ts:211`) | Clear siteMeta, siteNav, siteVars, revisions-days, admin-channel config and notification settings (S8-S10, S14, S15). |
| `features.changed{key, enabled\|uninstalled}` | `services/features/cascade.ts`, `services/featureUninstall.ts` | Reload permissions and entity manager. Register or unregister data providers (S3). Sync CSP. Refresh the plugin boot state if `plugins` changed. |
| `permissions.changed` | `services/permissions/index.ts:193,271,307,326`, `features/lifecycle.ts:58` | `invalidatePermissionCache()`. |
| `entityTypes.changed{key}` | `services/entityTypes.ts:69,123,139`, `entities/coreDescriptors.ts:238`, feature uninstall | `entityManager.load()`. `invalidateOptionalFields()`. |
| `payments.credentials.changed` | `services/payment/credentials.ts:235`, `PUT /settings/:key` with key `stripe_credentials` | `refreshStripeCredentials()` (which also resets the clients). |
| `csp.changed` | `syncAnalyticsCsp`, `refreshPluginCsp` | Re-read the GA id and plugin origins from the DB and rebuild the middleware. |
| `plugins.changed{name, action, version, sha256}` | `services/plugins.ts` install / enable / disable / update / uninstall / saveConfig | Materialise or remove the package locally (10.2). Run `onLoad`/`onDisable` locally. Refresh CSP. |
| `storage.changed` | media settings save | Rebuild the storage provider. |
| `siteAssets.changed` | `setSiteBranding` | Clear the `siteAssets` memo. |
| `jobs.changed{name}` | social connect/disconnect, schedule edits | None needed (the DB is the source of truth). Wakes the claim loop at once. |
| `mail.job.created{id}` | `services/mailSend.ts` | Worker wakes its claim loop. |
| `maintenance{state: begin\|end, reason}` | restore / fleet operations (11.3) | Enter or leave maintenance mode (writes return 503, job claiming pauses). |
| `db.restored` | restore (11.3) | `resetPool()`, drop ALL local caches, `entityManager.load()`, permissions, plugins re-boot, CSP. |
| `instance.drain{id}` | admin Instances panel | The named instance starts drain (8.4). |
| `frontend.build.changed{buildId}` | deploy pipeline (`sitesurge publish-frontend` CLI) or the template poll | Reload the SSR template. New SSR keys are used at once. |

### 7.3 Redis-key hygiene for a fleet

- Replace `KEYS` in `delPattern` with batched `SCAN … COUNT 500` + `UNLINK` (S24). For the biggest families (`ssr:html:*`, `entity:*`, `posts:*`), use **generation-namespaced keys** (`ssr:html:g{gen}:{buildId}:{path}`). Invalidation is then one `INCR` and old keys expire by TTL.
- Add `CACHE_NAMESPACE` = the major.minor of `@sitesurge/server`, prefixed to every `CACHE_KEYS` entry. During a rolling deploy, old and new versions then never read each other's cached payload shapes (11.2). The cost is a cold cache per release, which is acceptable.
- Atomic `GETDEL` for one-time tokens (OAuth state, R8).

### 7.4 PostgreSQL connections

- Formula: `hosts × (CLUSTER_WORKERS + 1) × DATABASE_POOL_MAX + migration/admin headroom ≤ max_connections − superuser_reserved`.
- Recommendation: **PgBouncer in transaction mode** in front of Postgres. App pools stay at 10 per process. PgBouncer `default_pool_size` = ~2-4 × Postgres cores.
- What works through txn mode:
  - `pg_advisory_xact_lock` (used everywhere today): yes.
  - Unnamed prepared statements (node-pg default): yes.
  - `SET` (session-level): avoid. Today it is not used (verify in Phase 0 with `grep -rn "SET " db/ services/`).
- What does NOT work through txn mode: session advisory locks, LISTEN, and `pg_dump`/`pg_restore` (they want a session). These use `DATABASE_DIRECT_URL`.
- Set `idleTimeoutMillis: 30000`, `connectionTimeoutMillis: 5000` and `statement_timeout` per role.
- Readiness fails if the pool cannot get a connection within the timeout.

### 7.5 Redis availability

| Function | Redis down today | Required behaviour |
|---|---|---|
| Response cache | Returns null, reads go to the DB | Same. Add a circuit breaker so a dead Redis does not add 3 retries of latency per call (`maxRetriesPerRequest:3`). |
| API rate limit | Fails open (`middleware/rateLimitStore.ts`) | Same (documented choice). The login limiter must fail **closed per IP after N local attempts**, using a small local fallback counter. |
| OAuth state | Login via OAuth fails | Same (rare). |
| Presence | The roster shows local users only | Same. |
| Bus | — | The DB generation poll (7.1 rule 3) covers it. |
| Admin WS | Works | Same. |

Recommend managed Redis with a replica and automatic failover (ElastiCache, Upstash, or Redis Sentinel with `ioredis` `sentinels:` config). Persistence is not required: every key can be rebuilt.

---

## 8. Load balancing and sticky sessions

### 8.1 What is stateless (any host can serve it)

Every `/api/v1/*` request, SSR HTML, `/uploads/*` (when storage is S3, the LB never sees these because they go to the CDN), feeds, sitemap, unsubscribe, webhooks, plugin `client.js` (after 10.2), component `client.js` (from the DB) and auth/refresh (DB sessions).

### 8.2 What benefits from affinity, and how the app supports it

| Case | Needs the same host? | Design |
|---|---|---|
| Admin WebSocket `/ws/admin` | Only for the life of one TCP connection, which an L7 LB keeps by nature. A **reconnect may land anywhere**, because presence is in Redis. | No sticky cookie. LB idle timeout > the server ping interval (10 s, `adminChannel/server.ts:117`). On drain the server sends close code **1012 (Service Restart)**. The client (`packages/cms/src/services/adminChannel.ts`) reconnects with full jitter (0.5-5 s), re-sends `hello` + current page, and receives a fresh `welcome`. |
| Long uploads (media ≤500 MB, restore ≤4 GB) | One request = one connection. | No affinity. Phase 3: direct-to-S3 presigned uploads take the bytes off the LB entirely (11.3). |
| Restore / update / backup-run / plugin install | Today they are long synchronous requests (R5). | Make them **async jobs**: `POST` returns `{ operationId }` and the client polls `GET /operations/:id` on **any** host (status row in the DB). No affinity needed. |
| Future multi-step server state (chunked uploads, SSE) | Maybe. | Optional affinity cookie (below). |

**Built-in affinity support (optional, off by default):**

- Every response carries **`X-Instance-Id: <INSTANCE_ID>`** (and `Server-Timing: inst;desc="api-2"`). Useful for support and logs. It hides nothing secret. It can be turned off with `EXPOSE_INSTANCE_ID=false`.
- `AFFINITY_COOKIE=ss_aff` *(new, off by default)*: when on, the server sets `ss_aff=<opaque hash of INSTANCE_ID>; Path=/; HttpOnly; Secure; SameSite=Lax` and no Max-Age (session). LBs that support app-cookie stickiness use it (HAProxy `cookie … indirect preserve`, ALB application-based stickiness, nginx `sticky cookie` in Plus, or a `hash $cookie_ss_aff consistent` upstream in OSS).
- The app must **never** require it. A request for a draining or unknown instance is served normally by whichever host receives it.
- A host in drain stops issuing `ss_aff` and clears it (`Max-Age=0`), so sticky clients move off before shutdown.

### 8.3 Health endpoints

| Path | Meaning | Checks | LB use |
|---|---|---|---|
| `GET /api/v1/health/live` (exists) | The process is alive and its event loop is responsive. | Event-loop lag < 2 s (new; today it is static `{live:true}`). | Restart policy (k8s liveness, systemd watchdog). |
| `GET /api/v1/health/ready` (exists, extended) | Send me traffic. | Boot complete. Not draining. Not in maintenance (writes) **or** reported as degraded. DB `SELECT 1` within 1 s. Redis ping (degraded, not failed, if down). Schema not behind code (`schema_migrations` contains every file this build ships, ignoring disabled-feature files). Frontend template loaded (when SSR is on). | LB target health. Returns 503 when not ready. |
| `GET /api/v1/health/detailed` (exists) | Human / monitoring. | + instance info (5.5), job lease counts and bus lag. | Monitoring only. **Restrict to staff, or omit the internals for anonymous callers.** |
| `GET /api/v1/health/instance` *(new)* | Which instance answered. | `InstanceInfo`. | Debugging. |

Role `worker` answers `ready` with 503 `{reason:'worker-role'}`. If it is placed behind an LB by mistake, it gets no traffic.

### 8.4 Drain and graceful shutdown (replaces `lib.ts:288-362`)

On `SIGTERM`, or an `instance.drain` bus message, or `POST /api/v1/admin/instances/:id/drain`:

1. `draining = true`. `/health/ready` → 503 at once. Stop issuing the affinity cookie. Add `Connection: close` to responses.
2. Wait `SHUTDOWN_DRAIN_MS` (default 10 s, ≥ LB health interval × unhealthy threshold) so the LB stops sending new requests. Requests that still arrive are served normally.
3. Stop claiming jobs. Running jobs keep their lease heartbeat until they finish, up to the deadline. If not finished, they release the lease (`lease_until = now()`) so another worker takes over at once. A mail send stops after the current chunk.
4. Send WebSocket close `1012` to all `/ws/admin` clients. Remove this process's presence slice (`shutdownPeers()`).
5. `server.close()` (stop accepting) and wait for in-flight requests until `SHUTDOWN_TIMEOUT_MS` (default 30 s; today 3 s). Then `closeIdleConnections()`, and only at the deadline `closeAllConnections()`.
6. `flushAll()` revisions (already there), release leases, unsubscribe from the bus, close the pool and Redis, then exit 0.

Set `server.keepAliveTimeout = LB_IDLE_TIMEOUT_MS + 5000` and `server.headersTimeout = keepAliveTimeout + 1000`. Otherwise the LB re-uses a socket the server just closed, which gives a random 502.

### 8.5 Example LB configs

**nginx (OSS), three API hosts, no stickiness (recommended):**

```nginx
map $http_upgrade $connection_upgrade { default upgrade; '' close; }

upstream sitesurge_api {
    least_conn;
    server 10.0.0.11:3001 max_fails=3 fail_timeout=10s;
    server 10.0.0.12:3001 max_fails=3 fail_timeout=10s;
    server 10.0.0.13:3001 max_fails=3 fail_timeout=10s;
    keepalive 64;                       # upstream keepalive; server keepAliveTimeout must exceed nginx's 60s default
}
# Optional stickiness (OSS): consistent hash on the app's affinity cookie, falling back to IP.
# upstream sitesurge_api { hash $cookie_ss_aff$binary_remote_addr consistent; ... }

server {
    listen 443 ssl http2;
    server_name www.example.com;
    client_max_body_size 600m;          # media; restore goes direct-to-S3 in Phase 3
    proxy_read_timeout 120s;

    location = /ws/admin {
        proxy_pass http://sitesurge_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 1h;          # server pings every 10s
    }
    location / {
        proxy_pass http://sitesurge_api;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_next_upstream error timeout http_502 http_503;   # retries idempotent requests only (nginx default excludes non-idempotent)
    }
}
```

OSS nginx has only passive health checks (`max_fails`). Drain then works only because the host keeps serving during `SHUTDOWN_DRAIN_MS` while `ready` is 503. For active checks, use HAProxy, nginx Plus or a cloud LB.

**HAProxy (active checks + optional app-cookie stickiness):**

```haproxy
backend sitesurge_api
    balance leastconn
    option httpchk GET /api/v1/health/ready
    http-check expect status 200
    default-server inter 2s fall 2 rise 2 slowstart 10s
    timeout tunnel 1h                                  # websockets
    # cookie ss_aff indirect preserve nocache          # enable only with AFFINITY_COOKIE=ss_aff
    server api1 10.0.0.11:3001 check # cookie api1
    server api2 10.0.0.12:3001 check # cookie api2
    server api3 10.0.0.13:3001 check # cookie api3
```

**AWS ALB:** target group health check `/api/v1/health/ready` (interval 5 s, unhealthy threshold 2). Deregistration delay = `SHUTDOWN_TIMEOUT_MS` (30 s). Idle timeout 60 s (server keep-alive 65 s). WebSockets are supported natively. If affinity is needed, use stickiness type "application-based cookie" with cookie name `ss_aff`. Put CloudFront in front for the static and edge routing (9.3).

**Cloudflare:** Cloudflare Load Balancing pools with a monitor on `/api/v1/health/ready`. Session affinity "by cookie" uses CF's own `__cflb` cookie; leave it off. WebSockets: on. Proxy read timeout is 100 s (Enterprise can raise it), which is a further reason for async long operations (R5). Keep `deploy/` real-IP config (`CF-Connecting-IP`) and set `TRUST_PROXY` accordingly.

---

## 9. Static frontend split

### 9.1 What the SPA needs from the backend today

Inventory: section 3.5 plus the routes the backend serves at the site root: `/feed.xml`, `/sitemap.xml`, `/robots.txt`, `/logo.png`, `/favicon.ico`, `/apple-touch-icon.png`, `/icons/icon-{192,512}.png`, `/manifest.webmanifest` (`routes/siteAssets.ts:53-87`), `/u/*`, `/lists/*` (`routes/unsubscribe.ts`), `/uploads/*`, `/avatars/*`, `/ws/admin`, and HTML navigations (SSR via `middleware/ssr.ts`, fallback `app.ts:286-303`).

### 9.2 Topology options

| | A. One origin, path-routed at the edge (**recommended**) | B. Same-site API subdomain (`www.` static + `api.` backend) | C. Different site (`example.com` + `example-api.net`) |
|---|---|---|---|
| Cookies | Unchanged (host-only, Lax) | Auth cookies host-only on `api.` and sent on same-site fetch with `credentials:'include'` (works, because subdomains are same-site). CSRF cookie unreadable from `www.` → **change CSRF delivery** | Third-party cookies are blocked by browsers → must move to bearer tokens in memory + refresh rotation. Large change. |
| CSRF | Unchanged | Return the token in a response header/body (`GET /api/v1/auth/csrf` → `{token}`) and keep it in memory. Or set `Domain=.example.com` (weaker: any subdomain can set or read it). | Bearer auth skips CSRF (already the case, `middleware/csrf.ts`). |
| CORS | Not used | Explicit origin list with `credentials:true` (exists) | Same |
| CSP | API still sends it on SSR HTML. `'self'` still correct. | Static host must send the CSP. `connect-src` must add `https://api.…` and `wss://api.…`. `script-src` must add the API origin for plugin and component `client.js`. | Same as B |
| SSR / SEO | Edge sends HTML navigations to the LB → SSR as today | HTML on `www.` is static unless an edge function calls the API → see 9.4 | Same as B |
| Code changes | Small (9.5) | Medium | Large |
| Email links, OAuth callbacks, webhooks | Work (one origin) | Need a separate `apiOrigin` (U7) | Same as B |

**Recommendation: A.** "Published separately" still holds: the frontend build goes to object storage with its own pipeline and versioning. The edge (CloudFront / Cloudflare / nginx) only decides which origin answers each path. Options B and C cost cookie and CSRF rewrites and gain nothing for a CMS that serves its own public site. Still do the `apiOrigin` separation (U7) and the CSRF header option, because they are cheap and keep B possible later.

### 9.3 Edge routing table (option A)

| Path | Origin | Cache |
|---|---|---|
| `/assets/*` | Object storage (frontend build) | `immutable, max-age=31536000` |
| `/sw.js`, `/workbox-*.js`, `/registerSW.js` | Object storage | `max-age=0, must-revalidate` (as `app.ts:272-282`) |
| other files in the build root (`/icons-static/*`, fonts shipped in `public/`) | Object storage | 1 day |
| `/api/*`, `/ws/admin` | LB | no-store (API decides) |
| `/uploads/*` | Media bucket / CDN (S3 provider returns `cdnUrl` URLs already; keep a redirect route for legacy `/uploads/` URLs) | long |
| `/feed.xml`, `/sitemap.xml`, `/robots.txt`, `/logo.png`, `/favicon.ico`, `/apple-touch-icon.png`, `/icons/*`, `/manifest.webmanifest`, `/u/*`, `/lists/*`, `/avatars/*` | LB | As the API sets (`s-maxage=300` for site assets) |
| everything else (HTML navigations) | LB (SSR) | API sets the micro-cache (`utils/cachePolicy.ts`) |

Move the PWA icons and manifest out of `config/cms/vite.config.ts:43,51-67` `includeAssets`, or keep them but make sure the edge sends those paths to the LB (they are generated from Site Branding).

### 9.4 SSR / SEO strategy

The SSR needs one input from the frontend build: `index.html` with the content-hashed asset URLs and the `SSR_META` / `SSR_BODY` markers.

- **A (recommended): API renders, template from the published build.**
  - The publish pipeline uploads `dist/` and writes `build.json` = `{ buildId, indexHtmlUrl, publishedAt }`. The previous build's `/assets/*` stay for ≥ 7 days, so old shells keep working during skew.
  - The API loads the template from `FRONTEND_TEMPLATE_URL` (or `runtime_config.frontend.templateUrl`). It fetches with ETag every 30 s and on `frontend.build.changed`, and falls back to local `dist/` when present (single-host installs unchanged).
  - SSR cache key = `ssr:html:{buildId}:{gen}:{path}` (fixes S11). Remove `ensureFreshBuild`.
  - The SPA fallback (`app.ts:286-303`) serves the same fetched template instead of `sendFile`.
- **B: Edge-composed SSR.** The edge serves static `index.html`. An edge worker (Cloudflare Worker `HTMLRewriter` / Lambda@Edge) calls `GET /api/v1/ssr/fragments?path=` → `{ status, head, body }` (new endpoint, wraps `renderPublicRoute` without the template) and injects it into the markers. The API then needs no template at all. The cost is an edge function to own and debug. A good later step if the frontend team wants full independence.
- **C: Pre-render at publish time** to object storage (the dead `cache/static-html` hook, S12). Content changes need a re-render and purge pipeline. Not recommended for a CMS with frequent edits; skip.
- **D: Bot-only dynamic rendering.** Google discourages it, and it duplicates logic. Skip.

The CSP for SSR HTML stays in the API (`middleware/csp.ts`). If B is chosen later, the edge copies the API's CSP from the fragments response.

### 9.5 Frontend and API changes for option A (and B-readiness)

1. `packages/cms/src/services/cmsClient.ts`: `baseUrl = import.meta.env.VITE_API_ORIGIN || window.location.origin`. Option A keeps the default.
2. `packages/cms/src/services/adminChannel.ts`: build the WS URL from the same API origin (`http`→`ws`).
3. Replace relative `/api/v1/...` literals with `cms`-derived URLs: `plugins/host.ts:63-104` (also use the client's CSRF accessor instead of reading `document.cookie`), `pages/admin/PluginConfig.tsx:112`, `services/componentScript.ts:41`, `cms-client/src/modules/components.ts:63-65` (prefix `baseUrl`), `pages/Join.tsx:20`, `stores/auth.tsx:144`.
4. `cms-client` `authManager.ts:87-101`: if `document.cookie` has no `csrf-token`, call `GET /api/v1/auth/csrf` (new, returns `{ token }` and sets the cookie) and keep the token in memory. Same-origin behaviour stays the same.
5. API config split (U7): `site.publicOrigin` (pages, emails, canonical) vs `site.apiOrigin` (OAuth callbacks `services/connections.ts:353`, provider webhook URLs `routes/shopProviders.ts:30`, `/u/` and `/lists/` email links, `/logo.png` in emails). Both default to `FRONTEND_URL`.
6. PWA: exclude `/u/`, `/lists/` and `/ws/` from the `html-shell` NetworkFirst rule (`config/cms/vite.config.ts:92-101`). Bump the SW so clients drop the old rule.
7. Dev proxy: add `ws:true` for `/ws/admin`, plus `/logo.png`, `/favicon.ico`, `/icons`, `/apple-touch-icon.png`, `/manifest.webmanifest`, `/u`, `/lists` (`config/cms/vite.config.ts:146-158`).
8. `app.ts`: make static serving optional (`SERVE_FRONTEND=auto|true|false`). In fleet mode with a template URL, skip `/assets` + `express.static(dist)`.
9. WebSocket `Origin` check (R9).

---

## 10. Filesystem state elimination

### 10.1 Media, fonts, avatars

- Fleet mode **requires** a non-local storage provider. At boot: if `FLEET_MODE` and the provider resolves to `local`, log an error and set `ready` to 503 with a clear reason. Do not crash the process, so `/setup` and health still answer.
- Fix S16: `getStorageProvider()` resolves env → `media_storage` DB row → default, and rebuilds on `storage.changed`.
- Fonts (`services/fonts.ts`): upload through the provider and store the returned URL in `fonts.url` (the repository hard-codes `/uploads/fonts/…` today). The `@font-face` URL must allow the CDN in CSP `font-src` (add the media CDN host).
- Avatars: multer `memoryStorage` (≤5 MB) → sharp → provider. One-time script copies `DATA_DIR/avatars/*` to the bucket and rewrites `users.avatar_url`.
- Twitter media (`services/social/twitterMedia.ts`): fetch via URL, not disk.
- Multer temp for large media: keep `diskStorage` into `TMP_DIR` (request-local scratch is fine). Phase 3: presigned direct uploads (`POST /media/upload-url` → PUT to S3 → `POST /media/complete` for thumbnails). Bytes then never cross the LB.
- Migration path for existing local installs: `sitesurge media:migrate --to s3` (copy objects, rewrite URLs in the tables listed in CLAUDE.md "Media storage config", flush Redis). This procedure is already documented but has no tool yet.

### 10.2 Plugins

The plugin **package** becomes a DB/object-storage artifact, and `PLUGINS_DIR` becomes a per-host cache:

- New table `plugin_packages(name, version, sha256, source text /* zip|marketplace|bundled */, archive bytea NULL, archive_url text NULL, created_at)`. Small packages (<10 MB) go into `bytea`. Larger ones go into the media bucket under `plugins/<name>/<version>.zip`.
- Install, upload or update on any host: store the archive → the existing lifecycle (txn + `pg_advisory_xact_lock('plugin:<name>')`, so DDL runs once) → publish `plugins.changed{name, version, sha256}`.
- Every host, on boot and on that event: if `PLUGINS_DIR/<name>/.sha256` differs, extract the archive into `PLUGINS_DIR/<name>.tmp-<pid>` and atomically rename it into place. Bust the require cache (`getServerModule(…, reload=true)`). Run `onLoad` (enabled) or `onDisable` locally. `rescan()` must stop marking a missing folder as "missing" in fleet mode. It should materialise the folder instead.
- **Hook split.** `install`/`uninstall`/`update` (DDL, once) run only in the requesting process. `onLoad`/`onDisable` (in-memory side effects) run in **every** process. This must be documented in `docs/PLUGINS.md` as part of the plugin contract.
- Plugin `.data` storage (`plugins/loader.ts:161-188` `makeStorage`): back `write`/`read` with the storage provider (`plugins/<name>/data/<key>`). `download()` (vendor bundles such as PageLoop's `ensureBundle`) stays a local cache filled on demand on each host (idempotent today).
- `client.js` and assets are served from the local materialised copy, which is identical on every host by sha256. Add `ETag` = sha256.

### 10.3 Backups

See 11.3. Temp files stay in `TMP_DIR` and are always removed in `finally`. The safety dump goes to the **configured backup destination** (never only tmpdir). Fleet mode refuses the `local` backup destination unless the path is on shared storage, which the operator confirms with a flag.

### 10.4 Logs

- `LOG_TARGET=stdout` (fleet default): winston JSON to stdout only, with `instanceId`, `process`, `requestId` and `route` on every line.
- `X-Request-Id`: accept it from the LB (trusted hops only) or generate a ULID. Return it on the response. Pass it into the logger with `AsyncLocalStorage`.
- Admin **Server Logs** panel (`services/serverLogs.ts`): each process also writes WARN+ lines to a Redis capped list `logs:<instanceId>` (`LTRIM` 2 000). The panel shows a per-instance selector. Full logs go to the operator's sink (Loki, CloudWatch, Datadog).
- Optional `/metrics` (prom-client, staff or token protected): request rate and latency, pool usage, job lag, bus lag and mail send rate.

### 10.5 Setup wizard

- Single host (default): unchanged. It writes `.env` and restarts.
- Fleet mode: the wizard **never** writes `.env`. The env stage is skipped (bootstrap env is mandatory and comes from orchestration). Everything else (admin user, seed, site settings and the "env" values listed in 5.2) goes to the DB. "Transition to running" publishes `config.changed` + `features.changed`, and every host leaves setup mode through its 5 s installation-state cache (`services/installation/detector.ts:22`), not through `process.exit`.
- Add an install lock: `pg_advisory_xact_lock('sitesurge:install')` around `runInstallation` (`services/setup/installer.ts`).

---

## 11. Deploy and rollout

### 11.1 Rolling deploy procedure

1. Build and publish the image (`ghcr.io/rw3iss/sitesurge-server:<v>`) and the frontend build (object storage, new `buildId`; do not delete old assets).
2. Run **`sitesurge migrate`** once (k8s Job / CI step) against `DATABASE_DIRECT_URL`. It takes the global session lock `hashtext('sitesurge:migrate')`. It is idempotent, so a re-run is safe.
3. Roll instances one at a time (or with `maxUnavailable=1`). Each one: SIGTERM → drain (8.4) → start the new version → `ready` turns 200 → next.
4. Publish `frontend.build.changed{buildId}` (CLI), or let the 30 s template poll find it.
5. When every instance reports the new version (Instances panel / `instances` table), run any **contract** migrations in the next release.

### 11.2 Migration discipline (expand / contract)

During a rolling deploy, old and new code run against one schema. Rules for new migrations (add to `docs/PUBLISHING.md` and a PR checklist):

- **Expand (release N):** add nullable columns or columns with defaults, new tables and new indexes (`CREATE INDEX CONCURRENTLY` in a non-transactional migration; the migrator needs a `-- @no-transaction` header for that). Old code must ignore new columns. `SELECT *` + `mapRow` already tolerates them, but check any `INSERT` with positional values.
- **Migrate data** in batches (background job, not boot).
- **Contract (release N+1 or later):** drop columns or tables, add `NOT NULL`, rename. Never in the same release that stops using the column.
- Enum additions (`ALTER TYPE … ADD VALUE`) are safe to expand. Old code must tolerate unknown enum values on read (`block_type` already does via a fallback renderer).
- **Readiness gate:** a new instance is `ready` only if every migration file it ships is applied (or is feature-tagged for a disabled feature). An old instance whose DB is *ahead* stays ready. This is why expand/contract matters.
- **Cache payloads:** prefix keys with `CACHE_NAMESPACE` (7.3) so old and new versions do not read each other's shapes.
- **Bus messages:** carry `v`. Receivers ignore unknown topics and versions.
- **API ↔ SPA skew:** the CDN may serve a newer SPA to an older API, or the reverse, for minutes. Additive API changes only within a minor release. The SPA tolerates missing fields. The old build's assets stay ≥ 7 days.
- **Feature enable at runtime (lazy migrations)** during a rollout: block `PUT /settings` feature enables (return 409 "rollout in progress") while the instance versions differ, because an old instance could lack the migration files of a newer feature.

### 11.3 Backup and restore in a fleet

- **Backup** (download or destination): an async operation on a `worker`/`all` process. `POST /settings/backup/operations` → `{ operationId }`. The dump is written to `TMP_DIR` and uploaded to the destination (or to a short-lived object with a presigned download URL for "download"). The client polls `GET /operations/:id` on any host. The download uses the presigned URL and never streams through the LB.
- **Restore** becomes a fleet maintenance operation:
  1. The client uploads the dump **directly to object storage** (presigned PUT), then `POST /settings/restore/operations { objectKey, confirm:'REPLACE' }`.
  2. A worker claims the operation and takes `pg_advisory_lock('sitesurge:maintenance')` on a direct connection.
  3. `validateDump` (unchanged), then a safety dump **to the backup destination**.
  4. Publish `maintenance{begin}`. All instances return 503 `MAINTENANCE` for writes and non-health reads (`ready` stays 200 so the LB does not take every host out), stop claiming jobs, and pause mail sends at the next chunk. Wait for acknowledgements (each instance sets `instance:<id>.maintenanceAck` in Redis) or 15 s.
  5. `pg_restore` / `psql` (unchanged), then `runMigrations()` under the migrate lock, then `cache.flushAll()`.
  6. Publish `db.restored`. Every process: `resetPool()`, drop all local caches, reload entity manager / permissions / plugins / CSP / config snapshot.
  7. Publish `maintenance{end}`. The status row stores the result, including `undoVersion` (the safety dump object key).
- **Remove `process.exit`-style assumptions.** No step needs a restart.

### 11.4 "Update & restart" in a fleet

- `services/systemUpdate.ts` `runUpdate` (npm install + `process.exit`) is **disabled in fleet mode**, the same way it already refuses source installs (`:280-291`). The panel shows `installKind: 'fleet'` with:
  - the latest version (npm, unchanged),
  - a per-instance version table (from `instances`),
  - the rollout instructions for the operator's platform (image tag bump / `helm upgrade` / `docker compose pull && up -d --no-deps` per host).
- Optional later: a `desired_version` row that an external agent or operator (k8s, systemd timer script) watches. The app never upgrades itself in a fleet. That would mean one host replacing its own code while the others serve, with no migration step in between.
- Single-host npm installs keep today's in-app update. Also fix the cluster case: after `npm install`, signal the **primary** (`process.kill(process.ppid, 'SIGTERM')` when `cluster.isWorker`) so systemd restarts the whole service and not just one worker (today the primary keeps running old code).

---

## 12. Phased implementation plan

Each phase can ship by itself, keeps single-host behaviour unchanged, and has its own acceptance tests. Effort: S ≤ 1 day, M 2-4 days, L 1-2 weeks.

### Phase 0: Correctness fixes that matter even on one host (S-M, low risk)

| Task | Files | Risk |
|---|---|---|
| Stripe event dedupe table + fix the refund and membership `transactions` inserts + no re-notify on retry | new migration; `services/payment/webhook.ts:61-71,238-259,365-392` | Low |
| Login limiter on `RedisRateLimitStore` | `routes/auth.ts:153-169` | Low |
| Patreon OAuth state check + atomic `GETDEL` | `routes/auth.ts:175-214`, `services/cache.ts:404-409` | Low |
| `delPattern` → `SCAN`+`UNLINK` | `services/cache.ts:143-155` | Low |
| Migration session lock | `db/migrator.ts:141` | Low |
| `getStorageProvider` honours the `media_storage` DB row | `services/storage/index.ts`, `services/settings.ts:675` | Medium (changes which bucket is used if DB ≠ env; env still wins) |
| Register the events reminder sweep job | `lib.ts`, `services/events/notifications.ts:160` | Low |
| Entity data provider registered on feature enable | `services/features/cascade.ts`, `entities/dataProviders.ts` | Low |
| Entity manager reload after feature uninstall | `services/featureUninstall.ts` | Low |
| Revision `snapshot` per-entity advisory lock | `services/revisions.ts:191-229` | Low |
| PWA rule excludes `/u/`, `/lists/` | `config/cms/vite.config.ts:92-101` | Low |
| WS `Origin` check | `services/adminChannel/server.ts:216-238` | Low |
| Delete the dead `cache/static-html` read | `services/ssr/index.ts:145-153,179-183` | Low |

**Acceptance:**

- Replaying the same Stripe event twice yields one `transactions` row.
- Two `runMigrations()` called in parallel from a test both resolve, and the files are applied once.
- The login limit holds across 2 processes (`CLUSTER_WORKERS=2`).
- Changing the media storage in the admin changes where the next upload lands.

### Phase 1: Instance identity, health, drain, timeouts (M, low risk)

| Task | Files |
|---|---|
| `src/instance.ts` (`INSTANCE_ID`, `INSTANCE_ROLE`, `FLEET_MODE`, heartbeat to Redis + `instances` table) | new; `config/schema.ts`, `config/loader.ts`, `lib.ts` |
| `X-Instance-Id`, `X-Request-Id`, AsyncLocalStorage logger context, JSON stdout | `app.ts`, `utils/logger.ts` |
| `/health/live` loop lag, `/health/ready` extended, `/health/instance` | `routes/health.ts`, `services/health.ts` |
| Drain sequence + configurable timeouts + server keep-alive | `lib.ts:288-362`, `lib.ts:255` |
| WS close 1012 + client jittered reconnect | `services/adminChannel/server.ts`, `packages/cms/src/services/adminChannel.ts` |
| Presence peers always on with a Redis connection, id = `INSTANCE_ID:process` | `services/adminChannel/server.ts:209-213` |
| `TRUST_PROXY` | `app.ts:59` |
| Optional `ss_aff` cookie (off) | `app.ts` (small middleware) |
| Admin Instances panel (read-only) | `routes/settings.ts` or new `routes/instances.ts`, SDK `cms.instances`, cms panel |

**Acceptance:**

- `docker compose` with 3 instances: kill -TERM one during a 1 000-request `autocannon` run → 0 non-2xx responses.
- Presence shows users connected to different instances.
- `ready` turns 503 within 1 s of SIGTERM.

### Phase 2: Shared config + invalidation bus (L, medium risk)

| Task | Files |
|---|---|
| `runtime_config` table + encryption (`CONFIG_ENCRYPTION_KEY`) + loader merge + Proxy swap | new migration; `config/loader.ts`, new `config/runtime.ts` |
| Admin UI for the 5.2 groups (env-locked fields read-only) | settings panels, `@sitesurge/types` DTOs, `cms.settings.runtime*` |
| `services/bus/` (publish, subscribe, `afterCommit`, `cache_generations` + 15 s poll) | new |
| Wire every topic in 7.2 (emitters + receivers) | `services/permissions/index.ts`, `entities/entityManager.ts`, `services/payment/credentials.ts`, `middleware/csp.ts`, `services/analyticsCsp.ts`, `services/plugins.ts`, `services/notifications/index.ts`, `services/ssr/routes.ts`, `services/ssr/templateRuntime.ts`, `services/siteAssets.ts`, `services/storage/index.ts`, `services/mail/providers/factory.ts`, `app.ts` (CORS and limiter rebuild), `services/features/cascade.ts`, `services/featureUninstall.ts` |
| Route `PUT /settings/:key` raw writes through the same hooks | `services/settings.ts:739` |
| Encrypt existing plaintext secrets (Stripe, media, backup, plugins, shop providers) | data migration + read paths |
| `CACHE_NAMESPACE` prefix | `services/cache.ts` `CACHE_KEYS` |

**Acceptance (bus test harness, 2 processes against one DB + Redis):**

- Enable a feature on A → within 1 s B allows the new permission key (no 403) and resolves the new entity type.
- Change Stripe keys on A → B's next PaymentIntent uses the new key.
- Kill Redis, change a permission on A → B converges within 15 s (generation poll).
- Single-host regression suite unchanged.

### Phase 3: Jobs, mail worker, async operations (L, medium-high risk)

| Task | Files |
|---|---|
| `job_schedules` / `job_runs` + claim loop + heartbeat; `CronRegistry` becomes a facade | `services/cron.ts`, new migration, `lib.ts` (remove `runOnceOnlyWork` cron gating) |
| Move every job (6.3), including social provider rows and merchandise claim columns | `services/socialCrons.ts`, `services/connections.ts:298,535`, `services/shop/merchandiseAnnounce*.ts`, `services/backup/cron.ts`, `services/backup/schedule.ts`, `services/printify/cron.ts`, `services/scheduledPublisher.ts`, `services/mail/scheduleCron.ts` |
| Mail job leases + recipient `claimed_at` + remove the boot resumer | `services/mail/sendWorker.ts`, `repositories/mailSendJobs.repo.ts`, `repositories/mailSendRecipients.repo.ts`, `services/mailSend.ts`, `lib.ts:192-199` |
| `operations` table + `GET /operations/:id` for backup / restore / plugin install / update-check | new `services/operations.ts`, `routes/settings.ts:532-590,724-790`, `routes/plugins.ts:83-96`, SDK + `BackupRestorePanel.tsx` |
| Presigned upload / download for backups (and optional for media) | `services/backup/destinations.ts`, `services/storage/s3.ts`, `routes/media.ts` |
| Restore maintenance protocol (11.3) | `services/backup.ts:259-368`, bus, `middleware/` new `maintenance.ts` |
| Admin Jobs view from the DB | `services/dev.ts`, cms panel |

**Acceptance:**

- 3 `all` instances + a 5 000-recipient list send → every address receives exactly one message (MailHog count). Kill the leasing instance mid-send → another one finishes, still with no duplicates.
- Merchandise announce triggered on all 3 at the same minute → one email per subscriber.
- A cron list shows the same state from every host.
- A restore with 3 instances → no 5xx outside the maintenance window, and every instance serves restored data afterwards without restart.

### Phase 4: Filesystem elimination (M-L, medium risk)

| Task | Files |
|---|---|
| Fleet guard: no local storage provider, no local backup destination without a flag | `services/storage/index.ts`, `services/health.ts` |
| Fonts and avatars through the provider + migration script | `services/fonts.ts`, `repositories/fonts.repo.ts`, `services/users.ts`, `routes/users.ts`, new `scripts/` |
| Plugin packages in the DB/object storage + local materialisation + hook split | `plugins/loader.ts`, `services/plugins.ts`, new migration, `docs/PLUGINS.md` |
| Plugin `.data` storage on the provider | `plugins/loader.ts:161-188` |
| Redis log ring buffer + per-instance Server Logs panel | `utils/logger.ts`, `services/serverLogs.ts` |
| Setup wizard fleet mode (no `.env`, install lock) | `services/setup/*`, `services/lifecycle.ts` |
| Revision dirty table + sweeper | `services/revisions.ts` |
| `media:migrate` CLI | `packages/cli` |

**Acceptance:**

- Install a marketplace plugin through host A, then load `/api/v1/plugins/<name>/client.js` through B and C → 200 with an identical ETag.
- Upload media, a font and an avatar through A → served everywhere.
- Delete every host's local disk state (fresh containers) → the site is identical.

### Phase 5: Static frontend split (M, medium risk)

| Task | Files |
|---|---|
| `build.json` emit + `sitesurge publish-frontend` (upload `dist/`, keep old assets, publish `frontend.build.changed`) | `config/cms/vite.config.ts` (plugin), `packages/cli` |
| SSR template from URL + `buildId`-keyed SSR cache; remove `ensureFreshBuild` | `services/ssr/index.ts`, `middleware/ssr.ts`, `app.ts:234-303` |
| `SERVE_FRONTEND` switch | `app.ts` |
| `publicOrigin` / `apiOrigin` split | `services/connections.ts:353`, `routes/shopProviders.ts:30`, `services/mail/sendWorker.ts:94-147`, `services/mailingLists.ts:269`, `services/donationReply.ts:86`, config |
| SPA API-origin + WS-origin + relative URL clean-up + CSRF endpoint fallback | 9.5 items 1-4, 6-7 |
| Edge config examples (CloudFront behaviours, Cloudflare rules, nginx) | `deploy/` (new example files) |
| Optional: `GET /api/v1/ssr/fragments` for edge composition (9.4 B) | `routes/ssr.ts` new |

**Acceptance:**

- With `SERVE_FRONTEND=false` and the build on MinIO behind nginx path routing: `curl -A Googlebot /posts/<slug>` returns server-rendered `<title>`, canonical and body. A browser boots the SPA, logs in, saves a page, the admin WS connects, and plugin and component scripts load.
- Deploy build B while instances still hold build A → no HTML references a missing asset (Playwright crawl of 50 pages, every `<script src>` returns 200).

### Phase 6: Fleet operations polish (S-M)

- Update panel in fleet mode (11.4). Cluster-worker update restart fix.
- Feature-enable block during version skew (11.2).
- PgBouncer docs + `DATABASE_DIRECT_URL` usage for migrate / backup / restore.
- Redis Sentinel config support.
- `/metrics`.
- Docs: README "Scaling" section, `docs/PUBLISHING.md` expand/contract, `docs/PLUGINS.md` hook contract, `/admin/help` page, CLAUDE.md "Scaling (multi-process)" section rewritten for multi-host.

### Testing strategy

- **Unit:** job claim SQL (two clients race against a test DB with `Promise.all`), bus `afterCommit` (no publish on rollback), generation poll, config merge precedence, encryption round-trip, SSR key composition.
- **Integration harness** `config/fleet/docker-compose.yml` *(new)*:
  - `postgres:18`, `pgbouncer` (txn mode), `redis:7`, `minio` (uploads + frontend bucket), `mailhog`.
  - `api-1`, `api-2` (`ROLE=web`), `worker-1` (`ROLE=worker`), all on the same image with `FLEET_MODE=true`.
  - `nginx` with the 8.5 config + 9.3 path routing.
  - A `stripe-cli` container for webhook replay (`stripe trigger`, `stripe events resend`).
- **Scenario scripts** (`tools/fleet-tests/*.mjs`, run in CI on a nightly job):
  1. Cache coherence: write through api-1, read through api-2 for each 7.2 topic.
  2. Exactly-once: mail send, merchandise announce, backup cron, webhook replay ×5.
  3. Chaos: `docker kill` worker-1 mid-send; `docker pause redis` for 30 s; restart api-2 during `autocannon` (`tools/loadtest.mjs` exists).
  4. Rolling deploy: image N → N+1 with an expand migration, under load; assert 0 errors and that no SSR shell references a missing asset.
  5. Restore under load: assert the maintenance window and recovery.
- **Load:** reuse `tools/loadtest.mjs` against nginx. Record p95 and pool saturation with 1, 2 and 3 web instances.

---

## 13. Open questions

1. **Fleet detection.** Should fleet guards turn on only with `FLEET_MODE=true`, or also automatically when the `instances` table shows >1 live instance? Auto is safer against misconfiguration but can surprise single-host users during a blue/green swap. Proposal: auto-warn, explicit enable.
2. **`JWT_SECRET` in DB vs env.** This plan keeps it in env (a DB leak must not forge sessions). Is a secrets manager (AWS SM, Vault, Doppler) in scope, or is env-from-orchestration enough?
3. **Encryption of existing plaintext secrets.** This changes backup portability, because a restore needs the key. Acceptable, or keep it optional?
4. **Plugin packages in `bytea` vs object storage only.** `bytea` keeps backups self-contained (CLAUDE.md: backups are DB-only, files excluded). Recommendation: `bytea` up to 10 MB. Agree?
5. **Edge choice for the static split.** Cloudflare (already in use for surgemedia.us; Workers enable 9.4 B later) vs CloudFront vs plain nginx. That decides which example configs ship first.
6. **Maintenance semantics during restore.** Read-only (serve stale reads) or full 503? The plan says 503 for everything except health and static. Read-only is friendlier but serves data that is about to be replaced.
7. **Worker role default.** Should the Docker image default to `all`, with a documented `web`/`worker` split, or should the Helm/compose examples always split? Proposal: `all` default, split in the examples.
8. **`CLUSTER_WORKERS` inside containers.** In k8s/ECS, one process per container + more replicas is simpler (no primary/worker split). Should `cluster.ts` remain only for bare-metal installs?
9. **In-app update in a fleet.** Is a `desired_version` + external agent design wanted, or is "disabled, use your orchestrator" enough?
10. **Cache namespace per release** gives a cold cache on every deploy. Is a per-release Redis warm-up (homepage, nav, top posts) needed for the production traffic level?
11. **Rate limits per instance vs global.** The global limiter is already Redis-backed (global). Is a per-instance concurrency cap (shed load with 503 when the event loop lags) also wanted?
12. **Mail send parallelism.** Should one large job be split across several worker processes (multiple lease holders), or is one worker per job (current throughput × N jobs) enough? It depends on the SES sending quota.
