# Audit 2026-11-06 — Social analytics

Scope: the social analytics module (7 collectors, runner/read/audience, digests, AI summary,
dashboard + Audience panel, settings, Facebook Page picker, OAuth flows) — commits 74ea31e5 … 195577e0
since f28ea8ae. Migration used: **204** (205 not needed).

| Status | Count |
|---|---|
| Applied | 50 |
| Skipped / not a bug (noted) | 4 |
| Planned | 2 |
| Lead follow-up | 4 |

Risk: A = low, B = medium, C = high.

## Core (runner, read side, digests, routes, connections)

| # | Title | Location | Problem | Fix | Risk | Status |
|---|---|---|---|---|---|---|
| 1 | Two runs could collect the same platform at once | `analytics/runner.ts` `runCollector` | "Is one running?" SELECT, then INSERT — the cron, "Collect now" and another process could all pass the check. Double API calls; for X paid reads, the monthly spend cap was checked twice against the same total (overspend). | Migration 204: partial unique index `(platform) WHERE status='running'` (closes stale + duplicate running rows first). Runner inserts `ON CONFLICT … DO NOTHING` and returns null when it lost the claim. | B | applied |
| 2 | Runs stuck "running" forever | `runner.ts` | A crashed process left `status='running'`; the admin showed "running" for good (only the 30-min busy check ignored it). | `expireStaleRuns()` closes runs older than 30 min as failed before each claim. | A | applied |
| 3 | Older posts skipped for a week after a missed Monday | `runner.ts` `duePosts` | Posts > 90 days were due on Mondays only; a server down on Monday skipped them a whole week. | Due when the newest row is 7+ days old. | A | applied |
| 4 | Run history grew without limit | `runner.ts` | One row per platform per day + manual runs, never deleted. | `pruneRuns()` after the daily collection: > 180 days, newest per platform kept. | A | applied |
| 5 | Re-run lost account raw JSON | `runner.ts` `storeResult` | A second run the same day replaced `raw` (other numbers COALESCE). A partial re-run lost fields. | `raw = old || new` (merge), like post metrics. | A | applied |
| 6 | "Collect now" could outlive the proxy | `routes/socialAnalytics.ts` `/collect` | Seven sequential collectors (Instagram alone makes hundreds of calls) in one HTTP request → Cloudflare/nginx 504 while the work went on unseen. | `collectNow()`: answers after ≤ 50 s; unfinished collectors keep running and come back as `running` runs. Same response shape. Admin: "Still collecting … refresh in a minute" + an automatic refetch after 60 s. | B | applied |
| 7 | Level metrics summed over the period | `read.ts` `dailySums` | Every daily metric was SUMmed — follower totals (`followers` FB, `followersTotal` TikTok), Patreon members/income → N× too large. Not shown on the overview today, but wrong for any consumer. | `SOCIAL_METRICS[*].aggregate` (`sum`/`last`/`avg`) + `socialMetricAggregate()`; `dailySums` uses it. | A | applied |
| 8 | Day window off by one | `read.ts` `postAggregates` | Avg views / engagement used `BETWEEN from AND to+1` (includes midnight of the next day); the post count used `< to+1`. | Half-open `>= from AND < to+1` everywhere. | A | applied |
| 9 | One broken collector status failed the page | `read.ts` `collectorStatuses` | No catch (overview had one); 7 sequential DB reads. | Shared `statusOf()` (catches → "off · Status unavailable"), all in parallel. | A | applied |
| 10 | Post search treated `%` / `_` as wildcards | `read.ts` `posts` | Searching "50%" matched everything. | `likeEscape()`. Test. | A | applied |
| 11 | Threads comments/shares always empty | `read.ts` `overview` | Threads stores `replies` / `reposts` / `quotes`; the overview read `comments` / `shares`. | Mapped for Threads (comments = replies, shares = reposts + quotes). | A | applied |
| 12 | Scheduled digest built before its data | `digests.ts` cron | A digest due at, say, 01:00 UTC ran before the 06:10 collection, so its last day was empty. | `collectionSettled()` / pure `collectionSettledAt()`: waits for a finished run started on/after `to`+1 00:00 UTC and no run in progress; gives up at `to`+1 09:00 UTC (still the same local day in every zone); no wait when nothing collects. Tests. | B | applied |
| 13 | Digests stuck "generating" | `digests.ts` | A process that died mid-build left the row `generating`; the list polled it every 5 s forever. | `failStaleDigests()` (30 min) in the hourly cron; partial index in migration 204. | A | applied |
| 14 | Unsafe links in the digest email (and its HTML route) | `digestEmail.ts` `postRow` | `post_url` / `thumbnail_url` went into `href`/`src` as stored; a `javascript:` URL would run on the admin origin via `GET /digests/:id/email`. Mirrored thumbnails (`/uploads/…`) were relative → broken images in mail. | `safeUrl()`: http(s) only; site paths made absolute with the view URL's origin. Tests. | A | applied |
| 15 | "Send email" did nothing when auto-email was off | `digestDelivery.ts` | `digestRecipients` returned [] when "Email each digest" was off, so the manual button reported "No recipients" even with addresses set. All-failed sends also read as success. | Manual send ignores the auto switch; response adds `failed` + `reason` (`not_ready` / `no_recipients`); the admin toast says which (`sendResultMessage`). Settings fields stay editable while auto-email is off. Tests. | A | applied |
| 16 | AI summary ignored the configured pool | `summary.ts` `summarize` | Always the `analytics` pool, even when Settings → AI pool names another. | Uses `settings.digest.aiPool` (fallbacks unchanged). | A | applied |
| 17 | Echoed masks overwrote real secrets | `connections.ts` `upsert` | A client that GETs a connection and PUTs it back (SDK, MCP) replaced `appSecret` / tokens with `••••…` and stored `has*` flags. | `withoutMaskedValues()` drops mask values + `has*` flags before the merge. Test. | A | applied |
| 18 | OAuth state not bound to its provider | `connections.ts` OAuth callback | A state issued for provider A was accepted on provider B's callback. | Callback refuses `parsed.provider !== provider`. | A | applied |

