# Self-hosted adaptive video for paying subscribers — audit + implementation plan

Date: 2026-10-08. Status: design only, no code changed.

Related: `docs/plans/2026-10-07-youtube-gated-content-research.md` (why we host the originals ourselves and do not paywall YouTube), `docs/plans/2026-10-06-horizontal-scaling.md` (job leases, `INSTANCE_ROLE`).

**Goal.** Surge Media uploads its own videos (formerly YouTube members-only) into the media library. The server encodes them to adaptive HLS, one rendition at a time, without slowing the website. Playback is from Cloudflare R2 + the Cloudflare CDN. Paid videos play only for users whose role/subscription tier grants a permission. Node never carries video bytes, in either direction.

**Environment.** One VPS: 2 vCPU, ~6 GB RAM, 118 GB disk, Fedora, Node 22, `CLUSTER_WORKERS` (primary supervises + runs crons, workers serve HTTP). Postgres + Valkey. Media on R2 bucket `surge-media`. Note: the public CDN host in live data is now **`cdn.surgemedia.us`** (e.g. `featuredImage: https://cdn.surgemedia.us/uploads/fG7b5lkWYnKa.jpg` from `GET /api/v1/posts`), not `cdn.ryanweiss.net`. Use whatever `S3_CDN_URL` says; this document writes `cdn.surgemedia.us`.

---

## Summary

**Main deficiencies today**

1. Every upload goes browser → Cloudflare → nginx → Node → disk → R2. Three hard ceilings apply before the app's 500 MB limit: nginx `client_max_body_size 50m`, the Cloudflare proxy's 100 MB request-body limit (Free/Pro), and the Cloudflare 100 s origin timeout. Effective maximum today: **50 MB**.
2. The S3 provider reads the whole file into a Buffer before `PutObject` (`services/storage/s3.ts:36`). No multipart, no streaming, no resume, no `Cache-Control`.
3. `media.size` is `INTEGER` (max 2 GiB) — a 20 GB file cannot be stored.
4. **Production CSP has no `media-src`**, so it falls back to `default-src 'self'` and blocks `<video src="https://cdn.surgemedia.us/…">` on every page (verified from the live response header). `connect-src` also blocks hls.js and browser→R2 uploads.
5. The R2 bucket has **no CORS** (verified: no `Access-Control-*` on GET with `Origin`; preflight returns 403) and objects carry **no `Cache-Control`** (verified).
6. No video processing at all: no ffmpeg, no probe (no duration/size), no poster, no HLS, no renditions. The public video block puts the URL in an `<iframe>`. The player hardcodes `video/mp4`.
7. No access control on media. Every object is public on the CDN.

**Recommended design**

- **Upload:** S3 multipart, browser → R2 directly with presigned part URLs. The server only creates, signs, lists and completes. The session is in Postgres, so an upload resumes after a reload or a network loss (`ListParts`).
- **Encode:** a durable `video_jobs` + `video_renditions` queue, claimed with `FOR UPDATE SKIP LOCKED` and a lease with a heartbeat. It runs on the primary only. One video and one rendition at a time. `nice -n 19 ionice -c3 ffmpeg -threads N` (default 1). Output is HLS (H.264/AAC, 6 s keyframe-aligned MPEG-TS segments). The ladder includes only rungs ≤ the source. Each rendition is uploaded when it finishes. The original is deleted at the end (optional keep).
- **Progressive playback:** the master playlist comes from a small, edge-cached API endpoint that lists only `ready` renditions. The video can play as soon as the first rendition is ready.
- **Paid access:** AES-128 HLS encryption with one key per video. Segments and playlists stay public and immutable on the CDN. The 16-byte key is served by `GET /api/v1/media/:id/hls-key`, which checks the permission `media.gated:view`. Optional defence-in-depth later: a Cloudflare Worker cookie gate on `cdn.surgemedia.us/video/g/*`.

---

# PART 1 — Audit of the current media system

Line numbers are from `main` at `dc10d205`.

## 1.1 Upload path

| # | Item | Where | What happens today | Effect on video |
|---|---|---|---|---|
| A1 | Routes | `packages/api/src/routes/media.ts:90-120` | `POST /media`, `/media/block-upload`, `/media/bulk` (≤10 files). All are `auth: 'staff'`. | Single-request multipart/form-data only. No chunking, no resume, no progress events. |
| A2 | Multer storage | `routes/media.ts:30-49` | `multer.diskStorage` (good: not memory storage). Limit = `config.upload.maxSizeMb` (`:48`). | The file is staged fully on disk before any handler code runs. |
| A3 | Size limit | `config/schema.ts:99` `UPLOAD_MAX_SIZE_MB` default `500`; `config/loader.ts:260` | 500 MB in the app. | Never reached: see A6/A7. |
| A4 | Staging directory | `services/media.ts:31-33` | Local provider → the uploads dir. Remote provider → `os.tmpdir()/rw-uploads`. | On Fedora, `/tmp` is a **tmpfs** (RAM-backed, default 50% of RAM) unless changed. A large upload lands in RAM on a 6 GB box. Verify with `findmnt /tmp` on the server. |
| A5 | Allowed types | `config/schema.ts:108-110` `ALLOWED_FILE_TYPES` (includes `video/mp4`, `video/webm`, `video/quicktime`) | Parsed to `config.upload.allowedTypes` (`config/loader.ts:263`), but **nothing reads it**: the multer config has no `fileFilter`. | Any MIME type is accepted. Low risk (staff only), but the setting is false documentation. |
| A6 | nginx | `deploy/nginx-surge.conf:54` and `:166` `client_max_body_size 50m` | Both server blocks (`:80` and `:443`). | **Effective upload limit = 50 MB.** nginx also buffers the full request body to its own temp file before proxying (default `proxy_request_buffering on`), so a large file is written to disk twice. |
| A7 | Cloudflare proxy | `surgemedia.us` responses carry `server: cloudflare` | The Cloudflare proxy limits a request body to 100 MB (Free/Pro) and waits at most 100 s for the origin (HTTP 524). | Even with nginx raised, any upload > 100 MB fails at the edge. A long R2 push inside the request (A9) can exceed 100 s. |
| A8 | Timeouts | `deploy/nginx-surge.conf:147-157` (no timeout directives → defaults `client_body_timeout 60s`, `proxy_read_timeout 60s`); Node 22 `server.requestTimeout` default 300 s (not overridden in `lib.ts`) | The handler pushes to R2 and then responds. | Big uploads on slow links are cut. |
| A9 | Push to R2 | `services/storage/s3.ts:35-46` | `fs.readFile(localPath)` (`:36`) → `PutObjectCommand({ Body: fileBuffer })` (`:39-45`). | The **whole file is read into the heap** of a serving worker. A 500 MB video = 500 MB of RSS in a process that serves the website. Single PUT: S3 caps a single PUT at 5 GB; no retry of a failed part; no parallelism. |
| A10 | Object metadata | `s3.ts:39-45` | Only `ContentType` is set. No `CacheControl`, no `ContentDisposition`. | R2 objects have no `Cache-Control` (verified: `curl -I https://cdn.surgemedia.us/uploads/fG7b5lkWYnKa.jpg` → no Cache-Control, `cf-cache-status: REVALIDATED`). The edge and browsers use Cloudflare defaults and revalidate. File names are unique (`nanoid`, `routes/media.ts:39-43`), so `immutable` would be safe. |
| A11 | Provider choice | `services/storage/index.ts:11-34` | The provider is built from env config only (`config.upload.storageProvider`, `config.aws.*`) and memoised. | The `media_storage` keyed setting (`services/settings.ts:434-439`, `:675-691`) is readable/writable in the admin but **`getStorageProvider()` does not read it**. A storage change in Settings → Media does not change where files go. Separate bug; noted because new video code must use one source of truth. |
| A12 | Thumbnails | `services/media.ts:35-40`, `:50-52`, `:88-97` | `sharp` → 300 px JPEG for images only (not GIF/SVG). | Videos get **no thumbnail and no poster**. |
| A13 | Bulk upload | `services/media.ts:163-170` | Up to 10 files processed in series inside one request. | Ten videos in one request multiply A7/A8. |
| A14 | Client | `packages/cms-client/src/modules/media.ts:25-33`; transport is `fetch` (`cms-client/src/core/config.ts:7`) | `FormData` POST. | `fetch` has no upload progress events. The admin cannot show a progress bar. |
| A15 | Delete | `services/media.ts:307-331` | Deletes `uploads/<filename>` and `uploads/thumb_<filename>`. | A video with hundreds of segment objects needs a **prefix delete**. |

