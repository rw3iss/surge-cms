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
| `social_post_metrics` | post × day | a post's cumulative views/likes/comments/shares/saves/watch time/avg watch/% viewed/reach/impressions/clicks — daily for its first 90 days, then weekly (Mondays) |
| `social_analytics_runs` | collector run | status `ok` / `partial` (warnings) / `failed`, counts, warnings, error |

## Code map

- `services/social/analytics/types.ts` — the ONE collector contract: `status(credentials, connected)`
  → `ready` / `partial` / `off` + what to do; `collect(ctx)` → `{ account, daily, posts }`; optional
  `crons`. A collector only fetches.
- `runner.ts` — the only writer (`storeResult`), run bookkeeping, the post cadence, and the daily
  cron **`social-analytics`** (06:10 UTC, primary only). One failing platform never stops the others;
  a single metric that fails becomes a run warning, not a failure.
- `read.ts` — overview / series / posts / post history, all derived in SQL.
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

### Facebook Page (`collectors/facebook.ts`)
- Page token (`pages_read_engagement`, `read_insights`, `pages_show_list`; ANALYZE role) + Page ID;
  a user token is swapped for the Page token.
- Account: followers. Daily: follows, follows/unfollows, media views, reach, post engagements, page
  views, video views, video view time. Posts: reactions, comments, shares (no insights needed) +
  views, reach, clicks, video view time. Meta keeps removing Page metrics — a removed one becomes a
  run warning, not a failure.

### TikTok (`collectors/tiktok.ts`)
- Display API (`user.info.stats`, `video.list`): followers, following, total likes, video count;
  each video's views/likes/comments/shares (newest 500). Videos are upserted into `social_posts`
  (they have no feed fetcher). Access tokens last ~2 h; the collector refreshes with the refresh
  token (180 days, rotates) and saves both — the connection must hold `refreshToken` + client
  key/secret (a TikTok sign-in flow is still to build; a pasted token dies in ~2 h).
- Business API (watch time, completion rate, reach, profile views) only when `businessAccessToken`
  + `businessId` are set — endpoints unverified.
- Cover image URLs expire after ~6 h and are not mirrored yet.

### X (`collectors/twitter.ts`)
- **Paid and opt-in**: Social → Configuration → X → Feed mode API → "Collect analytics (paid)" +
  "Monthly cap (USD)" (default $10). Spend is estimated at standard read prices (an over-estimate)
  in `settings.analyticsSpend`; reads are cut to fit the cap, newest posts first.
- Account: followers, following, posts. Posts: impressions (= views), likes, replies, reposts +
  quotes, bookmarks; posts < 30 days old add link/profile clicks + video quartiles (raw).

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
| Email | on/off · format full or summary · extra recipients · recipient mode |
| Retention | days to keep digests (1 … any), or keep forever |

- **Period:** the digest due on a local date covers up to *yesterday* — 1 day, 7 days, or one calendar
  month — compared with the same length right before it (`periodFor` / `previousPeriod`).
- **Schedule:** the hourly `social-analytics-digest` cron (:20, primary only) asks `dueSlot()`; it is due
  from the configured hour on the matching day, once per local date (`schedule_key` is unique, so
  overlapping runs make one digest). The same cron applies the retention.
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
  view (its email channel is skipped — those people get the digest itself).
- **API:** `GET/PUT /social-analytics/settings`, `GET /digests`, `GET /digests/:id`, `POST /digests`
  (generate now; returns `generating` at once — poll), `POST /digests/:id/send`, `DELETE /digests/:id`,
  `GET /digests/:id/email?format=` (the email as an HTML page). SDK `cms.socialAnalytics.settings /
  updateSettings / digests / digest / generateDigest / sendDigest / deleteDigest / digestEmailUrl`.

## Not built yet (plan §6 phase 5)

Per-platform CSV import (history/gaps), TikTok sign-in flow + cover mirroring,
Patreon webhooks.
