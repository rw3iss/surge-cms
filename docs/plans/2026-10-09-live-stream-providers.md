# Live Show streaming providers — research + recommendation

**Date:** 2026-10-09. All prices are US list prices **seen on 2026-10-09** at the cited URL unless marked otherwise. Pay-as-you-go only; volume/contract discounts ignored.

**Context.** "Live Show" posts already have a room contract (`packages/shared/src/types/liveRoom.ts`: our own `/ws/live` WebSocket for chat, reactions, host commands; `LiveRoomState.providerConnected` is the stub this work fills). The provider's job is ONLY media: one browser host (+ 0–3 guests) → many viewers, recording into our R2, viewer access control, webhooks.

## 1. TL;DR

- **Primary: LiveKit** (Cloud now, self-hosted OSS later — same API). Host + guests publish from the browser over WebRTC; small audiences watch over WebRTC (sub-second); large audiences watch **HLS that LiveKit Egress writes straight into our R2 bucket**, served by the Cloudflare CDN with zero egress fees. The same HLS segments ARE the recording, so replay is just one of our HLS video posts. Lowest lock-in (Apache-2.0 server + SDKs).
- **Fallback (all-Cloudflare): Cloudflare Stream** — WHIP (browser host) + WHEP (viewers, < 0.5 s) for the browser mode, RTMPS → recorded HLS + signed URLs for the OBS mode. WebRTC inputs **cannot be recorded or turned into HLS** today, so the browser mode records on the host with `MediaRecorder` → R2 multipart. No SDK needed (WHIP/WHEP are ~one HTTP POST each).
- **Watch:** Cloudflare **RealtimeKit** (ex-Dyte) does everything we want (stage, livestream, recording to R2, signed webhooks) but the docs do not state how livestream viewers are billed. Re-evaluate once that is clear.
- **Worked examples** (1 h show, 500 avg viewers, recorded / 4 shows × 1 h × 200 viewers per month):
  - LiveKit + HLS to R2: **≈ $0 / $50** (plan fee only).
  - LiveKit, all viewers on WebRTC: **$60.50 / $84.80**.
  - Cloudflare Stream WHEP: **$30 / $48**.
  - Amazon IVS: **≈ $38 / $58**.
  - 100ms: **≈ $24 / $46** after free tiers.

## 2. Assumptions for the worked examples

- **Show A:** 1 hour, 1 host, 500 average viewers, recorded. That is 60 host-min, **30,000 viewer-min**, 60 recorded min.
- **Month B:** 4 shows × 1 h × 200 viewers. That is 240 host-min, **48,000 viewer-min**, 240 recorded min.
- 720p at about 1.5 Mbit/s ⇒ **0.675 GB per viewer-hour**. Show A = 337.5 GB of viewer egress; Month B = 540 GB.
- "List" = no free tier. "Net" = after the provider's monthly free allowance (applied to that example alone).
- R2: storage $0.015/GB-mo, Class B reads $0.36/M, **egress free** (developers.cloudflare.com/r2/pricing, known rates). An HLS viewer with 2 s segments makes about 1 segment + 1 playlist request per 2 s. That is 1.8 M reads for Show A, about $0.65, and within R2's 10 M/month free Class B.

## 3. Providers

### 3.1 LiveKit Cloud / LiveKit OSS
- **Model:** WebRTC SFU rooms. Ingress (RTMP/WHIP in) and Egress (room-composite / track → MP4, HLS segments, RTMP out) services.
- **Host publishing:** `livekit-client` (browser, framework-agnostic). WHIP ingress for OBS 30+. Guests are ordinary participants granted `canPublish`. Bringing a viewer "on stage" = update their permissions server-side (`UpdateParticipant`).
- **Viewers:** WebRTC subscribers (sub-second; Cloud plan concurrency caps: Build 100 / Ship 1,000 / Scale 5,000 connections), **or** HLS from Egress `segment_outputs` (latency ≈ 3 × segment, about 6–10 s with 2 s segments; viewers never touch LiveKit, so no cap). LiveKit closed WHEP as "not planned" (Sept 2024), so WebRTC viewers need `livekit-client`.
- **Pricing (livekit.com/pricing, 2026-10-09):**

  | Plan | Monthly fee | WebRTC participant-min | Downstream data | Transcode (egress / ingress) |
  |---|---|---|---|---|
  | Build | free | 5k incl. | 50 GB incl. | 60 min incl. |
  | Ship | $50/mo | 150k incl., then $0.0005/min | 250 GB incl., then $0.12/GB | 600 min incl., then $0.02/min |
  | Scale | $500/mo | 1.5M incl., then $0.0004/min | 3 TB incl., then $0.10/GB | 8,000 min incl., then $0.015/min |