## 1.2 Schema

`packages/api/src/db/schema.sql:254-266` + `migrations/003_add_media_title.sql` (`title`) + `migrations/116_media_credits.sql` (`credits`):

```
id, filename, original_name, mime_type, size INTEGER, url, thumbnail_url,
alt, caption, uploaded_by, created_at, title, credits
```

Deficiencies:

- `size INTEGER` → maximum 2,147,483,647 bytes (2 GiB). Must be `BIGINT`.
- No `width`, `height`, `duration`, `status` (processing/ready/failed), `poster_url`, access level, or playback path.
- No `updated_at` column, but `services/media.ts:233-234` sorts on `COALESCE(updated_at, created_at)` for `sort=updated_asc|updated_desc`. Unless a column exists that the migrations do not show, that sort returns an SQL error. Check with `\d media` before the video migration and add the column in the same migration.
- `services/media.ts:241` and `:251` use `SELECT * FROM media`. Any secret column added to `media` (for example an encryption key) would leak through the admin list and the SDK. Keep keys in a separate table.

## 1.3 Serving and URLs

| # | Item | Where | Finding |
|---|---|---|---|
| S1 | URL form | `s3.ts:87-92` (`getUrl`) | Absolute `${S3_CDN_URL}/uploads/<file>` stored in `media.url` and copied into content (`CLAUDE.md` "Media storage config"). Video playback must not depend on one stored URL, because renditions appear over time. Store a path prefix and build URLs at read time. |
| S2 | Range requests | live check | The CDN answers `Range: bytes=0-99` with `206` + `content-range` and `cf-cache-status: HIT`. Progressive MP4 seeking works at the edge. |
| S3 | CORS | live check | `GET` with `Origin: https://surgemedia.us` returns no `Access-Control-Allow-Origin`. `OPTIONS` preflight → **403**. A plain `<video src>` does not need CORS, but **hls.js (XHR/fetch) does**, and so does a browser→R2 multipart upload (the S3 endpoint uses the same bucket CORS policy). |
| S4 | Cache headers | live check | No `Cache-Control` on objects (A10). |
| S5 | Cacheable extensions | Cloudflare defaults | Cloudflare caches by file extension by default. `.mp4` is on the default list; **`.m3u8` and `.ts` are not**. Without a Cache Rule, every HLS playlist and segment request goes to R2 (a Class B operation each) and adds latency. |
| S6 | Local provider | `app.ts:188` `express.static('/uploads')` | Supports Range, but bytes flow through Node. Not used on Surge (S3), but other SiteSurge installs use it. |
| S7 | Access control | `services/storage/types.ts:16-34` | Only `upload/delete/getUrl`. Everything is public; no signed URLs, no private prefix. `middleware/content-access.ts:4` gates pages/posts only (`public | member | patron`), not media. |
| S8 | CSP | `middleware/csp.ts:58-75`, enabled in production only (`app.ts:84`) | Directives: `default-src 'self'`, `img-src … https:`, `connect-src 'self' https://api.stripe.com …`. **No `media-src`, no `worker-src`.** Live header confirmed. Effects: (a) `<video src="https://cdn.surgemedia.us/…">` is blocked on the production site today, including hero-carousel video backgrounds (`HeroCarousel.tsx:422-430`) and admin previews; (b) hls.js segment fetches would be blocked by `connect-src`; (c) MSE playback needs `media-src blob:`; (d) hls.js' Web Worker needs `worker-src blob:` (or `enableWorker: false`). Confirm (a) in a browser console on a page with a CDN video. |

## 1.4 Video handling in the UI

| # | Where | Finding |
|---|---|---|
| V1 | `packages/cms/src/components/blocks/types/VideoBlock.tsx:10-23` (public) | Renders `block.content` in an **`<iframe>`**. Correct for YouTube/Vimeo embed URLs. For an uploaded file it gives the browser's bare default player: no poster, no Plyr controls, no quality choice. |
| V2 | `packages/cms/src/components/admin/blocks/types/VideoBlock.tsx:18-48` (admin) | Uploads with `cms.media.blockUpload(file)` (50 MB ceiling), stores `data.url` and optional `data.mediaId`; previews with Plyr. The admin preview and the public render use different components and different fields. Verify that `data.url` reaches `block.content` for the public path. |
| V3 | `packages/cms/src/components/blocks/media/VideoPlayer.tsx:56-65` | Plyr on a `<video>`. On a `src` change it sets `sources: [{ src, type: 'video/mp4' }]` — **hardcoded MP4**, wrong for WebM/QuickTime. No HLS support (Plyr plays HLS only where the browser does natively, i.e. Safari). `preload="metadata"` (`:73`) is good. No quality menu, no preview thumbnails. |
| V4 | `pages/admin/Media.tsx:240` | The media grid renders `<video src preload="metadata">` per tile. Each tile makes range requests against the original file. A poster `<img>` would be cheaper. |
| V5 | `MediaEditModal.tsx:158`, `MediaUploadModal.tsx:108`, `MediaSelectModal.tsx:179`, `TemplateEntity.tsx:107`, `ShopProduct.tsx:329`, `SocialComposePanel.tsx:104` | Raw `<video src>` everywhere. All will need the playback source of a processed video, not `media.url` (which for an HLS video is no longer a playable file). |
| V6 | ffmpeg | `grep -r ffmpeg packages/` → nothing | No ffmpeg/ffprobe use, detection or docs. The closest pattern is `pg_dump` detection in `services/backup.ts:377-388` (`toolingStatus`) and the bounded `spawn` helper `services/backup.ts:72-110`. |

## 1.5 Background-work patterns that a video queue can reuse

- Atomic claim: `repositories/mailSendRecipients.repo.ts:87-100` (`claimBatch`, `FOR UPDATE SKIP LOCKED`), `services/mailSchedules.ts:321-340`.
- Once-only gating: `lib.ts:66-75`, `:195-202` (`runOnceOnlyWork` → only the cluster primary runs crons and the mail resumer); `lib.ts:235` (`role !== 'worker'`).
- The scaling plan (`2026-10-06-horizontal-scaling.md` §6.2, §6.4) defines `lease_owner` / `lease_until` / heartbeat. The video queue should use the same column names so it moves to `INSTANCE_ROLE=worker` without change.
- Live updates: the Admin Channel WS (`services/adminChannel/server.ts:83-112`) broadcasts **presence only**, and it lives in the **serving workers**. The primary (where encoding runs) holds no sockets. A push of encode progress would need a Redis pub/sub hop. Polling is simpler for v1.

## 1.6 Server capacity for encoding

- 2 vCPU. x264 `veryfast` on **one thread** encodes approximately: 1080p ≈ 0.7–1.2× real time, 720p ≈ 2–3×, 480p ≈ 5×, 360p ≈ 8× (estimates; measure in Phase 2 with a benchmark script). A full 4-rung ladder ≈ **2–2.5 × the video duration** on one thread, ≈ 1.2–1.5× on two threads. A 1-hour video ≈ 2–2.5 hours of one core.
- RAM: x264 at 1080p uses ~200–400 MB per encoder. OK with 6 GB.
- Disk: 118 GB. Peak need per job = original (≤ 20 GB) + one rendition's output (1080p at 5 Mb/s ≈ 2.3 GB/hour). Budget check needed.
- One thread at `nice 19` leaves one full core for nginx + Node workers + Postgres. A web request still wins the CPU when it needs it.

## 1.7 Deficiencies and efficiency improvements for serving video at scale

