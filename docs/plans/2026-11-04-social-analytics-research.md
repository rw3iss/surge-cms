# Social analytics — research: what each platform lets us pull

Date: 2026-11-04 · Status: **IN PROGRESS — build started 2026-11-05** (see §6 status lines and `docs/how-it-works/SOCIAL-ANALYTICS.md`).

Goal: pull view + engagement analytics from every connected social account into the CMS, store
them, show a cross-platform dashboard, and later let AI summarise and analyse them — our own
build, informed by what Hootsuite / Sprout Social & co. do.

Sources are official developer docs unless noted; items the research could not confirm are
marked **(unverified)** — check them against a live account before building on them.

---

## 1. Summary

| Platform | Can we get our own analytics? | What it takes | Cost | Biggest gaps |
|---|---|---|---|---|
| **YouTube** | **Yes — the richest of all** (views, watch time, avg view duration/%, subs gained/lost, likes, comments, shares, traffic sources, demographics, impressions + CTR) | Add OAuth scope `yt-analytics.readonly` to our existing Google sign-in (owner re-consents); Google Cloud app "In production" | Free | ~2-day data lag; no real-time; impressions/CTR only via the Reporting API (bulk CSV) |
| **Instagram** | **Yes** (followers, reach, views, likes, comments, shares, saves, Reels avg/total watch time, profile visits, follows, demographics) | Business or Creator account; "Instagram API with Instagram Login" + `instagram_business_manage_insights`; long-lived token refreshed every ~50 days | Free | Personal accounts: nothing. Follower history ≤ 30 days. Stories expire in 24 h. Demographics need ≥ 100 followers. No watch time on non-Reels. |
| **Facebook Page** | **Yes, shrinking** (follows, unfollows, views, unique viewers, engagements, video views + view time, page views) | Page token + `read_insights`, `pages_read_engagement` | Free | Meta removed impressions, fan adds/removes etc. (Nov 2025, Jun 2026) — metric names churn yearly |
| **Threads** (not yet a provider) | **Yes** (views, likes, replies, reposts, quotes, clicks, followers, demographics) | `threads_basic` + `threads_manage_insights` | Free | No watch time; data from mid-2024 on |
| **TikTok** | **Basic: yes. Deep: Business accounts only.** Display API → followers, total likes, per-video views/likes/comments/shares. Business API → plus profile views, follower history (60 d), watch time, avg watch time, completion rate, reach, demographics | Display API: app review of Login Kit scopes. Business API: TikTok for Business developer app approval + the creator switches to a (free) Business Account | Free | Saves (unverified); profile-level history only 60 days; app review gate |
| **X (Twitter)** | **Yes, paid** (impressions, likes, reposts, replies, quotes, bookmarks, video views + playback quartiles, link/profile clicks, followers) | Pay-per-use API credits (since Feb 2026); our existing OAuth 1.0a user-context signer | **~$5/month** for our own account at "owned read" rates (≤ ~$25 at standard rates) | Non-public metrics only for posts < 30 days old; no follower history, profile views or demographics |
| **Patreon** | **Partly** (patrons, pledges/income per member, gained/lost via webhooks) | OAuth v2 scopes `campaigns`, `campaigns.members`, `campaigns.posts`, `w:campaigns.webhook` | Free | **No post views/likes/comments, no earnings history endpoint** |

**Three facts shape the whole design:**
1. **No platform keeps long history for us.** Follower counts are "now" values almost
   everywhere (IG ≤ 30 days of deltas, TikTok 60 days, X none, Patreon none). Every competitor's
   #1 documented limitation is "data starts the day you connected". → **Snapshot every account
   and every post DAILY from day one, into our own tables.** Start this before building any UI.
2. **Some data is only catchable while it's fresh**: Instagram Stories (24 h), X non-public
   metrics (posts < 30 days), YouTube Reporting API files (downloadable 60 days), TikTok
   profile metrics (60 days). The collectors must run on schedule, not on demand.
3. **"Views" is not one unit.** Meta replaced impressions/plays with `views` (2025), YouTube
   changed how a view counts twice (Shorts 2025, all formats Aug 2026), X counts impressions,
   TikTok counts plays. Store raw platform metrics; derive one normalised "Views" figure with a
   per-platform mapping and mark the dates where a platform changed its definition.