- **Show A, WebRTC viewers (Ship):** 30k participant-min (included) + 87.5 GB over at $0.12 = $10.50 → **$60.50** with the plan fee. **HLS-to-R2:** 60 egress min. This fits Build's 60 included minutes in a month with one show, so ≈ **$0** + about $0.65 of R2 reads. Build's 100-connection cap does not apply to HLS viewers.
- **Month B:** WebRTC viewers: 290 GB over → $34.80 + $50 = **$84.80**. HLS-to-R2: 240 egress min > Build's 60, so Ship: **$50**.
- **Recording:** Egress uploads MP4 / HLS to any S3-compatible store. **R2 is officially listed** (`endpoint: https://<acct>.r2.cloudflarestorage.com`, `region: auto`, `force_path_style: true`) (docs.livekit.io/transport/media/ingress-egress/egress/outputs/). One room-composite segmented egress = live HLS + archive at once. Auto-egress can start it on room creation.
- **Auth:** server-minted JWT (API key/secret; grants `roomJoin`, `canPublish`, `canSubscribe`, `hidden`, TTL). Viewer tokens for WebRTC; for HLS-in-R2, access control is ours (see §6).
- **Webhooks:** signed (JWT in `Authorization`, verified with `WebhookReceiver`). `room_started/finished`, `participant_joined/left`, `track_published`, `egress_started/updated/ended`.
- **SDK / licensing:** `livekit-client` (Apache-2.0, TS, no framework dependency; large bundle (hundreds of KB minified), so lazy-load it on the host page / WebRTC player only). `livekit-server-sdk` for Node. Server, Egress, Ingress are all Apache-2.0 → **self-hostable** with identical API (Egress needs headless Chrome workers + Redis).
- **Gotchas:** Egress on Cloud has no local storage (an egress with no storage configured fails). Transcode minutes are counted per egress (live HLS + a separate MP4 = 2×; use one segmented egress). Self-hosting needs UDP port ranges/TURN, and the per-show egress of 337 GB moves to our VPS bandwidth bill.

### 3.2 Cloudflare — three separate products
**(a) Stream Live, RTMPS/SRT → HLS/DASH** (developers.cloudflare.com/stream/stream-live/)
- OBS/encoder only (a browser cannot speak RTMP/SRT). H.264 + AAC only. Standard HLS latency; LL-HLS is **beta** (`preferLowLatency`).
- `recording.mode: automatic` → every broadcast becomes a Stream video (downloadable MP4 → copy into R2). Live inputs support **signed URLs** (also applied to their recordings). Webhooks for live input connect/disconnect/errors and video ready. Recordings truncate at 7 days.
- **Pricing** (developers.cloudflare.com/stream/pricing/, 2026-10-09): ingest + encoding **free**; delivery **$1 / 1,000 min**; storage **$5 / 1,000 min / month**. No free allowance.
- Show A: $30 delivery + $0.30/mo storage (or $0 if we copy to R2 and delete). Month B: $48 + $1.20/mo.

**(b) Stream WebRTC — WHIP in / WHEP out** (developers.cloudflare.com/stream/webrtc-beta/)
- **Now GA.** Sub-second ("less than 500 milliseconds"). Works in Chrome/Firefox/Safari; OBS 31+ and FFmpeg 8.1+ speak WHIP.
- **Limits (quoted):** "Recording and live HLS playback are not yet supported". No simulcast via RTMP/SRT, no viewer counts, no metrics. WHIP and WHEP must be used together (a WHIP input cannot feed HLS viewers). No published per-input viewer cap.
- **Pricing:** WHEP playback billed as delivery, **$1 / 1,000 min, starting 2026-10-15** (free until then). Show A **$30**, Month B **$48**.
- Recording workaround: the host page runs `MediaRecorder` on the same `MediaStream` and streams chunks to our API → R2 multipart. Cost ≈ $0, but quality depends on the host's machine and uplink; transcode WebM → HLS afterwards with our existing video pipeline.
- **Guests:** WHIP is one publisher per input. Multi-guest needs either several inputs (viewers WHEP each and we tile client-side) or (c).

