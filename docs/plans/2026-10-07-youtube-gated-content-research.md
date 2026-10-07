# YouTube members-only videos on the website — research

Date: 2026-10-07. Status: research only, no code changed.

**Question.** Can Surge Media show its OWN YouTube channel's members-only videos inside the SiteSurge site to users who paid on the website (Stripe → CMS role), using the YouTube Data API and the owner's credentials? Also: can we detect a user's YouTube membership to grant the site subscription?

**Short answer.**

| Goal | Possible? | Why |
|---|---|---|
| List the channel's members-only videos (metadata) | Partly — undocumented | No `membersOnly` flag in the API. `search.list` omits them. The undocumented `UUMO…` playlist lists them. `videos.list` by id returns metadata. |
| Play a members-only video in a YouTube embed for a non-member | **No** | YouTube checks the viewer's signed-in Google account. A non-member sees the "only for members / Join" gate. No API grants playback to someone else. |
| Charge site users to watch any YouTube embed | **No (policy)** | Developer Policies III.F.3.a: "API Clients must not charge users to watch content in an embedded YouTube player." |
| Download members-only videos from YouTube and re-serve them | **No (policy)** | Developer Policies forbid downloading/caching/storing YouTube audiovisual content without written approval. |
| Owner uploads the ORIGINAL files to our own storage and gates them | **Yes** | The creator keeps ownership; YouTube's license is non-exclusive. This does not touch YouTube at all. |
| Detect a user's YouTube membership (`members.list`) | **Only with allow-listing** | Endpoint is limited to creators with a YouTube Partner Manager; ordinary OAuth gets 403. |

---

## Current SiteSurge state

- `packages/api/src/services/social/youtube.ts` reads public uploads with an **API key only** (`search.list` → `videos.list` for `contentDetails`/`liveStreamingDetails`). No OAuth.
- `packages/api/src/services/connections.ts` treats a YouTube connection as connected with `apiKey` (or `accessToken`) + `channelId`.
- Gating exists for pages/posts (`middleware/content-access.ts`, `accessLevel` `public|member|patron`, `CONTENT_LOCKED`) and the permissions catalog.
- Storage (`services/storage/types.ts`) has `upload`/`delete`/`getUrl` — **public URLs only**. There is no presigned/signed-URL method yet. Media is on Cloudflare R2 behind a public CDN host.

---

## 1. Can the Data API list members-only videos?