---

## 2. Your example stats — who gives what

✅ via API · 🟡 partial / derived by us · ❌ not via API · $ paid API

| Stat | YouTube | Instagram | Facebook Page | TikTok (Display / Business) | X | Patreon |
|---|---|---|---|---|---|---|
| Follower count (now) | ✅ (rounded to 3 sig. figs) | ✅ | ✅ `page_follows` | ✅ / ✅ | $✅ | ✅ `patron_count` |
| Followers gained / lost | ✅ per day `subscribersGained/Lost` | ✅ `follows_and_unfollows` (≥100 followers) | 🟡 unfollows ✅, gains `page_daily_follows` (unverified) | 🟡 snapshot diff / ✅ (60 d) | 🟡 snapshot diff | ✅ via `members:*` webhooks or daily diff |
| Views per post / video | ✅ | ✅ `views` | ✅ `post_media_view` | ✅ / ✅ | $✅ `impression_count`, video `view_count` | ❌ |
| Total views on platform | ✅ | 🟡 sum of posts + account `views` per day | ✅ `page_media_view` | 🟡 sum / ✅ | $🟡 sum | ❌ |
| Avg views per video | 🟡 derived | 🟡 derived | 🟡 derived | 🟡 derived | $🟡 derived | ❌ |
| Likes per post | ✅ | ✅ | ✅ reactions | ✅ / ✅ | $✅ | ❌ (v2 API has no post likes) |
| Total likes on platform | 🟡 sum | 🟡 sum (account `likes` per day ✅) | 🟡 sum | ✅ `likes_count` / ✅ | $🟡 sum | ❌ |
| Comments (counts) | ✅ | ✅ | ✅ | ✅ / ✅ | $✅ replies | ❌ |
| Shares / reposts | ✅ | ✅ | ✅ | ✅ / ✅ | $✅ reposts + quotes | ❌ |
| Saves / bookmarks | ❌ (playlist adds ✅) | ✅ `saved` | ❌ | ❌ / unverified | $✅ bookmarks | ❌ |
| Watch time (total) | ✅ `estimatedMinutesWatched` | ✅ Reels only `ig_reels_video_view_total_time` | ✅ `page_video_view_time` | ❌ / ✅ `total_time_watched` | ❌ (quartiles only) | ❌ |
| Avg watch time / avg view % | ✅ `averageViewDuration`, `averageViewPercentage` | ✅ Reels only `ig_reels_avg_watch_time` | 🟡 post-level metric unverified | ❌ / ✅ `average_time_watched`, `full_video_watched_rate` | 🟡 playback quartiles (25/50/75/100%) | ❌ |
| Reach (unique viewers) | 🟡 `uniques` | ✅ `reach` | ✅ `*_total_media_view_unique` | ❌ / ✅ | ❌ | ❌ |
| Impressions + click-through | ✅ thumbnail impressions + CTR (Reporting API, since Jan 2026) | 🟡 `views` replaced impressions | 🟡 `media_view` | ❌ / ✅ impression sources | $✅ + link/profile clicks (< 30 d) | ❌ |
| Profile visits | ❌ | ✅ per post `profile_visits` (account-level unverified) | ✅ `page_views_total` | ❌ / ✅ | ❌ | ❌ |
| Demographics (age/gender/country) | ✅ | ✅ (≥ 100 followers) | 🟡 country/city (metric names in flux) | ❌ / ✅ countries, genders (age unverified) | ❌ | ❌ |
| Traffic sources / where views came from | ✅ | 🟡 breakdown by follower / non-follower | 🟡 from ads / from followers | ❌ / ✅ impression sources | ❌ | ❌ |
| Best time to post (audience online) | ❌ | ✅ `online_followers` (≥ 100 followers) | ❌ | ❌ / ✅ `audience_activity` | ❌ | ❌ |
| Income | ✅ with monetary scope + Partner Program | ❌ | ❌ | ❌ | ❌ | 🟡 per-member amounts; no history endpoint |