## Read side + UI

| # | Title | Location | Problem | Fix | Risk | Status |
|---|---|---|---|---|---|---|
| 19 | Failed loads = endless "Loading…" or a blank admin | `SocialAnalyticsPanel.tsx` | Overview / chart / posts / post history read their resources with no error state; an error left "Loading analytics…" or threw to the app boundary. Resources also suspended the page outlet (period or metric change blanked the page frame). | `LoadError` (message + Retry) per region; each region in its own `StableSuspense`; toolbar reads use `settled()` so they never suspend. | A | applied |
| 20 | Trend chart offered metrics the platform never has | `SocialAnalyticsPanel.tsx`, `read.ts` `series` | A fixed list of 12; most were empty for most platforms, and Facebook/TikTok/Patreon series (reach, follows, video views, patrons, income…) were not selectable. | `series` returns `available` (snapshot columns + daily metrics in range); the select lists those (preferred order first, labels/descriptions from `SOCIAL_METRICS`, units → formatter incl. percent and cents); an unavailable metric falls back to views. | A | applied |
| 21 | Missing metric definitions | `@sitesurge/types` `SOCIAL_METRICS` | `followersTotal`, `lostFollowers`, `videoViews30s`, `videoRepeatViews`, `reactions`, `follows`, Patreon, story and click metrics had no label/description (raw keys in the UI). | 37 definitions added with `unit` (+ `cents`) and `aggregate`. | A | applied |
| 22 | TikTok traffic sources / viewer types stored but not shown | `audience.ts`, `AudiencePanel.tsx` | Written daily, never read. `viewer:*` mixes two splits (new/returning and follower %), so one share list would be wrong. | `snapshotSplits()`: newest snapshot ≤ `to` (never summed); `trafficSources` + `viewerTypes` (new vs returning) on `breakdowns`; the follower split fills `viewsByFollow` when the platform has no daily one. New "How viewers found the videos" block (`sourceLabel`, `viewerLabel`). Tests. | A | applied |
| 23 | Facebook-only audience read as "no data" | `audienceFormat.ts` `audienceHasData` | Ignored `viewsByPaid` / `videoViewsByPlay` / `reactionsByType`, so a Page with only those splits showed "No audience data". | Counts every breakdown (incl. the new TikTok ones). Test. | A | applied |
| 24 | Quadratic grouping | `audience.ts` `contentKinds` / `hashtagStats` | `[...list, r]` per row. | push into the existing array. | A | applied |
| 25 | Chart not accessible | `components/admin/charts/LineChart.tsx` | `role="img"` with no name; hover-only read-out. | `label` prop → `aria-label` summary (days, range, latest, high, low); focusable, ←/→/Home/End/Esc step through points, read out in an `aria-live` region; focus ring. | A | applied |
| 26 | Post rows not keyboard-operable | `SocialAnalyticsPanel.tsx` | Click-only `<tr>` to open the history. | `tabIndex`, Enter/Space, `aria-expanded`, focus + open styles. | A | applied |
| 27 | Raw keys in the posts table | `SocialAnalyticsPanel.tsx` | Platform and kind shown as `instagram · reel`. | Account label + `kindLabel`. Collect toasts use labels too. | A | applied |
| 28 | Empty dashboard had no next step | `SocialAnalyticsPanel.tsx` | With nothing collected, cards said "Not connected" and nothing more. | Note linking Social → Configuration + "Collect now" + the 06:10 UTC schedule. | A | applied |
| 29 | Mixed button styles | `SocialAnalyticsPanel.tsx` | Summary "Close" used legacy `btn btn--tiny`. | `ui-button ui-button--ghost ui-button--sm`. | A | applied |