- **Representation.** `status.privacyStatus` has only `public | private | unlisted`. No members-only value and no dedicated flag. The only mention in the video resource docs is in `snippet.publishedAt`: "If a video is uploaded as a members-only video, the property value specifies the date and time that the video was uploaded." — https://developers.google.com/youtube/v3/docs/videos
- **`search.list`** returns only publicly available videos; members-only videos are not included (developer report): https://github.com/googleapis/google-api-python-client/issues/2648
- **`videos.list` by id** still returns metadata for a members-only video (same report). A practical signal: the API withholds `statistics.viewCount` for a members-only video (reported in https://github.com/joshcoolman/ai-news/pull/22).
- **Undocumented `UUMO` playlist.** Replace the `UC` prefix of the channel id with `UUMO` and call `playlistItems.list` → members-only videos. Sibling prefixes: `UU` all uploads, `UULF` long-form, `UUSH` Shorts, `UULV` live. Reported working as of 2026-10-04 (https://github.com/joshcoolman/ai-news/pull/22, https://github.com/joshcoolman/ai-news/issues/21). **Not documented** — the official `relatedPlaylists` only lists likes/favorites/uploads (https://developers.google.com/youtube/v3/sample_requests). It can change without notice.
- **API key vs owner OAuth.** The `UUMO` playlist and `videos.list` work with an API key (members-only videos are publicly *discoverable*; only playback is gated — "Anyone can find a members-only video, but only members at the right levels can watch it", https://support.google.com/youtube/answer/7544492). Owner OAuth (`youtube.readonly`) adds nothing documented for members-only status.

**Result:** we CAN list titles/thumbnails/ids of members-only videos (as teasers), but only through an undocumented playlist id. We cannot play them for non-members.

## 2. Can a members-only video be embedded for a non-member?

- Access is decided by the viewer's signed-in YouTube account, not by where the player is. Non-members "see a note saying the video is only for members, along with ways to become a member" (https://support.google.com/youtube/answer/7544492). Tools that fetch without a member's cookies get "Join this channel to get access to members-only content like this video" (https://gist.github.com/sathishshan/79b850c8cb14190c37d199a564611bd6).
- The IFrame Player API has no parameter, token or API to authorize playback for another viewer (https://developers.google.com/youtube/player_parameters).
- Even for PUBLIC videos, the Developer Policies prohibit paywalling the embed: III.F.3.a "API Clients must not charge users to watch content in an embedded YouTube player", and must not "gate access to a video by requiring a user to take an action other than clicking the play button" (https://developers.google.com/youtube/terms/developer-policies).
- Changing a members-only video to **unlisted** and embedding it behind our login would technically play, but it still violates III.F.3.a when the site charges for access, and the unlisted URL leaks freely (anyone with the id can watch on youtube.com).

**Result:** No official way. Do not paywall YouTube embeds.

## 3. Re-hosting the video ourselves

- **Downloading from YouTube is prohibited**: "must not … download, import, backup, cache, or store copies of YouTube audiovisual content without YouTube's prior written approval"; also must not "separate, isolate, or modify the audio or video components" (https://developers.google.com/youtube/terms/developer-policies). This applies even to the owner's own channel when done through YouTube/API Services. (YouTube Studio lets an owner download their own uploads for personal backup, but the clean path is the original file.)
- **Owner hosting the original master is fine.** YouTube Terms: "You retain ownership rights in your Content", license to YouTube is "worldwide, non-exclusive …" (https://www.youtube.com/static?template=terms). Uploading the same original file to R2 and selling access on the site uses no YouTube service.
- **Channel-membership perk policy caution.** YouTube's perk rules apply to perks "whether listed in your membership window or available by other means", and "downloads of content … available on YouTube" are not allowed as perks (summarised from https://support.google.com/youtube/answer/7636690 and https://support.google.com/youtube/answer/7544492). So: sell the website subscription as its own product (Stripe), do NOT advertise "website access" as a YouTube membership perk, and do not offer downloadable copies to YouTube members as a perk.

**Result:** Realistic path = the operator uploads original video files to SiteSurge storage; the site gates them.

## 4. Fallback — detect a user's YouTube membership

- **`members.list`** (https://developers.google.com/youtube/v3/docs/members/list): creator-only, for their own memberships-enabled channel. Scope `https://www.googleapis.com/auth/youtube.channel-memberships.creator`. "Reach out to your Google or YouTube representative to request access." Params: `mode=all_current|updates`, `filterByMemberChannelId` (≤100 channel ids, comma-separated), `hasAccessToLevel`, `maxResults` ≤1000. Quota 2 units.
- Member resource: `snippet.memberDetails.channelId`, `membershipsDetails.highestAccessibleLevel`, `accessibleLevels[]`, `membershipsDuration.memberSince` (https://developers.google.com/youtube/v3/docs/members). "Access to the `members` and `membershipsLevels` endpoints is limited to YouTube creators who have a dedicated YouTube Partner Manager."
- **`membershipsLevels.list`** (https://developers.google.com/youtube/v3/docs/membershipsLevels/list): same scope, 1 unit; lists level ids/names for mapping to site roles.
- Without allow-listing the call returns **403** even with correct scope (https://github.com/googleapis/googleapis/discussions/898). Third-party workarounds (borrowing StreamElements' token) are not acceptable for production.
- **User side.** The user links Google via OAuth with `youtube.readonly`, we call `channels.list?mine=true` to get their channel id (https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps). All YouTube scopes are **sensitive** → Google OAuth app verification (privacy policy, Limited Use disclosure, ~2–3+ weeks) before non-test users can connect (https://www.getphyllo.com/post/youtube-oauth-scopes). Refresh tokens with YouTube scopes are revoked on password change — store only the channel id, not the token.
- **Check flow.** Owner token (allow-listed) → `members.list?filterByMemberChannelId=<userChannelId>` → membership + level → grant/revoke site role. Re-sync periodically with `mode=updates` (a cron, primary-only), since memberships lapse.
- There is **no** endpoint for a viewer to read their own paid memberships; `subscriptions.list` covers free subscriptions only.
- Note: Developer Policies III.G.1.b forbid selling access to API Services without approval; granting a role to someone who already paid YouTube is fine, but data use must stay within the membership-perk delivery purpose ("member information can be shared with a third-party company, but only to deliver channel membership perks", https://support.google.com/youtube/answer/9315687).

**Result:** Feasible only after Surge Media's Partner Manager enables the memberships API for the channel, plus Google OAuth verification. Treat as optional, gated on that approval.

## 5. Recommended architecture for SiteSurge

**A. Gated video hosted by SiteSurge (the core path)**
1. Operator uploads the original video files (not YouTube downloads) to a **private** R2 bucket/prefix — not the public CDN host.
2. New storage capability: `getSignedUrl(filename, ttlSeconds)` on the S3 provider (AWS SDK presigner; R2 supports SigV4 presigned GETs). Local provider: a token-checked streaming route with HTTP Range support.
3. Prefer HLS: transcode on upload (ffmpeg → multi-bitrate HLS segments) so playback is adaptive and individual segment URLs are short-lived. Simpler v1: MP4 with presigned URL + Range.
4. Access: a `video` entity/media flag with `accessLevel` reusing `content-access.ts`, plus a permission e.g. `media.gated:view` (FEATURE_PERMISSIONS, default = current member/patron behaviour). An endpoint `GET /media/:id/playback` checks auth + permission and returns a signed URL (TTL ~5–15 min). Never cache that response publicly.
5. Player: the existing Plyr `VideoPlayer` with the signed source. Teaser (title/thumbnail/description) is public; the locked state shows the Stripe subscribe CTA.
6. Stripe subscription → role (already exists) is the only entitlement source in v1.

**B. YouTube for public content only** — keep the existing API-key sync. Optionally add the undocumented `UUMO` playlist to show members-only **teasers** that link out to YouTube ("Watch on YouTube — members only"); mark it as best-effort, with a fallback (missing `viewCount`) and a feature flag in case it breaks.

**C. Optional YouTube-membership → site role sync** — only after (1) Partner Manager enables `youtube.channel-memberships.creator` for the channel and (2) Google verifies the OAuth app. Then: user "Link YouTube" (OAuth `youtube.readonly`, store channel id only) → owner-token `members.list` filter → map `membershipsLevels` to site roles → periodic `mode=updates` resync revokes lapsed members.

**NOT possible / not allowed**
- Playing a YouTube members-only video for a viewer who is not a YouTube member (no API, no embed parameter).
- Charging for, or putting behind a login wall, any embedded YouTube player (III.F.3.a).
- Downloading/caching videos from YouTube to re-serve them (Developer Policies), even the owner's own, through YouTube services.
- Using `members.list` / `membershipsLevels.list` without Partner Manager allow-listing (403).
- A documented API field that marks a video as members-only.

## Sources
- https://developers.google.com/youtube/v3/docs/videos
- https://developers.google.com/youtube/v3/docs/members
- https://developers.google.com/youtube/v3/docs/members/list
- https://developers.google.com/youtube/v3/docs/membershipsLevels/list
- https://developers.google.com/youtube/v3/sample_requests
- https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps
- https://developers.google.com/youtube/player_parameters
- https://developers.google.com/youtube/terms/developer-policies
- https://www.youtube.com/static?template=terms
- https://support.google.com/youtube/answer/7544492
- https://support.google.com/youtube/answer/7636690
- https://support.google.com/youtube/answer/9315687
- https://github.com/googleapis/googleapis/discussions/898
- https://github.com/googleapis/google-api-python-client/issues/2648
- https://github.com/joshcoolman/ai-news/pull/22
- https://www.getphyllo.com/post/youtube-oauth-scopes
- https://gist.github.com/sathishshan/79b850c8cb14190c37d199a564611bd6