Anything "🟡 derived" we compute from our own daily snapshots — so it only exists from the day
collection starts.

---

## 3. Per platform

### 3.1 YouTube — the best API

**What we have today:** Data API v3 (API key, public data) + "Sign in with Google" with
`youtube.readonly` and a refresh token (`services/oauth/google.ts`, `social/youtubeAuth.ts`).

**Three APIs, use all three:**

| API | Gives | Shape | Latency / history | Quota |
|---|---|---|---|---|
| **Data API v3** (`channels.list`, `videos.list` `part=statistics`) | subscriberCount (rounded), channel viewCount, videoCount; per video views, likes, comments (dislikes owner-only) | current values only | near real-time; no history | 10,000 units/day, 1 unit per call (50 videos per call) |
| **Analytics API v2** (`reports.query`, `ids=channel==MINE`) | `views`, `engagedViews`, `estimatedMinutesWatched`, `averageViewDuration`, `averageViewPercentage`, `likes`, `dislikes`, `comments`, `shares`, `subscribersGained/Lost`, playlist adds, card clicks, retention curves, live concurrents; dimensions day / video / country / traffic source / device / age / gender / content type (VIDEO / SHORTS / LIVE) | per day, per video | ~48–72 h lag; history back to channel start | per-query cost (numbers unverified) — a daily pull is small |
| **Reporting API v1** (bulk jobs) | daily CSV files for every report type, incl. the **reach reports** (Jan 2026): `video_thumbnail_impressions`, `video_thumbnail_impressions_ctr` | one file per day | ~2 days; backfills 30 days before the job; files kept **60 days** — download them | negligible |

**Requirements**
- Add scope **`yt-analytics.readonly`** (keep `youtube.readonly`; Google now lists it as required
  for `reports.query` too). The channel owner re-consents once (incremental authorization).
  Revenue needs `yt-analytics-monetary.readonly` **and** a YouTube Partner Program channel — skip
  unless wanted.
- The signer must be the channel **owner** (for a Brand Account, pick the brand channel at
  consent). Managers without owner rights get nothing.
- Google Cloud OAuth consent screen must be **"In production"** — in "Testing" refresh tokens die
  after **7 days**. For our single-owner use the app can stay unverified (an "unverified app"
  warning at consent, ≤ 100 users); sensitive-scope verification is only needed for wider use.

**Not available / caveats**
- No real-time analytics (use Data API snapshots for "live" counters).
- Subscriber count is rounded (3 significant figures) and hidden if the owner hides it.
- View definitions changed: Shorts views count every start/replay since 2025-03-31, and from
  2026-08-24 views count from the first frame for all formats — `engagedViews` keeps the old
  meaning. Show both, and annotate the change dates on charts.
- Community posts: no analytics found. Traffic-detail rows capped at top 25.
- Workarounds: YouTube Studio CSV export (manual upload) for anything missing; scraping Studio is
  against the ToS — don't.

### 3.2 Instagram (Business / Creator accounts)

**What we have today:** `graph.facebook.com/v21.0/{ig-user-id}/media` with `like_count`,
`comments_count` and a long-lived token. **Move to a current Graph version** — `views` doesn't
exist in older ones.

**Endpoints**
- Account: `GET /{ig-user-id}/insights` — `reach`, `views` (replaced `impressions`, removed
  2025-04-21), `likes`, `comments`, `shares`, `saves`, `reposts`, `total_interactions`,
  `accounts_engaged`, `follows_and_unfollows`, `follower_count` (daily delta),
  `profile_links_taps`, `follower_demographics`, `engaged_audience_demographics`,
  `online_followers`. Plus `followers_count` on the user node (snapshot).
- Per media `GET /{ig-media-id}/insights`:
  - Feed: `views`, `reach`, `likes`, `comments`, `shares`, `saved`, `total_interactions`,
    `follows`, `profile_visits`, `profile_activity`, `reposts`.
  - **Reels**: the above + **`ig_reels_avg_watch_time`**, **`ig_reels_video_view_total_time`**,
    `reels_skip_rate`, `crossposted_views`, `facebook_views`.
  - Stories: `views`, `reach`, `replies`, `shares`, `follows`, `profile_visits`, `link_clicks`,
    `navigation` — **only for 24 hours**.