1. **Never proxy bytes through Node or nginx** — not for uploads (direct to R2), not for playback (CDN → R2). Today uploads cross Cloudflare, nginx, Node, the heap, and then go out again.
2. **Use HLS, not progressive MP4**, for long videos: adaptive bitrate for mobile, small cacheable objects, fast start, no `moov`-at-end problem (phone/editor exports often put `moov` at the end, which costs an extra range round-trip and a stall before playback).
3. **`Cache-Control: public, max-age=31536000, immutable`** on segments, rendition playlists, posters and sprites (their paths contain a unique encode id). Short TTL only on the master playlist.
4. **Cloudflare Cache Rule** for `cdn.surgemedia.us/video/*` → "Eligible for cache" (S5), so `.m3u8`/`.ts` are cached at the edge. Enable **Tiered Cache** so a cold colo fills from an upper tier, not from R2. This reduces R2 Class B reads and protects against a "thundering herd" when a popular video is released (many viewers request the same first segments at the same moment).
5. **R2 egress is free**; the costs are storage ($0.015/GB-month) and operations. A 4-rung ladder ≈ 10 Mb/s total ≈ **4.6 GB per hour of video** → 100 hours ≈ 460 GB ≈ $7/month. Cache hits do not cost R2 operations.
6. **Range requests** already work at the edge (S2); keep them for any MP4 fallback.
7. **CORS** on the bucket for hls.js and uploads (S3).
8. **CSP**: add `media-src 'self' blob: <cdn>`; `connect-src <cdn> <r2-s3-endpoint>`; `worker-src 'self' blob:` (S8).
9. **Lazy work in the page**: poster `<img>` first; attach hls.js and fetch the master only on play (or when the player scrolls into view). `<link rel="preconnect" href="https://cdn.surgemedia.us" crossorigin>`.
10. **Content policy**: Cloudflare's terms allow video served from R2 through the CDN (the 2023 Service-Specific Terms change). Serving video from a non-Cloudflare origin through the free CDN is not allowed — keep video in R2.
11. **Do not keep `<video src>` grid previews** of originals in the admin (V4); use posters.
12. **Fix the staging directory** (A4) so large files never land in tmpfs.

---

# PART 2 — Implementation plan

## 2.1 Upload: resumable, direct to R2

### Flow

```
Browser (admin)                    API (any worker)                 R2 (S3 API endpoint)
  pick file ───────────────────▶  POST /media/uploads
                                    validate size/type/permission
                                    find resumable session (same user + fingerprint)
                                    else CreateMultipartUpload(key=incoming/<sid>/<name>)
                                    INSERT media_upload_sessions
  ◀───────── { sessionId, partSize, partCount, uploadedParts[] }
  POST /media/uploads/:id/part-urls {partNumbers:[1..20]}
                                    presign UploadPart × 20 (1 h expiry, local HMAC, no R2 call)
  ◀───────── { urls }
  PUT part 1..n (3 in parallel, XHR for progress) ─────────────────────────────▶  (bytes)
  ◀──────────────────────────────────────────────────────────────── ETag per part
  POST /media/uploads/:id/complete
                                    ListParts (authoritative; ignore client ETags)
                                    CompleteMultipartUpload
                                    HeadObject → verify size
                                    INSERT media (status='processing') + video job
  ◀───────── Media (status processing)
```

- **Key choice:** `incoming/<sessionId>/<sanitised-name>`. Never under `uploads/` or `video/`, so a lifecycle rule can clean it.
- **Part size:** R2 requires every part except the last to be the **same size**, 5 MiB–5 GiB, ≤ 10,000 parts. Use 64 MiB (setting `partSizeMb`); 20 GB → 320 parts. For files < 64 MiB use one part. The server chooses the part size and stores it, so a resumed session uses the same value.
- **Resume after reload / network loss:** the browser cannot reopen a `File` after a reload. The uploader stores `{ sessionId, fingerprint }` in `localStorage` (`sitesurge.uploads`), where fingerprint = `name + size + lastModified` (+ SHA-256 of the first and last 1 MiB, to reject a different file with the same name). After a reload the upload tray lists "Unfinished: interview.mp4 — 43 % — choose the file again to resume". When the user picks it, `POST /media/uploads` finds the open session by user + fingerprint and returns the parts already in R2 (`ListParts`, paginated by 1000). Only missing parts are sent. On Chromium, a `FileSystemFileHandle` kept in IndexedDB can skip the re-pick (optional nicety).
- **Network loss:** each part retries with exponential backoff (1 s → 30 s, ≤ 8 tries). A 403 on PUT means the presigned URL expired → request fresh URLs. `navigator.onLine` events pause and resume the queue.
- **Integrity:** optional `Content-MD5` per part is skipped (cost on big files in the browser). `CompleteMultipartUpload` + `HeadObject` size check is the integrity gate; ffprobe in the job is the second gate.
- **Max size:** setting `video.maxUploadGb` (default 20). Checked on session create (declared size) and on complete (`HeadObject.ContentLength`).
- **Abandoned uploads:** a daily cron (primary) aborts sessions older than `expires_at` (7 days) with `AbortMultipartUpload` and marks them `expired`. Backstop: an R2 lifecycle rule "abort incomplete multipart uploads after 7 days" and "delete objects under `incoming/` after 14 days" (§2.9 ops).
- **Non-video files** can use the same path (any file > 50 MB). This removes the 50 MB limit for PDFs/ZIPs too. The existing `POST /media` stays for small files.
- **Local storage provider:** multipart presigning needs an S3-compatible store. v1: the video feature requires `STORAGE_PROVIDER=s3` and says so in the admin. A later phase can add a chunked `PUT /media/uploads/:id/parts/:n` fallback that appends to a local file (bytes through Node, acceptable for small installs).

### Why not tus

tus is a good open protocol with mature clients (tus-js-client, Uppy). But a tus server **receives the bytes**: browser → Cloudflare → nginx → tusd/Node → local disk → R2. That puts every byte through the VPS twice (in and out), needs disk for the whole file, is limited by the 100 MB Cloudflare body limit per request (fine with chunks, but still proxied), and spends the VPS bandwidth and CPU we want for the website. S3 multipart with presigned parts gives the same resume behaviour (`ListParts` is the resume state) with **zero bytes through our server**, and R2 is already the destination. Uppy's `@uppy/aws-s3` plugin implements exactly this protocol and could replace our own uploader; it is not chosen because its UI is Preact-based and heavy for the SolidJS admin, and the core uploader is ~300 lines. Revisit if edge cases pile up.

## 2.2 Encoding

### ffmpeg on the server (Fedora)

Fedora's own `ffmpeg-free` package has **no libx264** (H.264 is in RPM Fusion). Install the full build:

```bash
sudo dnf install -y https://mirrors.rpmfusion.org/free/fedora/rpmfusion-free-release-$(rpm -E %fedora).noarch.rpm
sudo dnf swap -y ffmpeg-free ffmpeg --allowerasing
ffmpeg -hide_banner -encoders | grep -E 'libx264|aac'   # both must appear
ffprobe -version
```

**Detection at boot** (pattern of `services/backup.ts:377-388`): `services/video/tooling.ts` `videoToolingStatus()` runs `ffmpeg -hide_banner -encoders` and `ffprobe -version` with a 15 s timeout, checks for `libx264`, caches the result, logs one warning when missing, and exposes `GET /media/video/status` for the admin ("ffmpeg not installed — uploads will wait in the queue"). Env `FFMPEG_PATH` / `FFPROBE_PATH` override the binary names. Without ffmpeg, uploads still complete; jobs stay `queued` with `blocked_reason='ffmpeg_missing'`.

### Steps per job

1. **Download** the original from R2 `incoming/…` to `VIDEO_TEMP_DIR/<jobId>/source.<ext>` with a streamed `GetObject` → `pipeline` to file (no Buffer). Default `VIDEO_TEMP_DIR=/var/tmp/sitesurge-video` (on disk, **not** `/tmp` tmpfs). Resume a partial download with a `Range` request from the current file size. Before the download: **disk budget check** with `fs.statfs`: free ≥ source size + estimated largest rendition (`maxrate × duration`, or 3 GB/hour if unknown) + `minFreeDiskGb` (default 5). If not, `blocked_reason='disk'`, retry in 10 min.
   - Fallback if disk is short: give ffmpeg a presigned GET URL as input (`-reconnect 1 -reconnect_streamed 1 -reconnect_on_network_error 1`). Slower and fragile on multi-hour encodes; use only when needed.
2. **Probe**: `ffprobe -v error -print_format json -show_format -show_streams source`. Store duration, width, height, fps, video/audio codecs, bitrate, rotation (`side_data_list[].rotation` / display matrix — phone video is often rotated; ffmpeg auto-rotates, so swap width/height for the ladder). Reject (status `failed`, readable error) when there is no video stream.
3. **Poster + thumbnails** (cheap, before renditions so the library shows a picture at once):
   - `ffmpeg -ss <10 % of duration> -i source -frames:v 1 -vf scale=1280:-2 poster.jpg` → sharp → `poster.webp` + the existing 300 px `thumb_` (reuses `createThumbnail`, `services/media.ts:35-40`) → `media.thumbnail_url`.
   - Preview sprite for the scrub bar: `-vf fps=1/10,scale=160:-2,tile=10x10` → `sprite_N.jpg` + a WebVTT file (`thumbnails.vtt`) with `#xywh=` cues. Plyr reads it via `previewThumbnails.src`.