## Collectors (YouTube, X, TikTok, Patreon)

| # | Title | Location | Problem | Fix | Risk | Status |
|---|---|---|---|---|---|---|
| 30 | X spend total overwritten | `collectors/twitter.ts` `saveSpend` | Wrote back the total read at run start; an overlapping run or settings save lost spend → cap under-counted. | One SQL statement adds this run's delta; an older month resets (rollover). | B | applied |
| 31 | X timeout marked paid reads broken | `twitter.ts` | Any error (timeout, 5xx) set `paidReads=false`. | Only 401/402/403. | A | applied |
| 32 | No timeouts on X calls | `twitterPosts.ts` | A hung socket held the run lock. | 30 s paid / 15 s syndication; errors without the URL. | A | applied |
| 33 | YouTube CTR from one row | `youtube.ts` `reachPoints` | "Last row wins" across traffic-source rows. | Impression-weighted CTR. Test. | A | applied |
| 34 | YouTube Reporting lists not paged; files unordered | `youtube.ts` `reach` | `nextPageToken` ignored; an older regenerated report could replace a newer one. | `listAll` (≤ 10 pages), files sorted by `createTime`, later file wins. Test. | A | applied |
| 35 | YouTube per-video report without sort | `youtube.ts` `videoLifetime` | The video-dimension report requires `sort`. | `sort: '-views'`. | A | applied |
| 36 | One failed YouTube batch killed the collect | `youtube.ts` | A failed videos batch threw. | Counted per batch, one warning. | A | applied |
| 37 | Silent fallback / doomed analytics calls | `youtube.ts` | Token renewal failure fell back to the key silently; a sign-in without `yt-analytics.readonly` made three 403 calls each run. | Clear warnings; analytics calls skipped when the scope is known missing. | A | applied |
| 38 | YouTube/Google calls without timeout; key in error text | `youtube.ts`, `oauth/google.ts` | No timeouts; network errors could carry `key=`. | 30 s / 20 s timeouts, plain messages. | A | applied |
| 39 | Network blip forced a Google re-login | `social/youtubeAuth.ts` | Any renewal failure saved `oauthError` → "reconnect". | Only when Google returned an error code. | A | applied |
| 40 | Refresh-token race (TikTok, Patreon) | `tiktok.ts`, `patreon.ts` | Both rotate refresh tokens; a second process refreshing with a stale copy failed and stored a false "reconnect". | Re-read saved credentials before/after a failed refresh and adopt a newer valid token. Tests. | B | applied |
| 41 | TikTok retention curve scaled per point | `tiktokMapping.ts` `timeline` | 0.8 % in a percent curve became 80 %. | Scale detected per curve. Test. | A | applied |
| 42 | TikTok counters overwritten with 0 | `tiktokMapping.ts`, `tiktokMedia.ts` | Missing likes/comments/shares became 0. | null + COALESCE on update (new rows still 0). Test. | A | applied |
| 43 | TikTok cursor loop, timeouts, upsert failure, pasted auth URL | `tiktok.ts`, `oauth/tiktok.ts` | A non-advancing cursor re-read 25 pages; no timeouts; a failed upsert failed the collect; a pasted Business authorize URL on ANY https host received our CSRF state. | Break on a stuck cursor; `tiktokFetch` timeouts; upsert failure = warning; pasted URLs must be https on `*.tiktok.com`. Test. | A | applied |
| 44 | Patreon income incl. free trials; silent paging cap | `patreon.ts` | Free-trial entitled amounts counted; member list ended at 50 pages silently. | Trials excluded; truncation warns; 30 s timeouts. Test. | A | applied |

