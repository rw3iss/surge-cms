# Live shows

A **Live Show** is a post type (`post_type = 'live'`). The host streams from the
browser, viewers watch on the post page with chat and reactions, and the show is
recorded so it can be replayed. In-admin version: `/admin/help/live-shows`.

## Set up the video provider

Posts → Settings → Live Show (`posts_settings.live`).

| Provider | Status |
|---|---|
| Cloudflare Stream (WebRTC) | Implemented — WHIP from the host, WHEP to viewers, under 1 s delay |
| LiveKit, 100ms | Listed, not implemented |

Cloudflare: enable Stream, create an API token with **Account → Stream → Edit**,
then enter the account id, the token and the customer subdomain. Secrets are masked
after saving. The CSP adds the provider host automatically (boot, settings save,
publish, playback).

nginx must pass WebSocket upgrade headers for `/ws/live` (as for `/ws/admin`).

## Run a show

1. Posts → New Post → **Live Show**.
2. The console previews camera + microphone and holds the show settings: chat
   (`off` / `public` / `members` / `subscribers`), reactions, record (archive).
3. Publish, then use the host controls: Go live, Pause / Resume, Mute, End show.

Who can watch follows the post (published status + subscription tier). Host
commands need `posts.live:host`; deleting chat lines needs `posts.live:chat_moderate`.

## Recording and replays

| Method | What happens |
|---|---|
| `browser` (default) | The host page records the camera and uploads exact 8 MiB parts while live. A reload starts "part 2" (never appends). |
| `server` | Planned: a WHEP recorder on the server. |
| `none` | Nothing is recorded. |

- A completed recording becomes a video media item. H.264 recordings (Chrome, Edge,
  Safari) get a **quick replay** within a minute or two; the multi-quality encode
  replaces it later.
- Every completed recording is a **version** (`type_settings.recordingVersions`).
  Console → Recordings: play, **Show on post**, **Delete**, **Restart show**,
  **Download chat transcript**.
- **Delete** removes the video and all its files — unless something else still uses
  it (a gallery item, another post, a template, an entity field…): then it is only
  removed from this post and the file stays in the Media library. The confirm dialog
  lists where it is used.
- Saving the post never overwrites the recording keys (`recordingVersions`,
  `recordingMediaId`, `recordingRemovedAt`, `providerInputId`): the server owns them.
- Safety net: an unfinished recording completes 10 minutes after the show ends, plus a
  daily sweep.

## Chat after the show

Every chat line is also written to `live_chat_messages` (migration 176, best-effort,
batched every 2 s). A deleted line is **marked**, not dropped.

- The ended post page shows the saved chat, read-only, beside the replay
  (`GET /posts/:id/live/chat`, `cms.posts.liveChat`; same view gate as the show).
- **Download chat transcript** (`GET /posts/:id/live/chat/transcript`, staff +
  `posts.live:host`, `cms.posts.liveChatTranscriptUrl`) — plain text, deleted lines
  marked.

## Viewers and moderation

Click the viewer count in the console header → **Viewers** panel.

| Action | Effect |
|---|---|
| Mute | No chat (this show) |
| Silence N min (≥ 5) | No chat, no reactions |
| Kick | Removed from this show |
| Ban | Removed from every show — permanent, or for 1 hour / 1 day / 7 days / 30 days |

- A guest is banned by browser key AND IP hash. The IP is read only from the
  `X-Real-IP` header nginx writes (client-settable `CF-Connecting-IP` /
  `X-Forwarded-For` are ignored).
- Bans and kicks are checked on **every** chat and reaction, against both the
  socket's key and the ticket's user, and a banned or kicked member gets no room
  ticket — so opening an anonymous window does not get around them.
- The Banned list (search box; shows the length and the show it came from) has
  **Unban**. An expired ban stops counting by itself (`live_bans.expires_at`,
  migration 175).
- Every action is in the audit log (`live_mute`, `live_silence`, `live_kick`,
  `live_ban`, `live_unban`, …).
- Staff are never moderated. Permission: `posts.live:moderate_viewers` (staff).

## SDK

```ts
const room = await cms.posts.liveState(id);
const { token } = await cms.posts.liveTicket(id);
const viewers = await cms.posts.liveViewers(id);                       // staff
await cms.posts.liveModerate(id, { key: 'u:<userId>', action: 'ban', minutes: 1440 });
const bans = await cms.posts.liveBans();
const versions = await cms.posts.liveReplays.list(id);
const chat = await cms.posts.liveChat(id);                             // ended shows
```