**(c) Realtime SFU (ex-Calls) and RealtimeKit (ex-Dyte)**
- **SFU:** raw WebRTC SFU, **$0.05/GB egress, first 1,000 GB/month free** (developers.cloudflare.com/realtime/sfu/pricing/). Show A and Month B both fit the free 1,000 GB → **$0**. But it is a bare SFU: no recording, no HLS, no rooms/tokens/webhooks. Its only egress adapter is a beta WebSocket adapter (PCM audio, ~1 fps JPEG video). We would build signalling, auth and recording ourselves. Not worth it for v1.
- **RealtimeKit:** rooms with presets (presenter / viewer), stage requests ("bring on stage"), livestream (LHLS), composite recording stored in R2 (7-day default retention, or pushed to AWS/Azure/DO buckets), signed webhooks (`recording.statusUpdate`, meeting/participant events), Core SDK (headless) + UI Kit.
- **Pricing** (developers.cloudflare.com/realtime/realtimekit/pricing/, 2026-10-09): A/V participant **$0.002/min**; export (recording / RTMP / HLS) **$0.010/min**; raw RTP export into R2 $0.0005/min.
  - Docs do NOT say whether HLS livestream viewers are billed as participants. Webinar *viewers* in the meeting **are** billed as A/V participants.
  - Some pages still describe it as beta/free.
  - Worst case (viewers = participants): Show A = $60 + $0.12 + $0.60 livestream + $0.60 recording ≈ **$61.32**; Month B ≈ **$101.28**. Best case (viewers unbilled): ≈ $1.32 / $5.28.

### 3.3 100ms
- **Model:** WebRTC rooms + "Interactive Live Streaming" (composites the room to HLS for viewers, with role change to bring viewers on stage). Templates/roles define permissions.
- **Pricing** (100ms.live/pricing, 2026-10-09):

  | Item | Rate | Free / month |
  |---|---|---|
  | Conferencing | $0.004 / participant-min | 10k min |
  | HLS viewers | $0.0012 / viewer-min | 10k min |
  | Recording | $0.0135 / min | 300 min |
  | Transcoding (HLS) | $0.04 / min | 1,000 min |
  | RTMP out | $0.04 / min | 300 min |

- Show A (HLS viewers): list $36 + $0.24 + $0.81 + $2.40 = **$39.45**; net ≈ **$24**. On WebRTC viewers it would be $120. Month B: list **$71.40**, net ≈ **$45.60**.
- **Recording:** MP4. Kept 15 days in 100ms storage, or uploaded to your AWS S3 / GCS / Azure / Alibaba bucket. **No custom endpoint field, so no direct R2** → copy from the webhook-supplied URL.
- **Auth:** server-minted JWT (app access key + secret; `room_id`, `role`) + management token for REST. Webhooks for room/peer/recording/HLS events.
- **SDK:** `@100mslive/hms-video-store` (framework-agnostic reactive store) + React kit. Proprietary; no self-host.
- **Gotcha:** company signals are mixed (last funding 2022; a 2026 Tracxn profile describes "100ms.ai" voice agents for healthcare). Medium vendor risk.

### 3.4 Amazon IVS
- **Two products.**
  - **Low-Latency channels:** RTMPS, or browser via the IVS Web Broadcast SDK. HLS-based, ~2–5 s. Unlimited audience.
  - **Real-Time stages:** WebRTC, < 300 ms, up to 12 publishers, 10k subscribers by default (25k on request).
- Server-side composition pushes a stage to a channel and/or S3. Individual or composite recording to **S3 in the stage's region**, as HLS segments.
- **Pricing** (aws.amazon.com/ivs/pricing/, 2026-10-09):

  | Item | Rate |
  |---|---|
  | Channel input, Basic | $0.20 / h |
  | Channel input, Standard | $2.00 / h |
  | Output, SD | $0.036 / viewer-hour |
  | Output, HD | $0.072 / viewer-hour |
  | Output, Full HD | $0.144 / viewer-hour |
  | Real-time stage participant (publisher or subscriber) | $0.072 / participant-hour |
  | Composition, HD | $0.30 / h |
  | Free tier | 12 months only, small |

- Show A, Standard channel: $2 + 500 × $0.072 = **$38**. Basic channel: $36.20. Real-time stage: 501 × $0.072 + $0.30 composite ≈ **$36.37**. Month B (Basic, HD): $0.80 + $57.60 = **$58.40**.
- **Recording → R2:** S3 only, so we copy afterwards (S3 egress ~$0.09/GB, trivial at a few GB per show).
- **Auth:**
  - Stage: participant tokens (`CreateParticipantToken`, or self-signed JWTs with a key pair).
  - Channel: **private playback with ES384 JWTs** we sign. A good fit for subscriber-only shows.
  - Events via EventBridge, not plain webhooks: we need an SNS/API-destination hop.
- **SDK:** `amazon-ivs-web-broadcast` (framework-agnostic, proprietary) + IVS Player. Heavy AWS coupling (IAM, regions, EventBridge).

### 3.5 Daily
- **Model:** WebRTC SFU calls, plus `startLiveStreaming` to RTMP or **HLS written into YOUR S3 bucket** (AWS only: `assume_role_arn`), with `save_hls_recording` keeping it as VOD.
- **Pricing** (daily.co/pricing/video-sdk/, 2026-10-09):

  | Item | Rate | Free / month |
  |---|---|---|
  | Video participant-min | $0.004 (volume-discounted to $0.0015) | 10k |
  | HLS | $0.03 / encoded min | – |
  | RTMP | $0.015 / encoded min | – |
  | Recording | $0.01349 / min + $0.003 / min storage | – |