## Collectors (Facebook, Instagram, Threads, Meta Graph)

| # | Title | Location | Problem | Fix | Risk | Status |
|---|---|---|---|---|---|---|
| 45 | No fetch timeout | `metaGraph.ts` `graphGet`, `threads.ts`, `oauth/threads.ts` | A hung socket stalled the whole run. | 30 s `AbortSignal.timeout`; status 0 = plain failure. | A | applied |
| 46 | Tokens could reach error text | `metaGraph.ts` `redactSecrets`, `threads.ts`, `oauth/threads.ts` | Meta errors / network errors repeated the token or `access_token=` / `client_secret=` → warnings, logs, stored `oauthError`. | Redacted everywhere. Tests. | A | applied |
| 47 | Facebook splits a day off from totals | `facebookMapping.ts` `pageBreakdownPoints` | Splits stored on the requested date; totals use `end_time − 1 day`; only the last value read. | Each value dated by its own `end_time`; dates ≥ today dropped. Test. | B | applied |
| 48 | False 0 shares | `facebookMapping.ts` `mapFacebookPost` | A post whose summaries failed got `shares: 0` in a cumulative series. | 0 only when really read; else null. Test. | A | applied |
| 49 | One deleted post broke a 50-post batch; no throttle stop; old posts measured daily; repeated failing group calls | `facebook.ts`, `instagram.ts`, `metaGraph.ts` | Graph refuses the whole `?ids=` batch; loops kept going after rate limiting; the last listed page's > 90-day posts got daily insights; a refused metric group re-asked per post. | Batch → per-post retry (4 at once); `isRateLimitError` stops insight calls; `dueForMetrics` keeps the weekly rule; refused groups remembered per run. Tests. | A–B | applied |
| 50 | Benchmarks, expired stories, stale Page token, Page picker, Threads dead token + paging | `instagram.ts`, `facebook.ts`, `facebookPages.ts`, `threads.ts` | Missing benchmark setting crashed IG; benchmark names unchecked in Graph paths; expired stories fetched daily for 90 days; a revoked Page token stopped all FB collection; a new Page kept the old token; picker hid a rejected token as "no Pages"; a dead Threads token made ~600 failing calls; Threads paging unbounded. | Defaults + validation; stories left to the 3-hourly sweep; user-token fallback + warning; old token removed; clear picker errors (`tokenErrorHint`); stop on token error; 10-page cap. Tests. | A–B | applied |