4. **Ladder**: from setting `video.ladder` (default below), keep only rungs whose height ≤ source height (always keep at least the lowest rung; if the source is below 360p, encode one rung at source height).

   | Rung | Size | Video maxrate / bufsize | Audio |
   |---|---|---|---|
   | 1080p | 1920×1080 | 5000k / 10000k | AAC 128k stereo 48 kHz |
   | 720p | 1280×720 | 2800k / 5600k | AAC 128k |
   | 480p | 854×480 | 1200k / 2400k | AAC 96k |
   | 360p | 640×360 | 700k / 1400k | AAC 96k |
   | audio (optional, off) | — | — | AAC 64k |

5. **Encode one rendition per ffmpeg run**, in this default order: **480p first** (fast → playable within minutes), then the highest rung downwards. Setting `encodeOrder: 'fast-first' | 'top-down'`.

   ```bash
   nice -n 19 ionice -c3 ffmpeg -hide_banner -nostdin -y \
     -i source.mp4 -threads $VIDEO_ENCODE_THREADS -filter_threads 1 \
     -map 0:v:0 -map 0:a:0? \
     -vf "scale=-2:720:flags=bicubic,format=yuv420p" \
     -c:v libx264 -preset veryfast -profile:v high -level 4.1 \
     -crf 21 -maxrate 2800k -bufsize 5600k \
     -force_key_frames "expr:gte(t,n_forced*6)" -sc_threshold 0 \
     -c:a aac -b:a 128k -ac 2 -ar 48000 \
     -f hls -hls_time 6 -hls_playlist_type vod -hls_segment_type mpegts \
     -hls_flags independent_segments \
     -hls_segment_filename "720p/seg_%05d.ts" \
     [-hls_key_info_file key.info]          # gated videos only (§2.5)
     -progress pipe:1 -nostats \
     720p/index.m3u8
   ```

   - `-force_key_frames` by **time** (not `-g` by frame count) puts keyframes at the same timestamps in every rung, whatever the fps. That is what makes rung switching seamless.
   - **MPEG-TS** segments, not fMP4: AES-128 whole-segment encryption with TS is supported by every HLS player, including Safari's native player, and ffmpeg's `hls_key_info_file` path is long-proven with TS. fMP4 saves ~5–10 % size; not worth the compatibility risk for v1. Use TS for public videos too, so there is one code path.
   - Threads: `VIDEO_ENCODE_THREADS` env, else setting `video.encodeThreads`, default **1**, clamped to `1..os.availableParallelism()`.
   - `nice -n 19` + `ionice -c3` (idle I/O class): the encoder only gets CPU and disk that the website does not use. If that is not enough under load, the hard option is a systemd scope: `systemd-run --scope -p CPUQuota=100% …` (document, do not require).
   - **Single decode vs per-rendition decode:** one ffmpeg run with `split` into all rungs decodes the source once (≈ 10–15 % less CPU), but every rung finishes at the same moment, which defeats progressive playability and "one rendition at a time". We accept the extra decode.