- Show A: $0.24 + $1.80 HLS + viewer egress from our AWS bucket (~337 GB × ~$0.085 ≈ $28.70) ≈ **$30.70**. With WebRTC viewers: $120. Month B ≈ **$53**.
- **R2:** not directly (AWS IAM role). Copy afterwards.
- **Auth:** meeting tokens (server REST). Webhooks for recording / streaming / meeting events. `daily-js` is framework-agnostic, proprietary.
- Daily's focus has shifted toward voice AI (Pipecat), but the video SDK is current.

### 3.6 Agora
- **Model:** proprietary SD-RTN. Hosts + "audience" role with RTC (~400 ms) delivery. Cloud Recording (individual/composite, or web-page recording).
- **Pricing** (docs.agora.io/en/interactive-live-streaming/overview/pricing; agora.io/en/pricing, 2026-10-09). Billed per 1,000 min by **aggregate received resolution**:

  | Item | Per 1,000 min |
  |---|---|
  | Host, HD | $3.99 |
  | Broadcast audience, HD | $1.99 |
  | Broadcast audience, Full HD | $4.59 |
  | Cloud Recording, HD | $5.99 |
  | Cloud Recording, Full HD | $13.49 |
  | Free | 10k min / month |

- Show A: $0.24 + $59.70 + $0.36 = **$60.30** list, ≈ $40 net. Month B: **$97.92** list, ≈ $78 net.
- **Recording:** to your S3/GCS/Azure/etc. Agora's vendor list includes S3-compatible stores; verify R2 against their `vendor` table before relying on it.
- **Auth:** RTC tokens (AccessToken2, app certificate). Webhooks via the "Notifications" (NCS) service.
- **SDK:** `agora-rtc-sdk-ng`, framework-agnostic, large (~1 MB+), proprietary, **no self-host**.

### 3.7 Mux
- **RTMP/SRT only.** "We currently do not support direct WebRTC ingest" (mux.com/docs/guides/live-streaming-faqs). Mux Real-Time Video was shut down 2024-01-03 (customers moved to LiveKit). Latency 12–30 s.
- **Pricing** (mux.com/pricing/video, 2026-10-09):

  | Item | Rate |
  |---|---|
  | Live encode | $0.03125 / min |
  | Delivery | $0.001 / min (**100k min / month free**) |
  | Storage | $0.003 / min / month |

- Show A ≈ **$2.06** net (list $32.06). Month B ≈ **$8.22** net.
- Excellent player and signed-playback JWTs. **But the browser host needs a WHIP→RTMP bridge we run** (e.g. LiveKit/MediaMTX in front), so Mux is only a CDN/archive backend, not a full answer. Good OBS-mode option.

### 3.8 Vonage Video API (OpenTok)
- **Model:** WebRTC sessions (up to 15k real-time participants in "WebRTC broadcast") + HLS composition + archiving (individual ZIP or composed MP4 → your S3/Azure).
- **Pricing** (vonage.com/communications-apis/video/pricing/, via search snippet; the page itself returns 403 to fetchers, 2026-10-09):

  | Item | Rate |
  |---|---|
  | Participant | $0.0041 / min |
  | HD composition (for HLS) | $0.1035 / session-min |
  | HLS viewer, up to HD | $0.00155 / min |
  | HD composed archive | $0.0363 / min |

- Show A ≈ **$55.14**; Month B ≈ **$108.93**. Mature but the priciest; proprietary.

### 3.9 Twilio Video
- The end-of-life was **reversed** (twilio.com/en-us/changelog/-twilio-video-will-remain-a-standalone-product, 2024-10-21); it still accepts customers in 2026. $0.004/participant-min.
- No HLS/broadcast tier; group rooms cap at 50 participants. **Not suitable** for 500 viewers.

### 3.10 Dolby OptiView (ex-Millicast / Dolby.io + THEOlive)
- Sub-500 ms WebRTC to very large audiences, WHIP/WHEP-style publishing, recordings.
- **Pricing is "custom"** (optiview.dolby.com/plans/): bandwidth-allotment plans + per-GiB overage. No list price → excluded from the cost table. Premium/sports-betting segment; overkill here.

### 3.11 api.video
- RTMPS/SRT live (~3 s "low latency" claimed), no WebRTC browser ingest found.
- **Pricing** (api.video/pricing/, 2026-10-09): delivery $0.0017/min, storage $0.00285/min, encoding free. Show A ≈ **$51**, Month B ≈ **$82**.
- Same browser-host gap as Mux.