## Skipped / not a bug

| # | Title | Reason |
|---|---|---|
| S1 | YouTube Analytics days are Pacific time | At 06:10 UTC the newest requested day may still be in progress in Pacific time; the 7-day window is rewritten every run, so the partial day corrects itself. Documented, not changed. |
| S2 | Facebook daily data lands one run later | `until` = today 00:00 UTC; reaching into an unfinished Pacific day would store partial data. Day attribution is correct. |
| S3 | One per-post permission error stops Meta media insights for the run | Existing design (avoids hundreds of failing calls); a collab post can cut a run short. Revisit if seen in practice. |
| S4 | Digest periods are local dates, data days are UTC | A local-day period maps onto UTC data days; with #12 the data is complete. Hour-level precision is not available from most platforms. |

## Planned (C)

| # | Title | Plan |
|---|---|---|
| P1 | Collect in a job, not a request | `collectNow` (#6) keeps the request bounded, but platforms still run sequentially in one process. Next step: a `social-analytics:collect` job row (claimed like `video_jobs`), run by the primary; `POST /collect` returns the job id; the admin polls `GET /runs`. Removes the in-request work entirely and survives a restart. |
| P2 | Per-platform CSV import for history gaps | From the original plan §6 phase 5 — unchanged. |

## Lead follow-up

1. **`CLAUDE.md` → Social analytics bullet**: add — "one `running` run per platform (unique index, migration 204; stale runs closed after 30 min; run history pruned after 180 days); `POST /collect` waits ≤ 50 s (`collectNow`) and returns still-working platforms as `running`; scheduled digests wait for the day's collection (`collectionSettled`) and stuck `generating` digests fail after 30 min; `series` returns `available` metrics; `SOCIAL_METRICS[*].aggregate` + `socialMetricAggregate` (`sum`/`last`/`avg`); manual digest send ignores the auto-email switch and returns `failed`/`reason`; TikTok traffic sources / viewer types on the Audience panel (newest snapshot)." And under Social hub: "masked credential values echoed back are ignored (`withoutMaskedValues`); OAuth state is bound to its provider."
2. **`npm run docs:api`**: the `/social-analytics/collect` summary text changed (≤ 50 s, `running`), and `/digests/:id/send` now answers `failed` + `reason`. No new routes.
3. **cms-client**: no change required (`SocialAnalyticsDigestSendResponse` / `SocialSeries` are shared types; new fields are optional).
4. **Barrels**: none — `socialMetricAggregate` is exported through the existing `export * from './socialAnalytics'` in `packages/shared/src/types/index.ts`.

## Verification

- `cd packages/shared && npm run build` — OK.
- `cd packages/api && npx tsc --noEmit -p .` — clean.
- `cd packages/api && npx vitest run src/services/social src/services/oauth src/services/connections.test.ts` — 23 files, 190 tests passed (new: `read.test.ts`; additions in `digests.test.ts`, `connections.test.ts`, and the collector tests).
- `cd packages/cms && npx tsc --noEmit -p .` — no errors in this area (remaining errors only in `CampaignDonations.tsx`, outside scope).
- `cd packages/cms && npx vitest run --config ../../config/cms/vitest.config.ts src/pages/admin/social` — 2 files, 20 tests passed.
- `cd packages/cms-client && npx tsc --noEmit -p .` — clean.
- Migration 204 run inside a rolled-back transaction on the local `rw` DB, plus two claims for one platform: the second `INSERT … ON CONFLICT DO NOTHING` inserted 0 rows — OK.
- Not verified: live platform APIs; the dashboard in a browser.
