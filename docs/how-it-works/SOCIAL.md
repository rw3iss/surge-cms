# Social feed & publishing

SiteSurge displays your social posts with a **capture-first, render-locally**
model: post ids enter the local `social_posts` cache, and each post is rendered
server-side into a native card (no third-party scripts). This avoids scraping
and the paywalled read-timeline APIs for the default path.

Everything lives under the admin **Social** section (`/admin/social`), gated by
the `social` feature (enabled by default; toggle in Settings → Features). The
hub has three tabs:

- **Posts** — the local cache. Add posts by URL, hide/show, reorder, delete.
- **Compose** — write once and cross-post to connected providers.
- **Configuration** — provider connections + per-provider utilities (relocated
  from the old Settings → Connections).

## The three ways a post enters the feed

| Source | How | Cost | Providers |
|--------|-----|------|-----------|
| `manual` | Paste a post's permalink on the Posts tab → rendered via oEmbed | **Free** | X (today) |
| `posse` | Compose in the CMS → published via the provider's write API → captured back | **Paid** for X (write API) | X (today) |
| `sync` | Pulled from a provider read API on a schedule / manual "Sync now" | Free for IG/FB/YT; **paid** for X | IG, FB, YT, (X in API mode) |

> **X has no usable free API tier.** X monetized both reading *and* writing. The
> free developer plan's posting allowance is tiny and, once used, `POST /2/tweets`
> returns `402 credits depleted`. So on X: **composing/publishing and auto-sync
> are paid-plan only.** The **free** way to build an X feed is `manual` capture —
> paste post URLs on the Posts tab.

## X / Twitter — the free path: paste-by-URL (default)

No X API plan required. On the **Posts** tab, pick X/Twitter and paste a tweet's
URL. It's rendered by hydrating the tweet server-side via
`cdn.syndication.twimg.com/tweet-result` (the same public endpoint `react-tweet`
uses) into a native `SocialEmbed` card — cached in Redis, no X JavaScript. If a
tweet can't be hydrated, we fall back to X's official **oEmbed** HTML
(sanitized). This path never calls the paid API.

> **Reliability caveat:** the `tweet-result` endpoint is public but undocumented;
> X can change it. The oEmbed fallback and the stored text/permalink mean a post
> never disappears — worst case it renders as a minimal card / link.

## X / Twitter — composing (paid plan required)

Composing/publishing a *new* tweet from the CMS (the Compose tab) calls
`POST /2/tweets`, which **consumes X API credits — a paid plan is required.** With
the free plan you'll get `402 credits depleted`. If you do have a paid plan, save
**user-context** OAuth 1.0a credentials in Configuration → Twitter/X:

- `apiKey` / `apiSecret` — the app's consumer key/secret
- `accessToken` / `accessSecret` — your user access token/secret (with
  `tweet.write`)

Reading (auto-sync) is **not** required for the free feed.

## X / Twitter — the paid API path (opt-in)

If you want fully-automatic discovery of *all* your posts (including ones tapped
out in the X app), switch Configuration → Twitter/X → **Feed mode** to **API**
and provide a **Basic-tier bearer token**. Then:

- The read-sync (`fetchTwitterPosts`) is enabled — in **free mode it is skipped**
  entirely.
- Syncs use `since_id` (watermarked in the connection `settings.lastTweetId`) and
  pull ≤10 per run, keeping usage under the Basic-tier ~10k posts/month cap.
- Sync hourly rather than aggressively.

### Media (photos + video)

The Compose tab can attach media from the media library. On publish, the server
fetches each asset's bytes and uploads them to X (user-context OAuth 1.0a, same
credentials as text posting), then attaches the returned `media_id`s to the
tweet:

- **Photos** (≤5 MB, non-GIF) — one-shot upload.
- **Video / GIF / large images** — chunked `INIT`/`APPEND`/`FINALIZE`, then the
  server polls `STATUS` until processing completes (videos are async).

X's per-post rules are enforced: **up to 4 photos, OR exactly one video/GIF**.
Media upload targets the v1.1 `upload.twitter.com` host (the canonical
OAuth-1.0a media flow); if X retires it, switch `UPLOAD_URL` in
`services/social/twitterMedia.ts` to `/2/media/upload`. Media upload is part of
the write surface and generally works on the free tier — confirm with a live
test post, since X's access gates shift.

## Other providers

Instagram / Facebook / YouTube use their existing OAuth/API connections and the
read-sync path (with media mirrored into local storage for IG/FB, whose CDN URLs
expire). Compose/cross-post to these is not implemented yet — the Compose tab
greys them out with a reason.

## Rendering

The public Social block renders stored posts as `SocialEmbed` cards. Manual and
POSSE posts have the same shape as synced ones, so they render identically.
Hidden posts (`is_hidden`) are excluded from public feeds but visible to admins
on the Posts tab for curation.

## API surface

- `POST /social/publish` — compose & cross-post `{ providers, text }`.
- `POST /social/posts/manual` — add by URL `{ url }`.
- `PATCH /social/posts/:id` — `{ isHidden?, sortOrder? }`.
- `GET /social/posts/:id/embed` — resolve to `{ mode: 'card'|'oembed', card?, html? }`.
- `GET /social/posts/:platform?includeHidden=true` — admin listing (hidden gated
  on an authenticated admin).

All exposed on the SDK as `cms.social.*`.