### 3.12 Newcomers / others
- **GetStream Video** (getstream.io/video/pricing/): RTMP/WebRTC in, HLS out at $0.96 / 1,000 viewer-min, HD recording $6 / 1,000 min, **$100/month free usage**. Both examples ≈ $0. Worth a look; the pricing page parse was messy, so verify.
- **VideoSDK.live**: HLS viewers $0.002/min + $0.04/min encoding.
- **Self-hosted media servers:** MediaMTX, OvenMediaEngine, Ant Media (WHIP in → LL-HLS/WebRTC out). Cheapest at the margin, but we would own recording, auth and scaling. LiveKit OSS is the better self-host since its API matches the Cloud.

## 4. Comparison

| Provider / mode | Show A (500 viewers, 1 h, rec.) | Month B (4 × 200) | Viewer latency | Browser host | Guests / stage | Recording → R2 | Lock-in |
|---|---|---|---|---|---|---|---|
| **LiveKit Cloud + HLS-to-R2** | **≈ $0** (Build) | **$50** (Ship) | 6–10 s (HLS) | SDK, WHIP | Yes (native SFU) | **Direct (S3 endpoint)** | **Low (OSS)** |
| LiveKit Cloud, WebRTC viewers | $60.50 | $84.80 | < 1 s | SDK | Yes | Direct | Low |
| LiveKit self-hosted | VPS + bandwidth | VPS + bandwidth | < 1 s / HLS | SDK | Yes | Direct | None |
| **CF Stream WHIP/WHEP** | **$30** | **$48** | < 0.5 s | WHIP (no SDK) | 1 per input (tile) | Host-side MediaRecorder | Low (open standards) |
| CF Stream Live RTMPS | $30 + $0.30 | $48 + $1.20 | ~10–30 s (LL-HLS beta) | No (OBS) | No | Copy MP4 | Low |
| CF RealtimeKit | $1.32 – $61.32 (billing unclear) | $5.28 – $101.28 | LHLS / WebRTC | SDK | Yes (stage) | Native R2 | Medium |
| CF Realtime SFU (DIY) | $0 (≤ 1 TB free) | $0 | < 1 s | Build it | Build it | Build it | Low |
| 100ms (HLS viewers) | $24 net / $39 list | $46 net / $71 list | ~5–10 s | SDK | Yes (roles) | Copy (no R2 endpoint) | High |
| Amazon IVS (LL channel or RT stage) | $36–38 | $58 | 2–5 s / < 0.3 s | SDK | Yes (stage, 12) | Copy from S3 | High |
| Daily (HLS to own S3) | ≈ $31 | ≈ $53 | ~10 s | SDK | Yes | Copy from S3 | Medium |
| Agora | $40 net / $60 list | $78 / $98 | ~0.4 s | SDK | Yes | Probably direct (verify) | High |
| Vonage | $55 | $109 | HLS / < 1 s | SDK | Yes | Copy | High |
| Mux | $2 net / $32 list | $8 net | 12–30 s | **No** (needs bridge) | No | Copy MP4 | Medium |
| api.video | $51 | $82 | ~3–10 s | **No** | No | Copy | Medium |
| Twilio | n/a (50 cap) | n/a | < 1 s | SDK | Yes | – | High |
| Dolby OptiView | quote | quote | < 0.5 s | WHIP | Yes | Their storage | High |

## 5. Recommendation

**Primary: LiveKit**, with two viewer modes chosen per show (or automatically by expected audience):

1. **`webrtc`**: viewers join the room as hidden subscribers. Sub-second, ideal for small/member shows. Cost is the participant-minute + bandwidth line.
2. **`hls`**: one room-composite **segmented egress straight into R2** (2 s segments). Viewers load `cdn.<site>/live/<postId>/live.m3u8` through Cloudflare. When the show ends, the same prefix holds the full playlist, so the post flips to a replay pointing at R2. **Recording and archive cost nothing extra and never leave Cloudflare.**

Reasons:

- It is the only option that covers browser host + guests + R2-native recording + cheap mass viewing with an OSS escape hatch (self-host on our box if Cloud pricing changes; same tokens, same SDK, same webhooks).
- The `MediaStream`-based client API maps cleanly onto our abstraction.
- Guests and "bring on stage" are just permission updates.
- OBS is covered by LiveKit Ingress (RTMP/WHIP).

**Fallback: Cloudflare Stream** (keeps everything on Cloudflare, no vendor SDK):

- Browser shows use WHIP/WHEP (< 0.5 s, $1 per 1,000 viewer-min from 2026-10-15) with host-side `MediaRecorder` recording into R2.
- OBS shows use Stream Live RTMPS with automatic recording + signed URLs, then copy the MP4 into R2.
- Its gaps (no WebRTC recording, one publisher per input) are why it is not primary.