**Requirements**
- The account must be **Business or Creator** (a free switch in the app). Personal accounts get
  nothing.
- Use **"Instagram API with Instagram Login"** (no Facebook Page needed; `graph.instagram.com`):
  permissions `instagram_business_basic` + `instagram_business_manage_insights`. (The Facebook
  Login path needs the account linked to a Page + `instagram_manage_insights`,
  `pages_read_engagement`.)
- **Standard Access is enough** for accounts we own and add to our own Meta app (app role /
  Instagram Tester) — no App Review or Business Verification needed for that. Advanced Access
  and review only matter if other people's accounts connect.
- Long-lived token = 60 days; refresh with `refresh_access_token` once it is ≥ 24 h old and
  before it lapses (a lapsed token can't be refreshed) → schedule at ~day 50.
- Rate limits: Business Use Case limits, far above a daily batch. Free.

**Not available / caveats**
- Follower history: at most ~30 days of daily deltas (unverified exact window) → snapshot daily.
- Under 100 followers: no demographics, follower deltas or online-followers.
- Stories: capture within 24 h — subscribe to the `story_insights` webhook or poll every few hours
  while a story is live. Story metrics under 5 return an error.
- Watch time exists for **Reels only**. Carousel children have no insights.
- Data can lag up to 48 h. Metric names change (impressions → views); handle "invalid metric"
  per metric, never fail the whole pull.
- Backfill: Meta Business Suite CSV export (manual) for history before we started.

### 3.3 Facebook Pages

**What we have today:** `/{page-id}/posts` with reaction/comment/share summaries (needs no
insights permission — keep it).

**Endpoints** (`GET /{page-id}/insights`, Page token):

| Stat | Metric |
|---|---|
| Followers | `page_follows` |
| Unfollows / follows | `page_daily_unfollows_unique` / `page_daily_follows` (unverified) |
| Views (was impressions) | `page_media_view` (breakdowns from ads / from followers) |
| Unique viewers (was reach) | `page_total_media_view_unique` |
| Engagement | `page_post_engagements` |
| Video views / watch time | `page_video_views`, `page_video_view_time` (ms) |
| Page visits | `page_views_total` |
| Per post | `post_media_view`, `post_total_media_view_unique` (+ the existing reactions/comments/shares) |

**Requirements:** `pages_read_engagement`, `read_insights`, `pages_show_list`; the token's user
needs the ANALYZE task on the Page. Standard Access for our own Page. Free. Max 90 days per query.

**Not available / caveats:** Meta **removed** `page_fans`, `page_fan_adds/removes`,
`page_impressions*`, `post_impressions*` (2025-11-15) and the `*_unique` impression variants
(2026-06-15) — expect another purge every 6–12 months. Gross follower gains may be gone (only
unfollows confirmed). Post-level watch-time metric names unverified — test on a live post.
Demographic metric names are in flux (`page_follows_country/city`).

### 3.4 Threads (not a provider yet — cheap to add)

`/{threads-media-id}/insights`: `views`, `likes`, `replies`, `reposts`, `quotes`, `shares`;
`/{threads-user-id}/threads_insights`: `views` (time series), `likes`, `replies`, `reposts`,
`quotes`, `clicks`, `followers_count`, `follower_demographics` (≥ 100 followers). Scopes
`threads_basic` + `threads_manage_insights`. Data from mid-2024 on. Same Meta app as Instagram.

### 3.5 TikTok

**What we have today:** listed as a provider, **no fetcher**.

**Two products**

| | Display API (Login Kit) | Business API ("Accounts" insights) |
|---|---|---|
| Account | any TikTok account that authorizes us | **TikTok Business Account** (free switch in the app) |
| Profile | `follower_count`, `following_count`, `likes_count`, `video_count` (scope `user.info.stats`) | + `profile_views`, follower count **over time** (≈ 60 days), audience countries / genders / activity by hour |
| Per video | `view_count`, `like_count`, `comment_count`, `share_count`, duration, cover, link (`video.list`, 20 per page) | + `total_time_watched`, **`average_time_watched`**, **`full_video_watched_rate`**, reach, impression sources, per-video audience countries |
| Approval | app review of the scopes (sandbox with named test users until then) | TikTok for Business developer app approved for Account Insights scopes (process / timing unverified) |
| Latency | current | 24–48 h |
| Cost | free | free (no per-call fees documented) |

**Not available / caveats:** saves (unverified on Business); Display API has no watch time,
reach, profile views or demographics; profile-level history only ~60 days → snapshot. The
**Research API** (academics only) and **Creator Marketplace API** (brand campaigns) are not for
us. Cover image URLs expire after 6 h → mirror them (we already mirror IG/FB media).

**Workarounds:** TikTok Studio / in-app analytics CSV export (manual upload). Aggregators
(Phyllo, Ayrshare) wrap the same APIs at a cost — no extra data. Scraping public counts is against
the ToS and brittle.

### 3.6 X (Twitter)

**What we have today:** manual paste-by-URL with free syndication hydration (public like/reply
counts only); a working OAuth 1.0a user-context signer; paid read-sync opt-in.

**Pricing (since 2026-02-06):** pay-per-use credits, no subscription, spend cap per cycle.
Post read $0.005; **"owned reads" $0.001** (reading your own account's data with an app owned by
that same account); user read $0.010; same-day re-reads billed once; cap 3M post reads/month.
**Our cost: ~$5/month** reading our own ~150 recent posts daily at owned-read rates (~$25 at
standard rates). The old Free/Basic/Pro tiers are gone or migrating.

| Stat | Field |
|---|---|
| Likes, reposts, replies, quotes, bookmarks, impressions | `public_metrics` (`like_count`, `retweet_count`, `reply_count`, `quote_count`, `bookmark_count`, `impression_count`) |
| Video views | media `public_metrics.view_count` |
| Link clicks, profile clicks, engagements, video playback quartiles (0/25/50/75/100 %), organic vs promoted | `non_public_metrics` / `organic_metrics` — user-context auth, **posts < 30 days old only** |
| Followers / following / posts / listed | `GET /2/users/:id` `public_metrics` — current only |

**Not available:** follower history (snapshot), profile views, demographics, average watch time
(only quartiles). Workaround: analytics.x.com CSV export (manual; Premium gets more). Scraping is
against the ToS and actively blocked.

### 3.7 Patreon

**API v2** (OAuth, creator token): campaign `patron_count`; members with `patron_status`,
`currently_entitled_amount_cents`, `campaign_lifetime_support_cents`, pledge history; posts
(`title`, `is_paid`, `published_at`, tiers) — **no views, likes or comments on posts**.
Webhooks: `members:create|update|delete`, `members:pledge:*`, `posts:publish|update|delete`
(HMAC-MD5 signature). Rate limits 100 req / 2 s per client and 100 / min per token; send a
User-Agent. Free.

**Not available:** post engagement, an earnings-over-time endpoint, patron-count history, the
dashboard's "followers". → Snapshot `patron_count` + summed entitled amounts daily; count
gained/lost from `members:*` webhooks; monthly income = sum of entitled amounts (an
approximation — declines and refunds show only through `last_charge_status`). Creator dashboard
CSV exports for history (columns unverified). The unofficial v1 internal API exposes post
like/comment counts but is undocumented and against the spirit of the ToS — not recommended.

---

## 4. Data we can't get — why, and the options

| Gap | Why | Recommended | "Hackish" option (not recommended) |
|---|---|---|---|
| History before we connect (all) | Platforms only expose recent windows or current counts | **Start daily snapshots now**; one-time manual CSV import per platform (YouTube Studio, Meta Business Suite, TikTok Studio, X analytics, Patreon) into the same tables | — |
| Instagram Stories after 24 h | Insights vanish with the story | `story_insights` webhook + poll every 2–4 h while live | — |
| X non-public metrics after 30 days | API restriction | daily pull keeps the last value before day 30 | — |
| TikTok watch time on a personal account | Display API doesn't have it | switch the account to Business (free) and use the Business API | scraping — ToS violation |
| Patreon post views / likes | not in API v2 | treat Patreon as revenue + members, not reach | internal v1 API / Apify scrapers — ToS risk, breaks without notice |
| X / IG profile views, X demographics | not exposed | manual CSV upload | browser automation of the analytics UI — ToS risk, account-ban risk |
| Meta metric churn | Meta deprecates metrics yearly | per-metric adapter; store raw JSON; tolerate "invalid metric" | — |

A **manual CSV import** screen (per platform, mapped to our metric names) is the honest,
low-risk answer for every hole — the competitors' "since connected" problem with an escape hatch.
Scraping/browser-automating the official dashboards is technically possible (a headless browser
logged in as the owner, reading Studio pages) but violates every platform's terms, breaks on UI
changes, and risks the account itself — not worth it for an account we depend on.

---

## 5. Lessons from Hootsuite, Sprout Social, Buffer, Metricool, Agorapulse, Later

- **Everyone's #1 documented limitation is "data starts when you connected"** (Hootsuite, Sprout,
  Buffer, Metricool). Sprout backfills ~2 years of Instagram post metrics but *not* follower
  counts; X: 1 year of posts, no audience backfill; Stories: never. → Confirms §1 fact 1.
