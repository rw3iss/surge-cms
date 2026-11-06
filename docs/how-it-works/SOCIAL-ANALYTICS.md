# Social analytics

Admin → **Social → Analytics**. Pulls view and engagement numbers from every connected social
account into the CMS's own tables, every day, and shows them as one dashboard. Research and
design: `docs/plans/2026-11-04-social-analytics-research.md`.

## The rule: snapshot daily, read only our tables

No platform keeps long history for us (follower counts are "now" values, Instagram keeps 30 days,
TikTok 60, X none). So the **collectors** run once a day and write snapshots; the dashboard and API
read only those snapshots. **History starts the day a platform is first collected** — the chart
marks that day.

| Table (migration 201) | One row per | Holds |
|---|---|---|
| `social_account_snapshots` | platform × day | followers, following, posts count, total views/likes, raw JSON |
| `social_account_daily` | platform × day × metric × dimension | the platform's own daily series (YouTube views, watch time, subscribers gained…); dimension `''` = account total, `video:<id>` = per video. Recent days are rewritten on each run (platforms revise them). |
| `social_post_metrics` | post × day | a post's cumulative views/likes/comments/shares/saves/watch time/avg watch/% viewed/reach/impressions/clicks — daily for its first 90 days, then about weekly (a new row when the newest is 7+ days old) |
| `social_analytics_runs` | collector run | status `running` / `ok` / `partial` (warnings) / `failed`, counts, warnings, error. ONE `running` row per platform (unique index, migration 204); a run still `running` after 30 min is closed as failed; history older than 180 days is pruned after each daily collection (the newest run per platform is kept) |

## Code map

- `services/social/analytics/types.ts` — the ONE collector contract: `status(credentials, connected)`
  → `ready` / `partial` / `off` + what to do; `collect(ctx)` → `{ account, daily, posts }`; optional
  `crons`. A collector only fetches.
- `runner.ts` — the only writer (`storeResult`), run bookkeeping, the post cadence, and the daily
  cron **`social-analytics`** (06:10 UTC, primary only). One failing platform never stops the others;
  a single metric that fails becomes a run warning, not a failure. The claim is atomic (insert against
  the one-running-run index), so the cron, **Collect now** and other processes never collect the same
  platform at once. `collectNow()` (the HTTP "Collect now") answers after ≤ 50 s; collectors still
  working keep going in the background and come back as `running` runs (the admin says so and refreshes
  a minute later).
- `read.ts` — overview / series / posts / post history, all derived in SQL. `series` also returns
  `available`: the account metrics the platform has data for in the range — the Trend chart's metric
  list (labels, units and how each combines over a period come from `SOCIAL_METRICS` /
  `socialMetricAggregate` in `@sitesurge/types`: `sum` per-day amounts, `last` levels such as follower
  totals or Patreon members, `avg` rates).
- `collectors/<platform>.ts` — one per platform, registered via `collectors/index.ts`.
- Routes `/api/v1/social-analytics` (`overview`, `series`, `posts`, `posts/:id`, `collectors`,
  `runs`, `POST collect`), SDK `cms.socialAnalytics.*`, admin
  `pages/admin/social/SocialAnalyticsPanel.tsx` (+ `components/admin/charts/LineChart`).
- Permissions: `social.analytics:view` (staff) — dashboard; `social.analytics:manage` (admin) —
  Collect now + run history.

## Derived numbers

| Number | How |
|---|---|
| Views (period) | the platform's daily views when it gives them (YouTube Analytics); else the change in the account's total views between the first and last snapshot in the period; else the views our posts gained |
| Follower change | last snapshot in the period − first snapshot in the period |
| Likes / comments / shares | the platform's daily series, else what our posts gained in the period |
| Avg views / post | current views of posts published in the period ÷ their number |
| Engagement rate | (likes + comments + shares + saves) ÷ views, posts published in the period |
| Post "In period" | the post's views at the last snapshot − at the last snapshot before the period (0 if published inside it) |
| Post "Day 7" | the post's views on the snapshot nearest to 7 days after publishing (6–8 days) |
| Impressions (YouTube) | sum of the daily Reporting API thumbnail impressions for that video in the period |
| Threads comments / shares | Threads names its daily series `replies` / `reposts` + `quotes`; the overview reads them as comments / shares |
| TikTok traffic sources / viewer types | Audience & content → "How viewers found the videos": the NEWEST view-weighted snapshot (never summed); viewer types split into new vs returning, and followers vs non-followers stand in for the daily follower split TikTok does not give |

"Views" is not one unit across platforms, and platforms change its meaning. The dates are in
`SOCIAL_DEFINITION_CHANGES` (`@sitesurge/types`) and shown as chart notes.