6. **Progress**: parse `-progress pipe:1` lines; `out_time_us` (in recent ffmpeg `out_time_ms` is also microseconds) ÷ `duration_us` → %. Write to the rendition row at most every 5 s (with the lease heartbeat). `progress=end` = done.
7. **Upload the rendition** when ffmpeg exits 0: walk `720p/`, `PutObject` each file (streamed body, 4 in parallel) to `video/<mediaId>/<encodeId>/720p/…` with `Content-Type` (`application/vnd.apple.mpegurl`, `video/mp2t`) and `Cache-Control: public, max-age=31536000, immutable`. Idempotent: on resume, list the prefix and skip keys whose size matches. Upload the playlist **last**, then mark the rendition `ready` in the same DB transaction that bumps `media.hls_version` (used for the master's cache tag).
8. **After all rungs are `ready`**: delete the local temp directory. Delete `incoming/<sid>/…` from R2, **unless** `keepOriginal` (setting default `false`, per-upload checkbox) → move to `originals/<mediaId>.<ext>` (R2 `CopyObject` + delete; server-side, no bytes through us).
   - **Trade-off of deleting originals:** a later re-encode (new codec, better ladder, a new 1440p rung, a fixed bug) is impossible; the best remaining source is the 1080p rendition (a generation loss). Storage cost of keeping: ~$0.015/GB-month → a 10 GB original ≈ $0.15/month. Recommend **default keep = true for the first months** while the pipeline settles, then let the operator turn it off. The user asked for delete; the setting supports both.

### Failure and resume rules

- ffmpeg cannot resume a half-written rendition. A crash restarts **that rendition only**; `ready` rungs are skipped. Lost work ≤ one rung.
- Exit code ≠ 0 → rendition `failed` with the last 4 KB of stderr; job `attempts++`; retry with backoff (1 min, 10 min, 1 h), max 3; then job `failed` and the admin shows Retry.
- Graceful shutdown (deploy restart, `lib.ts:314` force-exit timer): kill ffmpeg (`SIGTERM`, then `SIGKILL` after 5 s), set the job back to `queued` and `lease_until = now()` so the next boot takes it at once. A hard crash → the lease expires (90 s) → the next poller takes it.

## 2.3 Jobs

### Tables (migration `123_video.sql`, `-- @feature video`)

```sql
-- media: generic additions (useful for every file)
ALTER TABLE media ALTER COLUMN size TYPE BIGINT;
ALTER TABLE media ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;           -- see §1.2
ALTER TABLE media ADD COLUMN IF NOT EXISTS width INTEGER;
ALTER TABLE media ADD COLUMN IF NOT EXISTS height INTEGER;
ALTER TABLE media ADD COLUMN IF NOT EXISTS duration_ms INTEGER;
ALTER TABLE media ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'ready'
    CHECK (status IN ('uploading','processing','ready','failed'));
ALTER TABLE media ADD COLUMN IF NOT EXISTS access_level VARCHAR(32) NOT NULL DEFAULT 'public';
    -- 'public' | 'member' | 'gated'  (gated = permission media.gated:view)

CREATE TABLE IF NOT EXISTS media_videos (
    media_id        UUID PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
    encode_id       VARCHAR(16) NOT NULL,          -- path segment; new id per re-encode
    storage_prefix  TEXT NOT NULL,                 -- video/<mediaId>/<encodeId>
    source_key      TEXT,                          -- incoming/... or originals/... ; NULL once deleted
    keep_original   BOOLEAN NOT NULL DEFAULT false,
    probe           JSONB,                         -- ffprobe summary
    poster_url      TEXT,
    thumbnails_vtt  TEXT,
    encrypted       BOOLEAN NOT NULL DEFAULT false,
    hls_version     INTEGER NOT NULL DEFAULT 0,    -- bumps when a rendition becomes ready
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Separate table so SELECT * FROM media / media_videos never returns key bytes.
CREATE TABLE IF NOT EXISTS media_video_keys (
    media_id   UUID PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
    key_bytes  BYTEA NOT NULL CHECK (octet_length(key_bytes) = 16),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS video_jobs (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    media_id         UUID NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    status           VARCHAR(16) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued','downloading','probing','encoding','uploading',
                          'finalizing','ready','failed','cancelled')),
    blocked_reason   VARCHAR(32),                  -- ffmpeg_missing | disk | NULL
    priority         INTEGER NOT NULL DEFAULT 100,
    attempts         INTEGER NOT NULL DEFAULT 0,
    max_attempts     INTEGER NOT NULL DEFAULT 3,
    next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lease_owner      TEXT,                         -- INSTANCE_ID:pid (scaling plan §6.2)
    lease_until      TIMESTAMPTZ,
    cancel_requested BOOLEAN NOT NULL DEFAULT false,
    progress         NUMERIC(5,2) NOT NULL DEFAULT 0,   -- weighted overall %
    error            TEXT,
    created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at       TIMESTAMPTZ,
    finished_at      TIMESTAMPTZ,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS video_jobs_one_active
    ON video_jobs(media_id) WHERE status NOT IN ('ready','failed','cancelled');
CREATE INDEX IF NOT EXISTS video_jobs_claim ON video_jobs(priority, created_at)
    WHERE status NOT IN ('ready','failed','cancelled');

CREATE TABLE IF NOT EXISTS video_renditions (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id      UUID NOT NULL REFERENCES video_jobs(id) ON DELETE CASCADE,
    media_id    UUID NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    name        VARCHAR(16) NOT NULL,              -- 1080p | 720p | ... | audio
    sort_order  INTEGER NOT NULL,                  -- encode order
    width INTEGER, height INTEGER,
    bandwidth   INTEGER,                           -- peak bps for #EXT-X-STREAM-INF
    avg_bandwidth INTEGER,
    codecs      VARCHAR(64),                       -- e.g. avc1.64001f,mp4a.40.2
    status      VARCHAR(16) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued','encoding','uploading','ready','failed','skipped')),
    progress    NUMERIC(5,2) NOT NULL DEFAULT 0,
    attempts    INTEGER NOT NULL DEFAULT 0,
    error       TEXT,
    playlist_path TEXT,                            -- <prefix>/720p/index.m3u8
    bytes       BIGINT,
    started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ,
    UNIQUE (job_id, name)
);

CREATE TABLE IF NOT EXISTS media_upload_sessions (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
    filename      VARCHAR(255) NOT NULL,
    mime_type     VARCHAR(100) NOT NULL,
    size          BIGINT NOT NULL,
    fingerprint   VARCHAR(128) NOT NULL,
    object_key    TEXT NOT NULL,
    upload_id     TEXT NOT NULL,                   -- S3 UploadId
    part_size     INTEGER NOT NULL,
    part_count    INTEGER NOT NULL,
    status        VARCHAR(16) NOT NULL DEFAULT 'uploading'
        CHECK (status IN ('uploading','completed','aborted','expired')),
    options       JSONB NOT NULL DEFAULT '{}',     -- keepOriginal, accessLevel, title …
    media_id      UUID REFERENCES media(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at    TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days'
);
CREATE INDEX IF NOT EXISTS media_upload_sessions_resume
    ON media_upload_sessions(user_id, fingerprint) WHERE status = 'uploading';
```

### Claim

```sql
UPDATE video_jobs SET
    status      = CASE WHEN status = 'queued' THEN 'downloading' ELSE status END,
    lease_owner = $1,
    lease_until = NOW() + INTERVAL '90 seconds',
    attempts    = attempts + 1,
    started_at  = COALESCE(started_at, NOW()),
    updated_at  = NOW()
WHERE id = (
    SELECT id FROM video_jobs
    WHERE status NOT IN ('ready','failed','cancelled')
      AND cancel_requested = false
      AND next_attempt_at <= NOW()
      AND (lease_until IS NULL OR lease_until < NOW())     -- queued or stale lease
    ORDER BY priority, created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1)
RETURNING *;
```

- A stale lease (crash) is re-taken by the same query. The worker then re-derives where to start from the **rendition rows** (`ready` → skip; `encoding`/`uploading` → redo that rung). The job status column is only for display.
- Heartbeat every 20 s: `UPDATE video_jobs SET lease_until = NOW() + '90 s', progress = $p WHERE id = $id AND lease_owner = $me`. **0 rows updated = lease lost** → kill ffmpeg and stop (another process owns it).
- **Where it runs:** `services/video/worker.ts` starts in `bootRunningMode` under `runOnceOnlyWork` (cluster primary), like the mail resumer (`lib.ts:195-202`). Env `VIDEO_ENCODER_ENABLED=false` disables it on a host (fleet: `INSTANCE_ROLE=web`). Because of the lease, two encoders can never take the same job, so a later fleet just turns it on for `worker` instances.
- **Concurrency:** one job per process, one rendition at a time (sequential loop). Global one-at-a-time follows from one encoder process. `VIDEO_ENCODE_CONCURRENCY` (default 1) is reserved for a future dedicated worker box.
- **Poll:** every 10 s while idle. An enqueue happens on a serving worker, so the primary does not hear it; 10 s latency is acceptable. (Optional: `pg_notify('video_jobs')` + `LISTEN` on a dedicated client.)
- **Cancel:** `POST /media/:id/video/cancel` sets `cancel_requested = true`. The worker checks on every progress tick (~1/s), kills ffmpeg, deletes temp files, sets `cancelled`. Ready renditions stay (the video stays playable at those rungs) unless the operator also deletes the media.
- **Retry:** `POST /media/:id/video/retry` → failed renditions back to `queued`, `attempts = 0`, job `queued`, `next_attempt_at = NOW()`, `error = NULL`. Only possible while the source still exists (`source_key` not NULL) — otherwise the button says "original deleted; re-upload to re-encode".
- **Overall progress:** weighted by pixel count so the 1080p rung counts for more: `Σ(progress_i × w_i) / Σ w_i`, `w = width × height` (audio rung `w` = 0.02 × the smallest video rung). Download and upload steps add fixed 5 % each.
- **Delete during encoding:** `media.remove` (extend `services/media.ts:307-331`) requests cancel, waits ≤ 10 s, then deletes `video/<mediaId>/` by prefix (`ListObjectsV2` + `DeleteObjects` in batches of 1000), `incoming/<sid>/`, `originals/<mediaId>.*`, and the DB rows (cascade).

## 2.4 Progressive playability — master playlist

**Rendition playlists and segments:** static objects in R2, written once per encode, immutable (§2.2 step 7).

**Master playlist:** served by the API, built from the DB.

```
GET /api/v1/media/:id/master.m3u8        (auth: public)
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-STREAM-INF:BANDWIDTH=5628000,AVERAGE-BANDWIDTH=4200000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"
https://cdn.surgemedia.us/video/<mediaId>/<encodeId>/1080p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1328000,...,RESOLUTION=854x480,...
https://cdn.surgemedia.us/video/<mediaId>/<encodeId>/480p/index.m3u8
```

- Lists only renditions with `status='ready'`, highest first. 404 with `code: 'VIDEO_NOT_READY'` when none are ready.
- Cache: built string in Redis under `CACHE_KEYS.videoMaster(id)` (cache-key contract: `services/cache.ts`), invalidated by `invalidateVideoCache(id)` when a rendition becomes ready or the media is deleted. HTTP: while the job is active `Cache-Control: public, max-age=10, s-maxage=10`; when complete `public, max-age=300, s-maxage=86400`, plus a Cloudflare purge of that one URL on a later change (re-encode / delete), using the existing `CLOUDFLARE_ZONE_ID` + `CLOUDFLARE_PURGE_TOKEN` purge helper (as `setSiteBranding` does). Add a Cloudflare Cache Rule for `surgemedia.us/api/v1/media/*/master.m3u8` → eligible for cache, respect origin headers.

**Why dynamic, not a static `master.m3u8` rewritten in R2:**

| | Static in R2 | Dynamic from API (chosen) |
|---|---|---|
| Node in byte path | none | one tiny text response per edge miss (≤ 1/10 s per colo while encoding, ~1/day after) |
| Consistency with DB | needs write + purge on every change; a crash between DB update and R2 write leaves them out of step | always equal to the DB |
| Works with the local provider | needs a second implementation | yes |
| Future per-user rewriting (token URLs, Worker gate) | no | yes |
| Cost | none | negligible |

The player always loads one stable URL; nothing in posts/pages has to change when renditions appear.

**Player behaviour while encoding:** hls.js loads the master, picks a rung (ABR or manual). A viewer who started before 1080p was ready keeps the rungs they saw; the next page load sees more. That is acceptable. (hls.js does not re-poll a VOD master.)

**Manual quality:** Plyr `quality` option fed from `hls.levels` heights plus "Auto" (`0` = auto convention); `onChange` sets `hls.currentLevel` (`-1` = auto). The setting `video.defaultQuality` (`auto` | `highest` | a height) sets `hls.startLevel`. On Safari/iOS native HLS (no MSE before iOS 17.1), the browser chooses; the menu is hidden.

## 2.5 Access control for paid videos

### Options

| Option | How | Security | Cost | Complexity | Verdict |
|---|---|---|---|---|---|
| **A. AES-128 HLS, per-video key, gated key endpoint** | Segments encrypted at encode time. Playlists name a key URI on our API. Key returned only to permitted users. Segments + playlists public, immutable, cached. | Stops casual link sharing and hot-linking: a segment without the key is noise. A paying user can extract the key and share key + URLs; a re-host is then possible. | $0. Key endpoint: one tiny request per playback start (hls.js reuses the key across rungs; one key per video). | Low: ffmpeg `-hls_key_info_file`, one endpoint. Works with Safari native + hls.js. | **Recommended v1.** |
| **B. Cloudflare Worker cookie gate** on `cdn.surgemedia.us/video/g/*` | On key/playback grant, the API sets an HMAC cookie (`Domain=.surgemedia.us`, `Secure`, `HttpOnly`, 1–4 h, scope = mediaId). A Worker on the CDN route checks the cookie, then serves from the R2 binding with Cache API. | Hides the ciphertext too; links stop working after expiry; can revoke per user. | Workers Paid $5/month for 10 M requests, then $0.30/M. 6 s segments = 600 requests per viewer-hour → ~16,000 viewer-hours/month included. | Medium: Worker code + deploy, CORS with credentials (`withCredentials` in hls.js, exact `Allow-Origin`). | **Optional Phase 6**, stacked on A. |
| C. Cloudflare WAF token rule (`is_timed_hmac_valid_v0`) | Query-string HMAC token checked by a WAF custom rule. | Similar to B, but the token must be in every segment URL → playlists must be rewritten per user. | Needs a plan that includes the function (check the zone's plan). | Medium-high. | Not chosen. |
| D. Private bucket + presigned per-segment URLs | API rewrites each rendition playlist per viewer with presigned R2 URLs. | Strong expiry. | Presigned S3-API URLs **bypass the CDN** (they only work on `*.r2.cloudflarestorage.com`) → every segment is an R2 Class B operation, no edge cache, slower start, playlists dynamic per user. | High. | Rejected: costs and latency grow with viewers. |

DRM (Widevine/FairPlay) is out of scope: it needs a licence server and packager contracts. Screen recording cannot be stopped by any of these.

### Design (A)

- **Key generation:** on job creation for a `gated` video, `crypto.randomBytes(16)` → `media_video_keys`. Write `key.info` for ffmpeg in the job's temp dir (mode 0600): line 1 = key URI, line 2 = local key file path, line 3 = IV (hex, random per video). Delete both after the encode. The key never goes to R2.
- **Key URI** baked into each rendition playlist: `https://surgemedia.us/api/v1/media/<id>/hls-key` (absolute, from `config.siteUrl`). Same origin as the page, so the session cookie is sent by both hls.js (XHR) and Safari's native player; no CORS needed. Risk: the site domain is baked into immutable playlists. If the domain changes, a script rewrites the `#EXT-X-KEY` line in each `index.m3u8` (small text files) and purges them.
- **Endpoint** `GET /api/v1/media/:id/hls-key` (auth `optional`; never cached; not API-key-satisfiable):
  1. Load `media.access_level`. `public` → 404 (public videos are not encrypted).
  2. `member` → any signed-in user. `gated` → `can(subject, 'media.gated:view')` via `services/permissions` (sysadmin → user grant → role grant → default). Subscription tiers already grant roles/permissions (migration 122), so "who can watch" is configured in Settings → Permissions / Subscriptions, not in the video code.
  3. Denied → 403 with `code: 'CONTENT_LOCKED'` and `ContentLockedDetails` (same shape as posts) so the player can show the subscribe call to action.
  4. Allowed → 16 raw bytes, `Content-Type: application/octet-stream`, `Cache-Control: private, no-store`.
  5. Rate limit (Redis store, `middleware/rateLimitStore.ts`): 120/hour/user. Record `video_key_grants(user_id, media_id, ip, day)` (upsert, one row per user/video/IP/day) for an admin "possible account sharing" view (users with > N distinct IPs per day). Not audit-logged per request (volume).
- **Which videos are encrypted:** `access_level <> 'public'` at encode time. **Changing access level after encoding:** public → gated requires a re-encode (segments are plaintext and may already be cached/copied). The admin warns and offers "Re-encode" (needs the original, or re-encodes from the 1080p rendition with generation loss). Gated → public: keep encryption, make the key endpoint return the key to everyone (`access_level='public'` + `encrypted=true` → serve key). So the rule in step 1 is "not encrypted → 404".
- **Teaser:** title, description, poster, duration are public (`GET /media/:id/playback`). Optional later: a public unencrypted preview clip (first N seconds as its own short rendition set).
- **Mid-playback lapse:** hls.js loads the key once per playback. A lapsed subscription stops at the next page load. Acceptable.
- **SEO:** SSR emits the poster + `VideoObject` JSON-LD with `isAccessibleForFree: false` and the paywall markup for gated videos (Google's guidance for paywalled content).

## 2.6 Data model summary

- **Migration 123** (`-- @feature video` for video tables; the `media` ALTERs are core and run with it or in a separate untagged `123a` — `size BIGINT` and `updated_at` should not wait for the feature).
- **Feature** `video` in `FEATURE_REGISTRY` (`packages/api/src/features/registry.ts`): `tables` (creation order: `media_upload_sessions`, `media_videos`, `media_video_keys`, `video_jobs`, `video_renditions`, `video_key_grants`), `settingsKeys: ['video_settings']`, `onEnable` (none), `onUninstall` (warn: deletes R2 objects? — no; uninstall drops tables only and the admin must delete video media first; state this in the confirm modal). Routes register with `{ feature: 'video' }` so they 404 when off.
- **Permissions** (`services/permissions/catalog.ts`, `FEATURE_PERMISSIONS.video`):

  | Key | Label | Default roles | Why |
  |---|---|---|---|
  | `media.video:upload` | Upload and encode videos | STAFF | Same people who can `media:write` today. |
  | `media.video:manage` | Retry/cancel/re-encode, change access | STAFF | |
  | `media.video:settings` | Edit video encoding settings | ADMIN | Threads/ladder affect the whole server. |
  | `media.gated:view` | Watch subscriber-only videos | `subscriber`, `editor`, `admin`, `sysadmin` | `subscriber` is the role migration 122 seeds for paid tiers. |
  | `media.video:sharing_report` | View key-sharing report | ADMIN | |

- **Settings** `video_settings` keyed row (`services/settings.ts` pattern, env wins):

  ```ts
  interface VideoSettings {
    encodeThreads: number;            // 1   (env VIDEO_ENCODE_THREADS)
    preset: 'ultrafast'|'superfast'|'veryfast'|'faster'|'fast'|'medium'; // veryfast
    crf: number;                      // 21
    segmentSeconds: number;           // 6
    ladder: { name: string; height: number; maxrateKbps: number; audioKbps: number; enabled: boolean }[];
    audioOnlyRendition: boolean;      // false
    encodeOrder: 'fast-first' | 'top-down';
    defaultQuality: 'auto' | 'highest' | number;
    maxUploadGb: number;              // 20
    partSizeMb: number;               // 64
    keepOriginal: boolean;            // default for the upload checkbox
    posterAtPercent: number;          // 10
    sprites: boolean;                 // true
    minFreeDiskGb: number;            // 5
  }
  ```

  Env-only: `VIDEO_ENCODER_ENABLED`, `VIDEO_TEMP_DIR`, `FFMPEG_PATH`, `FFPROBE_PATH`, `VIDEO_ENCODE_CONCURRENCY`.
- **Shared DTOs** in `packages/shared/src/api/routes/media.ts` (+ a `video.ts`): `MediaUploadSessionCreateBody/Response`, `MediaUploadPartUrlsBody/Response`, `MediaVideoStatus`, `MediaPlayback`, `VideoSettings`. `Media` gains `status`, `width`, `height`, `durationMs`, `accessLevel`, `video?: { posterUrl, masterUrl, thumbnailsVtt, renditions: {name,status,progress}[] , progress }`.
- **Storage provider** (`services/storage/types.ts`): add an optional `MultipartCapable` interface on `S3StorageProvider`: `createMultipart(key, contentType)`, `presignPart(key, uploadId, n, ttl)`, `listParts(key, uploadId)`, `completeMultipart(key, uploadId, parts)`, `abortMultipart(key, uploadId)`, `getObjectStream(key, range?)`, `putObjectStream(key, stream, { contentType, cacheControl, contentLength })`, `copyObject`, `deletePrefix(prefix)`, `headObject(key)`. New dependency `@aws-sdk/s3-request-presigner` (same version line as `@aws-sdk/client-s3`, `packages/api/package.json:22`). Fix `uploadToS3` to stream and to set `CacheControl` for all media (Phase 0).

## 2.7 API surface

| Method + path | Auth / permission | Purpose |
|---|---|---|
| `POST /media/uploads` | staff, `media.video:upload` (or `media:write` for non-video) | Create or resume a session. |
| `GET /media/uploads` | staff | My unfinished sessions (for the tray after reload). |
| `GET /media/uploads/:id` | staff (owner) | Session + uploaded parts (`ListParts`). |
| `POST /media/uploads/:id/part-urls` | staff (owner) | Presigned URLs for ≤ 50 part numbers. |
| `POST /media/uploads/:id/complete` | staff (owner) | Complete, create media + job. |
| `DELETE /media/uploads/:id` | staff (owner) | Abort. |
| `GET /media/:id/video` | staff | Job + renditions + progress. |
| `GET /media/video/jobs?active=1` | staff | Queue view; the library polls this. |
| `POST /media/:id/video/cancel` · `/retry` · `/reencode` | staff, `media.video:manage` | |
| `PUT /media/:id` (extend) | staff, `media.video:manage` for `accessLevel` | Access level, title, credits. |
| `GET /media/:id/playback` | optional | `{ masterUrl, posterUrl, thumbnailsVtt, durationMs, width, height, accessLevel, access: { allowed, reason } }`. Only public fields; never `SELECT *`. |
| `GET /media/:id/master.m3u8` | public | §2.4. |
| `GET /media/:id/hls-key` | optional, `media.gated:view` | §2.5. |
| `GET/PUT /settings/video` | admin, `media.video:settings` | Settings. |
| `GET /media/video/status` | staff | ffmpeg/ffprobe/disk status. |

SDK: `cms.media.uploads.*`, `cms.media.video.*`, `cms.media.playback(id)`; regenerate `docs/API.md` (`npm run docs:api`) and run `check:drift`. MCP `upload_media` (media-from-path) should switch to the multipart path for files > 50 MB.

## 2.8 Admin UI and public player

**Uploader** (`packages/cms/src/services/upload/multipartUploader.ts`, framework-free; UI in `components/admin/media/UploadTray.tsx`):
- XHR (not `fetch`) per part for `upload.onprogress`; 3 parts in flight; per-part retry; presign batches of 20; pause/resume/cancel.
- A global **upload tray** mounted in `AdminLayout` (bottom-right), so uploads continue while the editor navigates between admin pages. `beforeunload` warning while a part is in flight. Shows speed and time left.
- After reload: unfinished sessions from `GET /media/uploads` + `localStorage`; "Choose file to resume"; a different file (fingerprint mismatch) is refused with a clear message.
- `MediaUploadModal` and the video block "Upload" route video files (and any file > 50 MB) to the multipart uploader; small images keep `POST /media`.
- Upload options: title, access level (`Public` / `Signed-in members` / `Subscribers`), "Keep original file" (`Toggle`, per ADMIN_STYLES rules), all via `FormField`.

**Media library** (`pages/admin/Media.tsx`):
- Video tiles show the poster (not a `<video>`), duration badge, access badge (lock icon), and while processing: overall % bar + rendition chips — `480p ✓`, `1080p encoding 43 %`, `720p queued`, `360p failed ↻`.
- Live updates: poll `GET /media/video/jobs?active=1` every 3 s while any job is active or any tile shows `processing`; stop when none. (WS push later needs a Redis hop from the primary to the serving workers' Admin Channel; not worth it for v1.)
- `MediaEditModal`: player (HLS), status panel with per-rendition rows (status, %, size, error text), Cancel / Retry / Re-encode (disabled with a reason when the original is gone), access-level select with the re-encode warning, poster "use current frame" (optional, Phase 6).
- **Settings → Media → Video** panel: ffmpeg status line, threads (1..cores), preset, ladder rows (enable/disable), segment length, max upload, keep-original default, disk free + temp dir.

**Video block + public player:**
- Video block data gains `mediaId` as the primary reference (already in `data.mediaId`, admin `VideoBlock.tsx:41-47`). Public `VideoBlock` (`components/blocks/types/VideoBlock.tsx`) switches by source: YouTube/Vimeo URL → `<iframe>` (today); `mediaId` → `VideoPlayer` with playback info from `cms.media.playback(id)` (SWR-cached); plain file URL → `VideoPlayer` with the correct MIME type.
- `VideoPlayer` (`components/blocks/media/VideoPlayer.tsx`): new props `hlsSrc`, `thumbnailsVtt`, `locked`. On first play (or when visible), lazy-load `hls.js` (`import('hls.js/dist/hls.light.min.js')` — no subtitle/EME code) when `Hls.isSupported()`, else native HLS (`canPlayType('application/vnd.apple.mpegurl')`). Config: `enableWorker` true (CSP `worker-src blob:`), `startLevel` from settings, `capLevelToPlayerSize: true` (do not fetch 1080p into a 400 px card). Fix the hardcoded `video/mp4` (`VideoPlayer.tsx:62`). `preload="none"` + poster for below-the-fold players.
- **Locked state:** poster + overlay "For subscribers" + button to the profile Membership tab (`/subscribe` redirects there per `dc10d205`). Also on hls.js `KEY_LOAD_ERROR` 403.
- Hero-carousel video items and other raw `<video>` users (§1.4 V5) resolve HLS the same way, through one helper `resolveVideoSource(media)`.
- SSR (`services/ssr/blocks/`): video block emits poster `<img>`, title, and `VideoObject` JSON-LD. Mail (`services/mail/blocks/`): poster image linked to the page with a play overlay.
- `index.html` / SSR head: `<link rel="preconnect" href="<S3_CDN_URL>" crossorigin>` when the video feature is on.

## 2.9 Delivery efficiency checklist

- Segments, rendition playlists, posters, sprites: `Cache-Control: public, max-age=31536000, immutable` (unique paths per `encodeId`).
- Master playlist: short TTL while encoding, long after, purge on change (§2.4).
- Key: `private, no-store`.
- All existing media uploads: set `Cache-Control: public, max-age=31536000, immutable` from now on (unique nanoid names); optional one-off script to copy-in-place existing objects with new metadata (`CopyObject` with `MetadataDirective: REPLACE`).
- Cloudflare: Cache Rule for `cdn.surgemedia.us/video/*` (+ the master path on the site host); Tiered Cache on; consider Cache Reserve only if R2 Class B costs grow.
- R2 CORS for `GET, HEAD, PUT` with `ExposeHeaders: ETag`.
- No byte through Node or nginx, both directions.
- `capLevelToPlayerSize`, lazy hls.js, poster-first, `preload="none"`.
- 6 s segments: fewer requests than 2–4 s (Class B, Worker count), slightly slower ABR adaptation; fine for VOD.

## 2.10 Phased plan

Effort in developer-days (one experienced dev on this codebase). Total ≈ **16–21 days**.

### Phase 0 — Fixes that help today (1 day)

Tasks:
- CSP (`middleware/csp.ts:58-75`): add `mediaSrc: ["'self'", 'blob:', cdnOrigin]`, add `cdnOrigin` + R2 S3 endpoint origin to `connectSrc`, add `workerSrc: ["'self'", 'blob:']`. Derive origins from `S3_CDN_URL` / `S3_ENDPOINT`.
- `s3.ts`: stream the body (`createReadStream` + `ContentLength`) instead of `fs.readFile`; set `CacheControl` immutable; use `@aws-sdk/lib-storage` `Upload` for files > 100 MB (server-side multipart) as a stop-gap.
- Migration: `media.size BIGINT`; check/add `media.updated_at` (§1.2).
- `multerDestDir` (`services/media.ts:31-33`): use `UPLOAD_TEMP_DIR` (default `/var/tmp/sitesurge-uploads`), not `os.tmpdir()`.
- Apply `ALLOWED_FILE_TYPES` as a multer `fileFilter` (A5) or delete the setting.
- `VideoPlayer`: MIME from extension. Public `VideoBlock`: direct files → `VideoPlayer`.
- Ops: R2 CORS rule.

Risks: a wrong CSP origin breaks images/video site-wide → test on the staging site first.
Acceptance: a CDN MP4 plays on the production public site with no CSP error in the console; a 400 MB upload does not raise a worker's RSS by 400 MB (watch `ps`); `curl -I` on a new upload shows `cache-control: public, max-age=31536000, immutable`.

### Phase 1 — Resumable direct-to-R2 upload (3–4 days)

Files: `services/storage/s3.ts` (+ types), `services/mediaUploads.ts`, `routes/media.ts` (new routes), `repositories/mediaUploadSessions.repo.ts`, migration, shared DTOs, `cms-client/src/modules/media.ts`, `cms/src/services/upload/multipartUploader.ts`, `components/admin/media/UploadTray.tsx`, `MediaUploadModal.tsx`, daily abort cron.
Risks: R2 equal-part-size rule; presigned URL clock skew (use server time, 1 h TTL); CORS `ExposeHeaders: ETag` missing → `complete` must use `ListParts`, not client ETags (designed in).
Acceptance tests:
- Upload a 5 GB file; `ps` shows no Node RSS growth; nginx access log shows no body bytes.
- Kill the network at 40 % → it resumes on reconnect with no re-sent completed parts (count PUTs in DevTools).
- Reload the page at 60 % → re-pick the file → resumes at ~60 %.
- Pick a different file with the same name → refused.
- Unit: part math (size → partCount, last part size), fingerprint match, session expiry. Integration against MinIO in CI (equal part sizes enforced by a test).

### Phase 2 — Encoding pipeline (4–5 days)

Files: `services/video/tooling.ts`, `probe.ts`, `ladder.ts` (pure: probe → rungs), `ffmpegArgs.ts` (pure: args builder, unit-tested), `worker.ts` (claim/lease/heartbeat/loop), `uploadRendition.ts`, `repositories/videoJobs.repo.ts`, `lib.ts` (start under `runOnceOnlyWork`, stop on shutdown), settings, feature registry entry, permissions.
Risks: CPU contention (mitigated by nice/ionice/threads=1; measure p95 page latency during an encode); disk fill (budget check); ffmpeg build without libx264 (detection); rotated phone video; VFR sources (force_key_frames by time handles it); long encodes vs deploys (lease + resume per rung).
Acceptance tests:
- A 1080p source yields 4 ready rungs, poster, sprite; a 720p source yields 3 (no 1080p).
- `kill -9` the primary during 1080p encode → after restart the job resumes at 1080p and does not redo the ready 480p.
- Two processes polling (test harness) never encode the same job (lease test).
- During an encode, `tools/loadtest.mjs` at 100 users: p95 latency within 15 % of the idle baseline.
- Disk below budget → `blocked_reason='disk'`, no partial files.
- Original deleted from R2 after success when keep = false; kept under `originals/` when true.
- Unit: ladder selection, args builder (key-info present only when encrypted), progress parser, weighted progress.

### Phase 3 — Playback (2–3 days)

Files: `routes/media.ts` (`master.m3u8`, `playback`), `services/video/playback.ts`, cache keys, `VideoPlayer.tsx` (hls.js, quality menu, preview thumbnails), public `VideoBlock.tsx`, admin `VideoBlock.tsx`, `HeroCarousel.tsx`, `resolveVideoSource`, SSR block emitter, mail emitter.
Risks: hls.js bundle size (lazy chunk only on play); Safari native path has no quality menu; CF caching `.m3u8` needs the Cache Rule.
Acceptance: video plays in Chrome, Firefox, Safari macOS, iOS Safari, Android Chrome; quality menu switches rungs with no stall; after the first rung is ready the video plays, and a reload after the next rung shows two qualities; second viewer's segment requests show `cf-cache-status: HIT`.

### Phase 4 — Paid access (2–3 days)

Files: key generation in job creation, `ffmpegArgs` key-info, `routes/media.ts` (`hls-key`), `services/video/access.ts` (permission + content-access), `catalog.ts` permissions, `video_key_grants`, rate limit, locked overlay in `VideoPlayer`, access-level UI, re-encode warning.
Risks: domain baked into key URI; a user with the key can share it (documented, sharing report); permission defaults must not remove anything existing (new permission only).
Acceptance: anonymous / member-without-tier / subscriber / admin each get 403/403/200/200 on the key; segments downloaded with `curl` do not play without the key (`ffprobe` fails); lapsed subscriber gets the locked overlay on next load; public videos have no `#EXT-X-KEY`.

### Phase 5 — Admin UX (2–3 days)

Files: `pages/admin/Media.tsx`, `MediaEditModal.tsx`, `MediaSelectModal.tsx` (posters, status), `components/admin/media/VideoStatusPanel.tsx`, `RenditionChips.tsx`, settings panel `settings/VideoSettingsPanel.tsx`, admin help page `/admin/help/video`.
Acceptance: progress updates within 5 s; Retry and Cancel work from the library and the modal; settings changes apply to the next job; all inputs commit on blur; booleans are `Toggle`s.

### Phase 6 — Optional (2–4 days, as needed)

Cloudflare Worker cookie gate (§2.5 B); WS push of progress via Redis → Admin Channel; captions (WebVTT upload → `#EXT-X-MEDIA:TYPE=SUBTITLES`); audio-only rung; public preview clip; poster from current frame; local-provider chunked fallback; one-off `Cache-Control` backfill for existing objects; key-sharing report page.

### Docs (in the same PRs, per project rules)

`CLAUDE.md` (Media library + new "Self-hosted video" capability paragraph, Gotchas: tmpfs, R2 equal part size, CSP origins), `docs/API.md` + `api-manifest.json` (generated), `docs/sdk/` media page, `docs/MCP.md` if `upload_media` changes, `/admin/help/video`, `packages/api/.env.example` (new env vars), deploy notes.

## 2.11 Ops checklist

1. **ffmpeg**: RPM Fusion install (§2.2); verify `libx264`. Set `VIDEO_TEMP_DIR=/var/tmp/sitesurge-video`, `mkdir -p` with the service user as owner. Check `findmnt /tmp` (expect tmpfs on Fedora).
2. **R2 CORS** (bucket `surge-media` → Settings → CORS policy):

   ```json
   [
     {
       "AllowedOrigins": ["https://surgemedia.us", "https://surge.ryanweiss.net"],
       "AllowedMethods": ["GET", "HEAD", "PUT"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag", "Content-Length", "Content-Range", "Accept-Ranges"],
       "MaxAgeSeconds": 86400
     }
   ]
   ```
3. **R2 lifecycle**: "Abort incomplete multipart uploads" after 7 days (bucket-wide); "Delete objects" with prefix `incoming/` after 14 days.
4. **R2 API token** used by the server needs Object Read & Write on the bucket (already has write; presigning uses the same keys). Presigned URLs target `https://<account>.r2.cloudflarestorage.com` — add that origin to CSP `connect-src` (Phase 0).
5. **Cloudflare (zone of the CDN host)**: Cache Rule `hostname eq cdn.surgemedia.us and starts_with(http.request.uri.path, "/video/")` → Eligible for cache, Edge TTL: respect origin, Browser TTL: respect origin. Cache Rule for `surgemedia.us/api/v1/media/*/master.m3u8` → eligible, respect origin. Enable Tiered Cache.
6. **Purge token**: `CLOUDFLARE_ZONE_ID` + `CLOUDFLARE_PURGE_TOKEN` already exist for branding; confirm the token's zone covers the hosts to purge.
7. **nginx: no change.** Upload and playback bytes never reach it. Keep `client_max_body_size 50m`.
8. **systemd**: nothing required. Optional `CPUQuota` scope documented in §2.2.
9. **Monitoring**: alert when a job is `failed`, when `blocked_reason` persists > 1 h, and on disk free < 10 GB.
10. **Backups**: `media_video_keys` is in the DB → in `pg_dump` backups (good: without the keys the encrypted segments are useless). R2 objects are not in DB backups (same as all media today).

## 2.12 Open questions

1. **Who may watch:** one permission (`media.gated:view`) for all paid videos, or per-video tier lists (e.g. "Tier 2+ only")? The permission catalog is static; per-tier gating would need either custom permissions per video group or a `required_role_keys[]` column. Recommend one permission for v1.
2. **Keep originals?** Recommend keep by default for the first months (cost ≈ $0.15/month per 10 GB), then decide.
3. **Max size**: 20 GB enough? Typical length and source bitrate of their videos?
4. **Downloads**: should subscribers get a download (MP4) option? (Note the YouTube perk-policy caution in the research doc.)
5. **Captions / transcripts**: do they have SRT/VTT files from YouTube Studio to upload with each video?
6. **Workers Paid ($5/month)** acceptable later for the cookie gate?
7. **Free preview**: show the first N seconds to everyone as a teaser?
8. **Existing CDN MP4s** blocked by CSP today (§1.3 S8): confirm in a browser and decide whether Phase 0 ships before the rest (recommended: yes).
9. **Domain stability**: is `surgemedia.us` final? The key URI is baked into encrypted playlists.
10. **Storage-setting split** (A11): should the provider read the `media_storage` setting? Fix before video so presigning uses the same credentials the admin shows.
