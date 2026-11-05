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

### Instagram (`collectors/instagram.ts`, helpers `metaGraph.ts`)
- Business/Creator account; our Facebook-Login token (`graph.facebook.com`, scopes `instagram_basic`,
  `instagram_manage_insights`, `pages_read_engagement`, `pages_show_list`) or an Instagram-Login
  token (`graph.instagram.com`, `instagram_business_basic` + `instagram_business_manage_insights`).
- Account: followers, following, media count. Daily (last 3 days rewritten): views, reach, likes,
  comments, shares, saves, engagements, accounts engaged, profile link taps, followers gained/lost.
- Posts: views, reach, likes, comments, shares, saves; Reels add watch time + avg watch time
  (ms → s). A metric Meta refuses is skipped for the run with one warning.
- **Stories** expire in 24 h, so the `social-analytics-ig-stories` cron (every 3 h) stores each live
  story's views/reach/replies/shares as daily points (`story:<id>`) and re-totals the day.
- Unverified on a live account: watch-time units, the `follows_and_unfollows` breakdown labels,
  and Meta's Pacific-time days vs our UTC days.

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
  overview + top 10 posts is sent through the AI module (`docs/how-it-works/AI.md` — claude-broker by
  default, so no API billing); Markdown answer. A long answer comes back `timedOut` and the admin
  polls `cms.ai.job`.
- **Export CSV** on the Posts table: every page of the current filter, formula-safe.

## Not built yet (plan §6 phase 5)

Weekly email report, per-platform CSV import (history/gaps), TikTok sign-in flow + cover mirroring,
Patreon webhooks.