## Per platform

### YouTube
- **API key or Google sign-in (any scope):** daily subscribers, total views, video count, and each
  video's views, likes, comments (Data API v3).
- **Google sign-in as the channel OWNER with `yt-analytics.readonly`:** plus the daily channel series
  (views, engaged views, watch time, avg view duration, likes, comments, shares, subscribers
  gained/lost — last 7 days rewritten each run), each video's lifetime watch time, avg view duration
  and % viewed, and thumbnail impressions + CTR from the Reporting API "reach" report (a job is
  created on the first run; files appear ~2 days later; YouTube keeps them 60 days).
- The scope is requested by "Sign in with Google" (Social → Configuration → YouTube). A connection
  signed in before this change must **sign in again** to grant it; the card says so. The granted
  scopes are stored as `credentials.grantedScopes`.
- Google Cloud OAuth consent screen must be **In production** (Testing = tokens die after 7 days).

### Instagram (`collectors/instagram.ts` + `instagramMapping.ts` (pure) + `instagramMedia.ts`)
Everything the Graph API gives a Business/Creator account. Each family runs on its own, so an account
refused one (e.g. account insights before it is a Business account) still collects the rest; what worked
is saved as `credentials.analyticsCapabilities` (status message + the Audience panel's notes).

| Family | What | Stored as |
|---|---|---|
| Account node | followers, following, media count | snapshot |
| Media discovery | the media list (90 days / ≥ 25 items, ≤ 300) upserted into `social_posts` (kind reel / carousel / image / video; thumbnails mirrored once) | posts |
| Media insights | views, reach, likes, comments, shares, saves, interactions, profile visits/activity, follows; Reels + watch time, avg watch (ms → s), skip rate (→ completion) | post metrics (+ raw) |
| Account daily (3 days rewritten) | views, reach, likes, comments, shares, saves, replies, interactions, accounts engaged, profile link taps; follows/unfollows | daily, dimension '' |
| Splits | views / reach / interactions by content type; views / reach by followers vs non-followers | daily, `type:<KIND>` / `follow:<KIND>` |
| New followers | `follower_count` per day | daily `newFollowers` |
| Audience | follower / engaged / reached demographics by age, gender, country, city (100+ followers) | `audienceFollowers|Engaged|Reached`, `age:` `gender:` `country:` `city:` |
| Online followers | followers online per hour | `onlineFollowers`, `hour:<0-23>` |
| Stories (every 3 h + daily) | each live story as a HIDDEN post (kind story) with views, reach, replies, shares, follows, profile visits, navigation (taps forward/back, exits) + daily story totals | post metrics + `story:<id>` |
| Benchmarks | public Business/Creator accounts from Analytics → Settings → Benchmarks via `business_discovery` (Facebook Login only): followers, media count, avg likes/comments of the last 12 posts, posts per week | `peer*` metrics, `peer:<username>` |

Read side: `GET /social-analytics/audience?platform=` (`audience.ts`) → demographics (latest snapshot),
online hours (avg), content/follower splits (summed), content kinds + top hashtags (from captions + post
metrics), stories, benchmarks, capabilities → the dashboard's **Audience & content** panel and the
digests' **Audience** section (browser + email).

Tested 2026-11-05 on the live connection (Facebook Login, not yet Business): account node, media list,
per-post insights, `follower_count` and `business_discovery` WORK; account-level insights, demographics
and online followers are refused (#10 / #200) until the account is a Business account. Unverified on a
live account: watch-time units, `reels_skip_rate` scale, the `follows_and_unfollows` labels, and
Meta's Pacific-time days vs our UTC days.

### Facebook Page (`collectors/facebook.ts` + `facebookMapping.ts` pure + `facebookMedia.ts` I/O)
Two tiers; each family of calls runs on its own, so a refused family leaves the others collecting.
What worked is saved as `credentials.analyticsCapabilities`; `status()` reports ready / partial and
lists what is collected (shown on the dashboard platform card).

| Tier | Needs | Collects |
|------|-------|----------|
| Basic | Page token with `pages_read_engagement` + `pages_show_list` | Page followers + likes (snapshot); every post and reel (90 days, at least 25) upserted into `social_posts`, thumbnails mirrored; per post reactions / comments / shares |
| Insights | + `read_insights` and the ANALYZE task on the Page | Daily follows / unfollows, media views + viewers, engagements, page views, video views (paid/organic, autoplay/click), 30-s + repeat views, view time, reactions by type; views split by followers (`follow:`) and ads (`paid:`); followers by country / city; per-post views, viewers, clicks by type, reactions by type; per video / reel plays, watch time, average, retention |
| Benchmarks | Settings → Analytics → Facebook Pages | Follower counts of other public Pages (`peer:` dims) |

- **Page picker:** the connection holds a user token; `GET /connections/facebook/pages` lists the Pages
  it manages (with the user's tasks — ANALYZE unlocks insights) and `PUT /connections/facebook/page`
  saves the chosen Page's id + Page token + granted scopes (`/me/permissions`) and clears stale
  capabilities (`services/social/facebookPages.ts`, SDK `cms.connections.facebookPages/selectFacebookPage`).
  With no Page chosen, the first Page of `/me/accounts` is used.
- Meta keeps removing Page metrics — a removed one becomes a run warning, not a failure (names in
  `facebookMapping.ts`).

### TikTok (`collectors/tiktok.ts`, `tiktokMapping.ts`, `tiktokMedia.ts`)

Two sign-ins on the one TikTok card (Social → Configuration), each its own app and token:

| Tier | Needs | Collects |
|------|-------|----------|
| Basic | **Authorize with TikTok** — Login Kit app (developers.tiktok.com), scopes `user.info.basic`, `user.info.profile`, `user.info.stats`, `video.list` | Followers, following, total likes, video count; every video (newest 500) with views, likes, comments, shares, upserted into `social_posts` |
| Business | **Authorize Business API** — TikTok API for Business app (business-api.tiktok.com) with the **TikTok Accounts** permission (`user.insights`, `video.insights`, `video.list`, `user.info.*`, `user.account.type`) | **Daily** (14-day window re-read; 24–48 h lag; 60-day max look-back): `views`, `profileViews`, `likes`, `comments`, `shares`, `followersTotal`; with **Advanced Access / Verified Business Account**: `reach` (unique viewers), `followersNet`, `newFollowers`, `lostFollowers`, `accountsEngaged`; Verified Business only: `profileLinkTaps`, `emailClicks`, `phoneClicks`, `addressClicks`, `appDownloadClicks`, `leadSubmissions`. **Audience** (100+ followers): `audienceFollowers` age / gender / country / city (percent), `onlineFollowers` `hour:` (UTC). **Per video:** reach, saves (favorites), total + average watch time, full-watch rate, and in `raw` new followers, profile views, profile clicks, retention + like curves, traffic sources, new / returning / follower viewers, viewer countries / genders / cities. **View-weighted snapshot** of those per-video splits on the collection day: `audienceReached` (country / gender / city), `trafficSources` (`source:For You`…), `viewerTypes` (`viewer:NEW_VIEWER`…) — lifetime splits, never sum them across days |

- Every family is its own call (`attempt`): a refused one is recorded in
  `credentials.analyticsCapabilities` (`profile`, `videoList`, `businessAccount`, `accountInsights`,
  `newFollowers`, `demographics`, `onlineFollowers`, `mediaInsights`, `profileActions`,
  `advancedAccess`) and `status()` says what is missing and how to upgrade. A dead Business token
  never stops the basic tier (and the other way round); the error lands in `businessOauthError` /
  `oauthError` and on the card.
- **Tokens:** Login Kit — access 24 h (older docs: 2 h), refresh 365 days, **rotated** on each refresh;
  Business — access 1 day, refresh 1 year (`POST …/tt_user/oauth2/refresh_token/`). Both are renewed
  by the collector when due and saved back (`refreshToken`, `tokenExpiresAt`, `refreshTokenExpiresAt`,
  `scope`, `openId` / `businessAccessToken`, `businessRefreshToken`, `businessTokenExpiresAt`,
  `businessRefreshTokenExpiresAt`, `businessScope`, `businessId` = the Business token's `open_id`).
  Secrets and tokens are masked in `GET /connections`.
- **OAuth:** `services/oauth/tiktok.ts`. The Business sign-in is OAuth key `tiktok_business` stored on
  the `tiktok` row (`oauthConnection()` in `services/oauth/index.ts`); app = `businessAppId` /
  `businessAppSecret`; authorize URL = the app's pasted "TikTok account holder authorization URL"
  (`businessAuthUrl`, state added) or, when empty, the v2 authorize URL with the Business app id as
  `client_key` (**unverified** — TikTok only documents "copy the URL from App Detail"). The callback
  accepts `code` or `auth_code`. `DELETE /connections/tiktok_business/oauth` removes only the Business sign-in.
- Covers (`tiktokcdn*.com`) are signed and expire within hours: mirrored once into our storage
  (`mirrorRemoteMedia`); a row with a mirrored cover is not downloaded again.
- Without a Business token the Display API gives no daily history: account numbers grow one
  snapshot per day from the first run.

**Operator setup**
1. *Basic:* developers.tiktok.com → Manage apps → Create app → add **Login Kit** (Web) and the
   **Display API**; scopes `user.info.basic`, `user.info.profile`, `user.info.stats`, `video.list`;
   redirect URI `https://<site>/api/v1/connections/tiktok/oauth/callback`; submit for review (until
   approved only the app's sandbox / target users can sign in). Paste Client key + secret on the card,
   Save, **Authorize with TikTok**.
2. *Business:* in the TikTok app switch to a Business Account (Settings and privacy → Account →
   Switch to Business Account). business-api.tiktok.com → My Apps → create a developer app, request the
   **TikTok Accounts** permission scope (since 2026-03-20 the Accounts API Access Application Form is
   required), set the TikTok account holder redirect URL to
   `https://<site>/api/v1/connections/tiktok_business/oauth/callback`; once approved, paste App ID +
   Secret (and optionally the account-holder authorization URL) on the card → **Authorize Business API**.

### X (`collectors/twitter.ts` + `twitterMapping.ts` pure + `twitterPosts.ts` I/O)
Two tiers. Status: **off** only with no X connection AND no X posts; free = **partial**; paid = **ready**.

| Tier | Needs | Collects |
|---|---|---|
| Free | X posts in `social_posts` (paste URLs on Social → Posts) | Per pasted post: likes (`favorite_count`), replies (`conversation_count`), video views when X fills `video.viewCount` (often 0 = unknown). Source: `cdn.syndication.twimg.com/tweet-result` (unofficial). No reposts/quotes/impressions, **no follower count** (the payload's user object has none). Fills a missing publish date + refreshes the row's counters. |
| Paid | Feed mode API + "Collect analytics (paid)" + the 4 OAuth 1.0a credentials + API credits | `/2/users/me` follower snapshot; own timeline `/2/users/:id/tweets` (29 days, retweets excluded, replies kept) with public + non_public + organic + media metrics → every own post upserted into `social_posts` (kind `post`/`reply`/`quote`/`video`/`photo`; replies hidden; others hidden unless "Sync posts automatically" is on) and measured in the same call: impressions, likes, replies, reposts + quotes, bookmarks, link + profile clicks, engagements, video quartiles → `completion_rate`. One-time 90-day backfill (public metrics). Due posts not on the timeline (others' pasted posts, own posts > 29 days) → `/2/tweets?ids=` public metrics. |

- **Cadence (both tiers):** posts < 30 days daily, older ones Mondays only. Free reads: one at a
  time, 400 ms apart, ≤ 300 per run; a 429 or 5 failures in a row stop the pass.
- **Spend** (`settings.analyticsSpend`, monthly cap `analytics.monthlyCapUsd`, default $10): estimated at
  docs.x.com rates — account read $0.010, post read $0.005, own-timeline post $0.001 when
  "This account owns the X developer app" (`analytics.ownedApp`) is on (X's owned-read rate needs the
  measured account to own the app). X bills a resource once per UTC day; we count every read. Reads are
  trimmed newest-first to fit; what the cap leaves goes to the free re-read.
  Example: 90 own posts in 30 days → ≈ $0.10/day owned (~$3/month), ≈ $0.46/day standard (~$14/month).
- State: `settings.analyticsTimeline` (`newestId`, `backfilledAt`), `credentials.analyticsCapabilities`
  (`freeHydration`, `paidReads`, `accountInsights`, `discovery`, `mediaInsights`).

### Patreon (`collectors/patreon.ts`)
- API v2 `campaigns` + `campaigns.members`: patron count (followers), active / paid / free /
  declined / former patrons, estimated monthly income (sum of active pledges), new patrons per day.
- Patreon's API has **no post analytics**. Webhooks (real-time gained/lost) are not wired yet.

### Threads (`collectors/threads.ts`, OAuth `services/oauth/threads.ts`, migration 203)
- Analytics-only provider: Social → Configuration → Threads (Threads App ID/secret, redirect
  `<site>/api/v1/connections/threads/oauth/callback`, scopes `threads_basic`,
  `threads_manage_insights`). Long-lived token renewed weekly (`threads-token-refresh`).
- Account: followers. Daily: views, likes, replies, reposts, quotes, clicks. Posts (last 90 days,
  stored in `social_posts` with `is_hidden = true` so they never reach a public feed): views,
  likes, replies, reposts + quotes.

## AI summary + export

- **AI summary** (`POST /social-analytics/summary`, needs `ai:use` too): a compact JSON digest of the
  overview + top 10 posts goes through the AI module (`docs/how-it-works/AI.md`). **Where it runs**
  (`pickSummaryTarget` in `services/social/analytics/summary.ts`): the claude-broker **`analytics` pool**
  when it has an attached session → else the broker's default pool → else the Anthropic API when set up →
  else a failed result (`meta.reason: 'no_session'`) whose message says to start the `analytics` pool in
  Plugins → Claude Broker (the panel links there and to Settings → AI). Markdown answer; a long one comes
  back `timedOut` and the admin polls `cms.ai.job`.
- **Export CSV** on the Posts table: every page of the current filter, formula-safe.

## Digests (scheduled reports)

Social → Analytics → **Settings** schedules a **digest**; Social → Analytics → **Digests** lists every
stored one and opens it in the browser.

| Setting (`social_analytics_settings`) | Meaning |
|---|---|
| Digest on/off, frequency | daily · weekly (weekday) · monthly (day 1–28), at a local hour in a time zone |
| Platforms | which platforms to include (none = all with data) |
| Sections | totals · per platform · trends · top posts (count) · AI insights |
| AI pool | the claude-broker pool the insights run on (default `analytics`; falls back to the default pool, then the Anthropic API) |
| Summary format | how the AI insights are written: **Full** (default — headline, 3–6 highlights, a summary per platform, why the top posts worked, 2–4 next steps) or **Brief** (the same findings as cliff notes: ≤ 12-word headline, 2–3 highlights, one line per platform, up to 3 top posts, 1–2 next steps). Same JSON keys either way (`cleanInsights(raw, format)` caps the counts); the format is stored on the digest (`ai.format`) and shown on its AI card. |
| Email | on/off · format full or summary · extra recipients · recipient mode |
| Retention | days to keep digests (1 … any), or keep forever |

- **Period:** the digest due on a local date covers up to *yesterday* — 1 day, 7 days, or one calendar
  month — compared with the same length right before it (`periodFor` / `previousPeriod`).
- **Schedule:** the hourly `social-analytics-digest` cron (:20, primary only) asks `dueSlot()`; it is due
  from the configured hour on the matching day, once per local date (`schedule_key` is unique, so
  overlapping runs make one digest). **It waits for the data** (`collectionSettled`): day D is written by
  the collection of D+1 (06:10 UTC), so a due digest is built only after a run that started on/after
  `to`+1 00:00 UTC has finished and none is running — or at `to`+1 09:00 UTC at the latest (still the
  digest's own local day in every time zone). The same cron applies the retention and fails digests
  stuck in `generating` for 30+ minutes (a process that stopped mid-build).
- **Snapshot:** `social_analytics_digests` (migration 202) stores the whole report as JSONB
  (`DigestData`: totals and per-platform metrics with previous values and changes, daily series, top
  posts, definition changes, AI insights) — so a digest reads the same months later, whatever the live
  data does. Engagement in a digest is always (likes + comments + shares) ÷ views.
- **AI insights:** a JSON answer (`headline`, `highlights`, per-platform notes, why each top post worked,
  `suggestions`) through the AI module; a missing session or a bad answer is stored as
  `ai.status: 'failed'` with the reason, and the rest of the digest still ships.
- **Delivery:** the digest EMAIL (`digestEmail.ts`: branded table layout — KPI tiles with change pills,
  platform tables with bar-strip trends, top posts with thumbnails, AI card, "Open in the dashboard")
  goes to the extra recipients, plus — in *augment* mode — the email recipients of the **Social analytics
  digest** notification type (Settings → Notifications); *override* = only the extra recipients. The
  notification type's in-app / desktop / SMS channels get a "digest ready" note linking to the browser
  view (its email channel is skipped — those people get the digest itself). **"Email each digest"** is
  the AUTOMATIC email; **Send email** on a digest goes to the same recipients whether it is on or off.
  `POST /digests/:id/send` answers `{ sent, failed, recipients, reason }` (`reason`: `not_ready` /
  `no_recipients`). Post links and thumbnails in the email are http(s) only; site paths (`/uploads/…`)
  are made absolute.
- **API:** `GET/PUT /social-analytics/settings`, `GET /digests`, `GET /digests/:id`, `POST /digests`
  (generate now; returns `generating` at once — poll), `POST /digests/:id/send`, `DELETE /digests/:id`,
  `GET /digests/:id/email?format=` (the email as an HTML page). SDK `cms.socialAnalytics.settings /
  updateSettings / digests / digest / generateDigest / sendDigest / deleteDigest / digestEmailUrl`.

## Not built yet (plan §6 phase 5)

Per-platform CSV import (history/gaps),
Patreon webhooks.