- **Shared structure:** a cross-network overview (audience, views, engagements, net growth) →
  per-profile report → per-post performance table → exports. Copy it.
- **Engagement rate has no standard.** Hootsuite offers three denominators (reach / followers /
  impressions-views); its own example shows 5.21 % vs 1.25 % for the same post. Sprout defaults
  to per-impression. → Let the user pick the basis; always show the formula in a tooltip.
- **Net follower growth** = gained − lost. Where a platform only gives a count (TikTok, Facebook,
  Threads), Sprout labels it "change in followers" — do the same.
- **Meta's views change:** Sprout folded IG `views` into its cross-network "impressions" slot and
  kept old impressions only for pre-2025 periods. We'll name the unit "Views" and annotate the
  switch date instead of pretending they're the same.
- **AI summaries** exist everywhere now (Sprout Trellis, Buffer AI Takeaways, Agorapulse,
  Hootsuite insight cards) — short narrative per report. Cheap for us to add on top of stored
  data.
- **Best time to post** should come from *our own* post history (Later's approach); vendors'
  generic "best times" contradict each other.
- **Exports**: CSV (summary + posts + timeseries, Buffer-style), PDF, scheduled email report.
- **Competitor tracking** (public stats of other accounts, from the day added) is a common
  paid feature — possible later via public endpoints (YouTube Data API on any channel; others
  limited).
- **Pitfalls they document:** mixing denominators silently; summing "impressions" across networks
  as one unit; treating Stories/TikTok as backfillable; hard-coding one Meta metric name; relying
  on X (Metricool even caps X retention at 30 days).
- Pricing context (unverified, per seat/month): Hootsuite $99–399, Sprout $79–399 + quote-only
  Premium Analytics; Buffer per channel; Metricool ~$20+/5 brands. Their paywalls sit on custom
  reports, competitor tracking and scheduled exports — the parts worth building well.

---

## 6. Recommended design for our build (to turn into a plan)

**Principle:** collectors write raw daily snapshots; everything you see is derived from our own
tables. Platform APIs are only a source, never the store.

1. **Storage (new tables)**
   - `social_account_snapshots` — (connection, date, followers, following, posts count, total
     likes/views when the platform gives them, raw JSON). One row per account per day.
   - `social_account_daily` — (connection, date, metric, value, dimension?) for platform daily
     series (YouTube views/watch time/subs gained, IG reach/views, FB page metrics, TikTok
     Business profile metrics). Re-written for the last N days each run (YouTube revises ~3 days).
   - `social_post_metrics` — (social_post_id, date, views, likes, comments, shares, saves,
     watch_time_s, avg_watch_s, completion_rate, reach, impressions, clicks, raw JSON) — a daily
     snapshot per post for its first ~90 days, then weekly (cheap, and gives "views at day 7"
     comparisons).
   - `social_metric_definitions` — our normalised metric keys ↔ each platform's raw name + the
     date ranges where a definition changed (Meta views 2025-04-21, YouTube views 2025-03-31 /
     2026-08-24) → chart annotations.
   - Reuse `social_posts` (we already capture posts) and `social_connections` (tokens).
2. **Collectors** — one per provider behind ONE interface (`collectAccount`, `collectPosts`,
   `collectDaily`, optional `onWebhook`), registered like the shop providers; a daily
   `social-analytics` cron (primary only) + a 3-hourly Instagram Stories sweep; per-metric error
   tolerance; token refresh jobs (IG ~day 50, Google refresh token, TikTok refresh).
   - YouTube: Data API snapshot + Analytics API (last 5 days, day×video) + Reporting API reach jobs.
   - Instagram: account insights + media insights (Feed/Reels/Stories) via Instagram Login.
   - Facebook: page insights + post insights.
   - TikTok: Display API now; Business API when approved.
   - X: owned reads (opt-in, spend-capped setting) — keep paste-by-URL as the free mode.
   - Patreon: daily campaign/member snapshot + `members:*` webhooks.
3. **Derived metrics** (computed in SQL from the snapshots): net follower change, avg views/likes
   per post, engagement rate (user-selected basis), watch-time averages, growth over period,
   top posts, per-platform and all-platform totals — each with a definition tooltip.
4. **Dashboard** (admin → Social → Analytics): cross-network overview → per-account tab →
   per-post table (sortable, filter by type: video / short / reel / story / post) → charts with
   "since connected" markers and definition-change annotations → CSV/PDF export → optional
   weekly email report (existing mail + notifications plumbing).
5. **AI layer** (later): a weekly/monthly summary built from the derived tables (top posts, what
   changed, anomalies, best times from our own history), stored per period and shown on the
   dashboard; ad-hoc "ask about my analytics" over the same tables.
6. **Manual import**: per-platform CSV upload mapped into the same tables, for history and gaps.
7. **Permissions**: `social.analytics:view` (staff) / `social.analytics:manage` (admin: collectors,
   X spend cap, imports).

> **STATUS 2026-11-05 — phases 1–4 BUILT** (guide: `docs/how-it-works/SOCIAL-ANALYTICS.md`).
> 1 storage: DONE (migration 201; `social_metric_definitions` is code, not a table —
> `SOCIAL_METRICS` / `SOCIAL_DEFINITION_CHANGES` in `@sitesurge/types`; plus a `social_analytics_runs` log).
> 2 collectors: DONE for YouTube (Data + Analytics + Reporting), Instagram (+ Stories sweep),
> Facebook, TikTok (Display; Business branch unverified), X (opt-in, spend-capped), Patreon
> (no webhooks yet), Threads (new analytics-only provider, migration 203). Not yet verified
> against live accounts except where noted in the guide.
> 3 derived metrics + 4 dashboard: DONE (Social → Analytics; CSV export of posts).
> 5: AI summary DONE (through the new AI module / claude-broker plugin); weekly email report and
> CSV import NOT built. 6 manual import: NOT built. 7 permissions: DONE.

**Phasing suggestion:** (1) snapshot tables + YouTube + Instagram + Facebook collectors (all free,
largest value) → (2) dashboard + derived metrics → (3) TikTok Display + Patreon → (4) X owned
reads, TikTok Business, Threads → (5) AI summaries, exports, email report, CSV import.

---

## 7. Account setup checklist (what you'll need to do)

- **YouTube:** re-connect "Sign in with Google" once we add `yt-analytics.readonly`; make sure the
  Google Cloud OAuth consent screen is **In production** (else tokens die in 7 days); sign in
  with the account that **owns** the channel.
- **Instagram:** confirm the account is **Business or Creator**; in our Meta app add the
  Instagram product with **Instagram Login**, add the account as a tester/app role, grant
  `instagram_business_basic` + `instagram_business_manage_insights`.
- **Facebook Page:** Page token with `read_insights`, `pages_read_engagement`,
  `pages_show_list`; you need the Page's ANALYZE (or admin) role.
- **TikTok:** create a TikTok developer app (Login Kit + Display API scopes `user.info.basic`,
  `user.info.stats`, `video.list`) and submit it for review; for watch time/demographics, switch
  the TikTok account to a **Business Account** and apply for TikTok for Business API access.
- **X:** only if wanted — buy API credits in the X Developer Console with a monthly spend cap,
  from the **same X account** that will be read (owned-read pricing).
- **Patreon:** register a v2 client with `campaigns`, `campaigns.members`, `campaigns.posts`,
  `w:campaigns.webhook`.

---

## 8. Sources

YouTube — [Analytics metrics](https://developers.google.com/youtube/analytics/metrics) ·
[dimensions](https://developers.google.com/youtube/analytics/dimensions) ·
[channel reports](https://developers.google.com/youtube/analytics/channel_reports) ·
[revision history](https://developers.google.com/youtube/analytics/revision_history) ·
[Reporting API reports](https://developers.google.com/youtube/reporting/v1/reports) ·
[channel report types](https://developers.google.com/youtube/reporting/v1/reports/channel_reports) ·
[authorization](https://developers.google.com/youtube/reporting/guides/authorization) ·
[Data API channels](https://developers.google.com/youtube/v3/docs/channels) /
[videos](https://developers.google.com/youtube/v3/docs/videos) ·
[quota costs](https://developers.google.com/youtube/v3/determine_quota_cost) ·
[OAuth token expiration](https://developers.google.com/identity/protocols/oauth2#expiration)

Meta — [IG user insights](https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights) ·
[IG media insights](https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights) ·
[Business Login for Instagram](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login) ·
[refresh token](https://developers.facebook.com/docs/instagram-platform/reference/refresh_access_token/) ·
[Page insights](https://developers.facebook.com/docs/graph-api/reference/page/insights/) ·
[Pages changelog](https://developers.facebook.com/docs/pages-api/changelog/) ·
[Page Insights updates 2025-08-15](https://developers.facebook.com/blog/post/2025/08/15/page-insights-api-updates/) ·
[deprecated Page metrics](https://developers.facebook.com/documentation/pages-api/platforminsights/page/deprecated-metrics) ·
[Threads insights](https://developers.facebook.com/docs/threads/insights) ·
[rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/)

TikTok — [user info](https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info) ·
[video list](https://developers.tiktok.com/doc/tiktok-api-v2-video-list) ·
[video object](https://developers.tiktok.com/doc/tiktok-api-v2-video-object) ·
[Business: post data](https://business-api.tiktok.com/portal/docs/get-post-data-of-a-tiktok-account/v1.3) ·
[Business: data latency](https://business-api.tiktok.com/portal/docs/accounts-insights-data-latency/v1.3) ·
[Business: audience insights](https://business-api.tiktok.com/portal/docs/audience-insights/v1.3)

X — [pricing](https://docs.x.com/x-api/getting-started/pricing) ·
[metrics](https://docs.x.com/x-api/fundamentals/metrics)

Patreon — [API docs](https://docs.patreon.com/)

Competitors — [Sprout Profile Performance Report](https://support.sproutsocial.com/hc/en-us/articles/213223226-How-do-I-use-the-Profile-Performance-Report) ·
[Sprout Post Performance Report](https://support.sproutsocial.com/hc/en-us/articles/360052331251-How-do-I-use-the-Post-Performance-Report) ·
[Sprout metric discrepancies](https://support.sproutsocial.com/hc/en-us/articles/38269086191757-Troubleshooting-Metric-Discrepancies-Between-Sprout-Social-and-Native-Network-Reports) ·
[Hootsuite engagement rate](https://blog.hootsuite.com/social-media-definitions/engagement-rate/) ·
[Hootsuite data discrepancies](https://help.hootsuite.com/hc/en-us/articles/4402023617563-Data-discrepancies-in-Analytics) ·
[Hootsuite competitive analysis](https://www.hootsuite.com/platform/competitive-analysis) ·
[Buffer analytics](https://support.buffer.com/articles/getting-started-with-buffers-analytics-features-UVAe3hwLD8) ·
[Agorapulse reporting](https://www.agorapulse.com/features/social-media-reporting/) ·
[Metricool review](https://bloggingwizard.com/metricool-review/)