**Keep an eye on RealtimeKit**: if Cloudflare confirms HLS viewers are billed by delivery (not as $0.002/min participants), it becomes a strong all-Cloudflare primary (stage + recording to R2 built in). The abstraction below makes adding it a single adapter.

**Not recommended:**

- 100ms (no R2, vendor-risk signals).
- IVS / Agora / Vonage (pricier, heavier lock-in, AWS/EventBridge plumbing for IVS).
- Mux / api.video (no browser ingest).
- Twilio (no broadcast).
- Dolby (enterprise pricing).

## 6. Access control (subscriber-only shows)

- **WebRTC viewers** (LiveKit / RealtimeKit / IVS stage): our API mints a short-lived viewer token only after `can(subject, 'posts.live:watch')` + the post's gating passes. The token never grants publish.
- **WHEP** (Cloudflare): the WHEP URL is the credential. Serve it only to permitted viewers via `viewerCredentials()`. Stream signed-URL tokens apply to the HLS/RTMPS path. Confirm WHEP honours `requireSignedURLs` before relying on it.
- **HLS in R2:** the bucket stays private. Serve `/live/*` through a small Cloudflare Worker (or Cloudflare Access-style signed cookie) that validates an HMAC token our API issues per viewer (exp ≤ show end + grace). Public shows can skip the Worker. This is the same mechanism the replay of a gated HLS video post should use.

## 7. Provider abstraction

Precedent: `services/shop/providers/` (registry over one contract, optional members where providers differ, `SECRET_MASK` + `mergeConfig` for secrets). Server lives in `packages/api/src/services/live/providers/`; shared types in `@sitesurge/types` (`types/liveProvider.ts`); client adapters in `packages/cms/src/services/live/`.

### 7.1 Shared types

```ts
export type LiveProviderKey = 'livekit' | 'cloudflare_stream' | 'cloudflare_realtimekit' | 'ivs' | 'hundredms';

export type LiveViewerMode = 'webrtc' | 'hls';
export type LiveRole = 'host' | 'guest' | 'viewer';

/** Descriptor → admin settings form is GENERATED from this (like configSchema for plugins). */
export interface LiveProviderDescriptor {
    key: LiveProviderKey;
    label: string;
    docsUrl: string;
    capabilities: {
        browserPublish: boolean;        // host can publish a MediaStream from the browser
        rtmpIngest: boolean;            // OBS/RTMP(S) or WHIP from an encoder
        guests: number;                 // max concurrent publishers besides host (0 = none)
        viewerModes: LiveViewerMode[];
        recording: 'none' | 'provider' | 'bucket' | 'client'; // client = host-side MediaRecorder
        recordToR2Direct: boolean;      // writes straight into an S3-compatible endpoint
        webhooks: boolean;
    };
    config: LiveConfigField[];
}

export interface LiveConfigField {
    key: string;
    label: string;
    type: 'string' | 'secret' | 'url' | 'select' | 'boolean' | 'number';
    required?: boolean;
    options?: { value: string; label: string }[];
    default?: string | number | boolean;
    help?: string;
    envVar?: string;   // env overrides stored value (same rule as media/backup settings)
}

export interface LiveRoomRef { providerRoomId: string; meta?: Record<string, unknown> }

export interface LiveHostCredentials {
    kind: 'livekit' | 'whip' | 'realtimekit' | 'ivs_stage' | 'hms' | 'rtmp';
    url: string;            // ws URL / WHIP endpoint / RTMPS server
    token?: string;         // JWT / auth token
    streamKey?: string;     // RTMP mode only (shown to admin once)
    expiresAt: string;
}

export type LiveViewerCredentials =
    | { mode: 'webrtc'; kind: 'livekit' | 'whep' | 'realtimekit' | 'ivs_stage' | 'hms'; url: string; token?: string; expiresAt: string }
    | { mode: 'hls'; url: string; expiresAt: string };  // already signed / cookie-scoped

export type LiveEvent =
    | { type: 'room.started' | 'room.ended'; postId: string; at: string }
    | { type: 'publisher.connected' | 'publisher.disconnected'; postId: string; identity: string; at: string }
    | { type: 'recording.started'; postId: string; recordingId: string; at: string }
    | { type: 'recording.ready'; postId: string; recordingId: string; at: string; location: LiveRecordingLocation }
    | { type: 'recording.failed'; postId: string; recordingId: string; at: string; error: string };

export type LiveRecordingLocation =
    | { kind: 'r2'; key: string; format: 'hls' | 'mp4' }          // already in our bucket
    | { kind: 'url'; url: string; format: 'hls' | 'mp4' | 'webm'; expiresAt?: string }; // must be copied
```

### 7.2 Server contract

```ts
export interface LiveProvider<Cfg = Record<string, unknown>> {
    descriptor: LiveProviderDescriptor;

    /** Idempotent: same postId → same room. Called on 'start' and on page load while live. */
    ensureRoom(ctx: LiveCtx<Cfg>, input: { postId: string; viewerMode: LiveViewerMode; record: boolean }): Promise<LiveRoomRef>;
    hostCredentials(ctx: LiveCtx<Cfg>, room: LiveRoomRef, who: { userId: string; name: string; role: 'host' | 'guest' }): Promise<LiveHostCredentials>;
    /** Only called after OUR permission/gating check passed. */
    viewerCredentials(ctx: LiveCtx<Cfg>, room: LiveRoomRef, who: { viewerId: string; mode: LiveViewerMode }): Promise<LiveViewerCredentials>;
    /** Promote / demote (bring on stage). Optional: providers without guests omit it. */
    setPublisher?(ctx: LiveCtx<Cfg>, room: LiveRoomRef, identity: string, canPublish: boolean): Promise<void>;

    startRecording?(ctx: LiveCtx<Cfg>, room: LiveRoomRef, target: R2Target): Promise<{ recordingId: string }>;
    stopRecording?(ctx: LiveCtx<Cfg>, room: LiveRoomRef, recordingId: string): Promise<void>;
    /** Resolve where a finished recording lives; the archiver copies `url` kinds into R2. */
    fetchRecording?(ctx: LiveCtx<Cfg>, recordingId: string): Promise<LiveRecordingLocation>;

    endRoom(ctx: LiveCtx<Cfg>, room: LiveRoomRef): Promise<void>;

    /** Raw body + headers in, normalized events out. Throw on bad signature. */
    verifyWebhook?(ctx: LiveCtx<Cfg>, rawBody: Buffer, headers: Record<string, string>): Promise<void>;
    parseWebhook?(ctx: LiveCtx<Cfg>, rawBody: Buffer, headers: Record<string, string>): Promise<LiveEvent[]>;

    /** Settings → "Test connection" (create + delete a throwaway room). */
    test(ctx: LiveCtx<Cfg>): Promise<{ ok: boolean; message?: string }>;
}

export interface LiveCtx<Cfg> { config: Cfg; publicBaseUrl: string; log: Logger }
export interface R2Target { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; prefix: string /* live/<postId>/ */ }
```

Routes:

- `POST /posts/:id/live/host` (staff, `posts:write`): host credentials.
- `POST /posts/:id/live/viewer` (optional auth): permission + gating check, then viewer credentials.
- `POST /live/webhooks/:provider/:token`: raw body, CSRF-exempt, token compared in constant time, same as shop provider webhooks.

Normalized events update `LiveRoomState.providerConnected` and fan out over the existing `/ws/live` room. A `recording.ready` event of kind `url` enqueues a copy job into R2 and then the existing HLS transcode for replay.

### 7.3 Client contract (framework-agnostic, lazy-loaded per provider)

```ts
export interface LivePublisher {
    publish(stream: MediaStream, opts?: { simulcast?: boolean; maxBitrate?: number }): Promise<void>;
    setMuted(kind: 'audio' | 'video', muted: boolean): Promise<void>;
    replaceTrack?(track: MediaStreamTrack): Promise<void>;   // camera switch / screen share
    stop(): Promise<void>;
    on(ev: 'state', cb: (s: 'connecting' | 'live' | 'reconnecting' | 'stopped' | 'error', err?: Error) => void): () => void;
}

export interface LivePlayer {
    /** WebRTC → sets videoEl.srcObject; HLS → hls.js / native, returns the URL used. */
    attach(videoEl: HTMLVideoElement): Promise<{ mode: LiveViewerMode; url?: string }>;
    /** Remote guest tiles for webrtc mode (host + guests); HLS mode gets a composite. */
    onTracks?(cb: (tiles: { identity: string; stream: MediaStream }[]) => void): () => void;
    detach(): void;
    on(ev: 'state', cb: (s: 'loading' | 'playing' | 'stalled' | 'ended' | 'error') => void): () => void;
}

export interface LiveClientAdapter {
    key: LiveProviderKey;
    createPublisher(creds: LiveHostCredentials): Promise<LivePublisher>;
    createPlayer(creds: LiveViewerCredentials): Promise<LivePlayer>;
}
// registry: { livekit: () => import('./livekit'), cloudflare_stream: () => import('./whipWhep'), … }
// HLS players share ONE hls.js adapter regardless of provider.
```

`cloudflare_stream` implements `LivePublisher` with a ~100-line WHIP client (`RTCPeerConnection` + one `fetch` POST of the SDP offer). It also starts a `MediaRecorder` → `/live/:id/recording/chunk` when `recording === 'client'`.

### 7.4 Per-provider config fields (drives the generated settings form)

| Provider | Fields (secret = masked, env-overridable) |
|---|---|
| `livekit` | `url` (wss://…livekit.cloud or self-host), `apiKey`, `apiSecret` (secret), `egressLayout` (select: speaker/grid/single-speaker), `segmentSeconds` (number, default 2), `hlsPlaylistPrefix`. Uses Media Storage's R2 credentials for egress. |
| `cloudflare_stream` | `accountId`, `apiToken` (secret, Stream:Edit), `customerSubdomain` (customer-xxxx.cloudflarestream.com), `webhookSecret` (secret, returned by the webhook API), `signingKeyId` + `signingKeyJwk` (secret, for signed URLs), `recordingMode` (select: client/automatic) |
| `cloudflare_realtimekit` | `accountId`, `appId`, `apiToken` (secret), `hostPresetName`, `viewerPresetName`, `guestPresetName`, `recordingStorage` (select: r2/default) |
| `ivs` | `region` (select), `accessKeyId`, `secretAccessKey` (secret), `stageArn` or auto-create, `channelType` (Basic/Standard), `playbackKeyPairArn` + `playbackPrivateKey` (secret, ES384), `recordingConfigArn`, `s3Bucket` |
| `hundredms` | `accessKey`, `appSecret` (secret), `templateId`, `hostRole`, `guestRole`, `viewerRole` (hls-viewer), `webhookSecret` (secret) |

## 8. Next steps (if approved)

1. Shared types + `LiveProvider` registry + settings row (`live_providers`, masked secrets, env overrides) + webhook route + permission `posts.live:watch` (default: everyone for public shows, gating via the post's access).
2. `livekit` adapter (server + client) with both viewer modes; R2 segmented egress; replay flip on `recording.ready`.
3. Worker for signed `/live/*` HLS access.
4. `cloudflare_stream` adapter (WHIP/WHEP + client recording; RTMPS mode).
5. Re-check RealtimeKit viewer billing; add adapter if favourable.

## Sources (all seen 2026-10-09)
- Cloudflare Stream pricing: https://developers.cloudflare.com/stream/pricing/
- Cloudflare Stream WebRTC (WHIP/WHEP): https://developers.cloudflare.com/stream/webrtc-beta/
- Cloudflare Stream Live: https://developers.cloudflare.com/stream/stream-live/start-stream-live/
- Cloudflare Realtime SFU pricing: https://developers.cloudflare.com/realtime/sfu/pricing/
- Cloudflare Realtime WebSocket adapter: https://developers.cloudflare.com/realtime/sfu/features/media-transport-adapters/websocket-adapter/
- RealtimeKit overview / pricing / recording / webinar: https://developers.cloudflare.com/realtime/realtimekit/ · https://developers.cloudflare.com/realtime/realtimekit/pricing/ · https://developers.cloudflare.com/realtime/realtimekit/recording-guide/ · https://developers.cloudflare.com/realtime/realtimekit/webinar/
- LiveKit pricing: https://livekit.com/pricing · Egress outputs (R2): https://docs.livekit.io/transport/media/ingress-egress/egress/outputs/ · Egress examples: https://docs.livekit.io/reference/other/egress/examples/
- 100ms pricing: https://www.100ms.live/pricing · storage config: https://www.100ms.live/docs/get-started/v2/get-started/features/recordings/recording-assets/storage-configuration · company profile: https://tracxn.com/d/companies/100ms/__tJNwyoIFG_yvI_q--pfyTNs_QXEfxJVFJGZ5STE8tQo
- Amazon IVS pricing: https://aws.amazon.com/ivs/pricing/ · quotas: https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/service-quotas.html · 25k viewers: https://aws.amazon.com/about-aws/whats-new/2024/06/amazon-ivs-real-time-streaming-25000-viewers
- Daily pricing: https://www.daily.co/pricing/video-sdk/ · HLS to S3: https://docs.daily.co/docs/guides/features/live-streaming/hls
- Agora pricing: https://www.agora.io/en/pricing/ · https://docs.agora.io/en/interactive-live-streaming/overview/pricing · recording: https://docs.agora.io/en/cloud-recording/overview/pricing
- Mux pricing: https://www.mux.com/pricing/video · WebRTC FAQ: https://www.mux.com/docs/guides/live-streaming-faqs
- Vonage pricing: https://www.vonage.com/communications-apis/video/pricing/ (HLS viewer rate via https://www.vonage.com.ph/communications-apis/video/pricing/)
- Twilio Video status: https://www.twilio.com/en-us/changelog/-twilio-video-will-remain-a-standalone-product
- Dolby OptiView plans: https://optiview.dolby.com/plans/ · https://optiview.dolby.com/docs/millicast/
- api.video pricing: https://api.video/pricing/
- GetStream pricing: https://getstream.io/video/pricing/ · VideoSDK HLS pricing: https://docs.videosdk.live/help_docs/pricing-ils-hls
