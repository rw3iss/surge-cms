## gallery-media

Scope: gallery (collections, access rules, hide-from-gallery, masonry, lightbox,
collection pages, settings), media library (pagination, usage guard, uploads,
thumbnail/dimension scripts, MediaEditModal, viewer), self-hosted video
(direct uploads, worker, playback, `/watch`, access-denied flow). Window:
`git log --since=2026-09-25` (35 commits touch these paths). Read-only audit.

Rule sweep of the scope: zero raw `type="checkbox"`, zero `!important`, zero
`cache.del`/`delPattern` outside `cache.ts`. One per-keystroke lift (G-A3), one
inline hex (`#94a3b8`, G-A5). Hex values in the gallery SCSS are `var(--site-*, #fallback)`
fallbacks or `#fff` on dark overlays, which is acceptable.

Totals: **43 findings**. Phase A 26, Phase B 11, Phase C 6.

---

### Security / authorization

#### S1. Single media delete, metadata update and uploads do not check `media:write`
- **Location:** `packages/api/src/routes/media.ts:129-160` (uploads), `:225-241` (PUT/DELETE `/:id`), `:162-184` (GET list / by-url / `:id`, no `media:read`)
- **Problem:** `bulk-delete` and `discard` call `requirePermission(…'media:write')`. `DELETE /:id`, `PUT /:id` and the three multer uploads do not, and they rely on the `staff` tier only. If an operator revokes `media:write` from editors in Settings → Permissions, editors can still upload, rename and delete media one item at a time. The same gap is in `routes/video.ts:145-160,201-206` (`/jobs`, `/status`, `/settings` GET, `/:id` GET have no `media:read`).
- **Fix:** add `await requirePermission(subject, 'media:write')` to every mutating media route, and `media:read` to the reads. Add a route test that a role without `media:write` gets 403 on `DELETE /media/:id`.
- **Risk:** low (the defaults are STAFF, so behaviour does not change). **Phase:** A

#### S2. Collection names and descriptions leak from a members-only gallery
- **Location:** `packages/api/src/services/gallery/collections.ts:61-82` (`select` → `collectionGateSql` only), `packages/api/src/routes/gallery.ts:169-189`, `packages/api/src/services/ssr/staticMeta.ts:409-418`
- **Problem:** the collection gate checks only the collection's own rule. It does not check the gallery floor (`access: members|tier`). When the gallery is members-only, an anonymous `GET /api/v1/gallery/collections` and `GET /gallery/collections/:id` still return every collection's name, description and `itemCount` (0). The SPA hides them because it checks `config.canView`, but the API does not. SSR also puts `collection.name` + description into `<title>` / `og:description` for a gated gallery (`page(c, name, description, gated)` at line 418). Social scrapers and search snippets can read them, even with noindex.
- **Fix:** in `select('site')`, add `galleryFloor(s) <= level` (or return `[]` / gated from the route when `publicConfig(viewer).canView` is false). In SSR, use the gallery title, not the collection name, when `!publicGallery`. Add a test: anonymous + `access: 'members'` → `listCollections` is empty.
- **Risk:** low. **Phase:** A

#### S3. Direct uploads bypass `ALLOWED_FILE_TYPES` and `UPLOAD_MAX_SIZE_MB` for non-video files
- **Location:** `packages/api/src/services/video/uploads.ts:115-160` (`createOrResume`), `routes/video.ts:102-110`
- **Problem:** the multer routes enforce the operator's MIME allow-list and `maxSizeMb`. The multipart session path, which is used for any file > 50 MB and by SDK callers, checks only `maxUploadGb` from the video settings. A staff user can store a 40 GB `.zip` or a type the operator banned. Also, `partUrls`/`complete` do not check the permission again, so a session started before a revoke still finishes.
- **Fix:** move `isAllowedType` + the size cap into a shared `services/uploadPolicy.ts`. Call it from `createOrResume` for non-video MIME types. Use `maxUploadGb` only for video. Check the permission again in `complete`.
- **Risk:** low. **Phase:** A

#### S4. `/video/:id/file` answers "This video is for subscribers" for a video that is only still encoding
- **Location:** `packages/api/src/routes/video.ts:277-285`
- **Problem:** `fileLink` returns `kind: 'watch'` for a permitted viewer when nothing is encoded yet. For a non-HTML client (`<video src>`, curl, the SDK) the route maps every non-redirect to 403 `CONTENT_LOCKED` with "This video is for subscribers.". A subscriber's embed then shows a paywall error for a processing video, and logs say it was denied.
- **Fix:** branch on `link.kind`. `denied` → 403 `CONTENT_LOCKED` + reason. `watch` → 409 (or 503 + `Retry-After`) `VIDEO_NOT_READY`, the code `masterPlaylist` already uses.
- **Risk:** low. **Phase:** A

#### S5. Gallery CSS-value validator accepts CSS escapes
- **Location:** `packages/api/src/services/gallery/settings.ts:25-30`
- **Problem:** `cssValue` refuses `;{}<>"`, comments and `url(`, but it accepts a backslash. A CSS escape such as `\75 rl(https://…)` decodes to `url(` in the browser, so a value can still load a remote resource (tracking pixel). The setting is admin-only, so the risk is low, but the guard is meant to be complete. Check the same pattern in `bannerPosition`/`blockStyleInput`.
- **Fix:** also refuse `\\` (and `expression(`, `@import`). Make one shared `isSafeCssValue()` in `@sitesurge/types` so every validator agrees.
- **Risk:** low. **Phase:** A

#### S6. Share links cannot be revoked one at a time
- **Location:** `packages/api/src/services/video/share.ts:1-37`
- **Problem:** share tokens are stateless HMACs on `JWT_SECRET`, valid for up to 365 days. The only revoke is to rotate `JWT_SECRET`, which also signs out every user. If a private video's link leaks, the operator cannot stop it.
- **Fix:** add a per-media `share_epoch` (int, default 0) to the signed string (`video-share:id:epoch:exp`). Add **Revoke share links** in the admin, which increments the epoch. Do the same on an access-level change. The tokens stay stateless.
- **Risk:** medium (it touches the token format; old tokens fail once, which is acceptable). **Phase:** B

---

### Correctness / data integrity

#### C1. Rebuilt thumbnails (`thumb_v3_*`) are never deleted. Storage leaks on every media delete
- **Location:** `packages/api/src/services/storage/s3.ts:82-87`, `packages/api/scripts/rebuild-thumbnails.ts:51-53`
- **Problem:** `deleteThumbnail(filename)` deletes `thumb_<file>` and `thumb_v2_<file>` only. `rebuild-thumbnails.ts` writes `uploads/thumb_v3_<base>.<png|jpg>`, which uses a different stem AND can use a different extension. Every media item deleted after the 2026-10-18 rebuild leaves its v3 thumbnail in R2. The script comment ("a deleted media item still purges by its own row") is wrong.
- **Fix:** delete the key derived from the row's `thumbnail_url` (`store.keyFromUrl(thumbnail_url)`). Pass `thumbnail_url` into `deleteThumbnail` (it is already in the `RETURNING`). Keep the legacy keys as a best-effort sweep. Add a one-off script that lists orphaned `thumb_*` objects.
- **Risk:** low. **Phase:** A

#### C2. `media.remove` deletes the row before the files; a storage failure leaves orphans and a wrong result
- **Location:** `packages/api/src/services/media.ts:446-467`
- **Problem:** the DB row is deleted first, then `storageProvider.delete()` runs. If that throws (R2 blip), the function throws after the row is gone. The audit log and `invalidateMediaConsumersCache()` are skipped (stale cached payloads still show the media). `bulk-delete` reports the id as `failed` although it is deleted, and the object is orphaned with no record.
- **Fix:** wrap the storage deletes in try/catch + `logger.warn`, then always audit and invalidate the cache. Or do the storage deletes first and the row last (the same order `deleteVideoAssets` uses). Add a test with a provider that throws.
- **Risk:** low. **Phase:** A

#### C3. `whenComplete()` resolves `null` for an upload that already finished
- **Location:** `packages/cms/src/stores/uploads.ts:165-170`
- **Problem:** a caller that subscribes after the row reached `done` gets `null`, which means "cancelled/failed". `uploadMedia.ts` works around this with `row?.mediaId`, but `MediaUploadModal.tsx:146` uses the resolved value directly, so a fast upload can look as if it failed.
- **Fix:** keep the completed `Media` on the row (or in a `Map`) and resolve with it. Resolve `null` only for `cancelled`/`error`.
- **Risk:** low. **Phase:** A

#### C4. Gallery publish has no concurrency check (last writer wins on order and fields)
- **Location:** `packages/api/src/services/gallery/items.ts:410-470`, `packages/cms/src/pages/admin/gallery/GalleryAdmin.tsx:441-520`
- **Problem:** `PUT /gallery/admin/items` replaces sort order and every field from a draft that can be hours old (it is restored from localStorage on load). Two editors, or one editor in two tabs, overwrite each other's edits without a warning. Items the other editor added keep their old `sort_order`, so they collide with the new order.
- **Fix:** send `basedOn` = the max `updated_at` the draft was built from. The server returns 409 `GALLERY_CHANGED` when newer rows exist, and the admin offers "reload / publish anyway". Also show the `SamePageWarning` (the admin presence channel already supports it).
- **Risk:** medium. **Phase:** B

#### C5. Mixed save semantics in the gallery admin: some actions are immediate, others wait for Publish
- **Location:** `packages/cms/src/pages/admin/gallery/GalleryAdmin.tsx:325-430`
- **Problem:** item edits, order, add and remove are drafted until **Publish**. Collection create, rename, delete and **move item to collection** (for saved items) go to the server at once. *Discard* does not undo a move or a new collection, and the toasts ("Moved to X." vs "saved when you publish") are the only cue. An operator who discards a session keeps half of it.
- **Fix:** choose one model. Recommended: draft collection membership too (move = `patchRow({collectionId})`, published by `sync`, which already accepts `collectionId`). Keep collection CRUD immediate and label it "Saved" in the collection panel header.
- **Risk:** medium. **Phase:** B

#### C6. Comments are orphaned when a gallery item is removed
- **Location:** `packages/api/src/services/gallery/items.ts:345-352`, `:425-432`, `collections.ts:204-210`, `services/media.ts:488-494`
- **Problem:** the four removal paths delete `comment_threads` rows, but not the `comments` rows on `target_type='gallery_item'`. Those rows still count in `user_activity` and appear in `/admin/comments` and member Comments tabs, with a link to a 404. They also feed the discovery queries (`latestComments`).
- **Fix:** add one `deleteTargetDiscussions(client, 'gallery_item', ids)` helper in `services/discussions` (soft-delete comments, decrement activity counts, delete the thread). Call it from all four paths in the same transaction.
- **Risk:** medium (counter maintenance). **Phase:** B

#### C7. `sort=random` with OFFSET pagination repeats and skips items
- **Location:** `packages/api/src/services/gallery/items.ts:228`, `packages/cms/src/pages/gallery/useGalleryItems.ts:26-36`
- **Problem:** each page runs a new `ORDER BY random()`, so "Load more" on a random gallery or block shows duplicates and never shows some items.
- **Fix:** seed the order: `ORDER BY md5(gi.id::text || $seed)` with a `seed` query param that the client keeps for the session (the cache key can then include it).
- **Risk:** low. **Phase:** A

#### C8. Gallery cache is not cleared when a video finishes encoding
- **Location:** `packages/api/src/services/video/worker.ts:166,190,205`, `pipeline.ts:314`
- **Problem:** public gallery reads need `m.status = 'ready'`. When the worker flips a video to ready it clears only `invalidateVideoCache(id)`, so the anonymous gallery list (60 s) and the collection covers keep the item hidden. That is small, but it looks like "I published and it is not there".
- **Fix:** call `cache.invalidateGalleryCache()` when `media.status` changes (one place in the repo's `setMediaStatus`).
- **Risk:** low. **Phase:** A

---

### Performance

#### P1. Comment-target `summaries` is N+1 (each id runs settings + list + count)
- **Location:** `packages/api/src/services/gallery/targets.ts:34-40`
- **Problem:** `/admin/comments` and member pages resolve each comment's target through `get(id)`. Each call runs `getSettings()`, the full SELECT and a COUNT. A 50-row moderation page costs about 150 queries.
- **Fix:** `list({ ids }, { audience: 'admin' })` once (it already orders by `array_position`), then map.
- **Risk:** low. **Phase:** A

#### P2. Gallery publish runs one UPDATE (or SELECT+INSERT) per item inside one transaction
- **Location:** `packages/api/src/services/gallery/items.ts:443-470`
- **Problem:** the body accepts 5 000 items. Each kept item is one round trip in a transaction that holds row locks, and each new item is two. A large gallery publish is slow and blocks concurrent reads of `gallery_items` rows.
- **Fix:** one `UPDATE gallery_items g SET sort_order = v.ord, … FROM unnest($1::uuid[], $2::int[], …) v(id, ord, …) WHERE g.id = v.id`, plus one `INSERT … SELECT FROM unnest(…) ON CONFLICT (media_id) DO UPDATE SET sort_order`. Only send rows whose fields changed (the draft knows), with order as an id array.
- **Risk:** medium. **Phase:** B

#### P3. The media usage guard scans about 15 full tables with `LIKE '%…%'` on each check
- **Location:** `packages/api/src/services/mediaUsage.ts:96-232, 300-330`
- **Problem:** every delete, every Edit modal open (`MediaEditModal.tsx:76`) and every publish-with-delete runs all sources in parallel. Each is a sequential scan of `concat_ws(jsonb::text …) LIKE` × patterns, and none can use an index. On a site with many posts/blocks this costs seconds and fills the pool (`Promise.all` of ~15 queries at once). `gallery items` uses `LIKE` on a uuid column it could compare with `=`.
- **Fix:** (1) For id-keyed sources (`gallery_items`, `shop_product_media`) use `= ANY($ids::uuid[])`. (2) Add `pg_trgm` GIN indexes on the hottest text columns (`blocks.settings::text`, `posts.content`), or keep a `media_refs` table updated on save. (3) Limit the parallelism to 4. (4) Cache usage per media id for 30 s in Redis, cleared on content writes.
- **Risk:** medium. **Phase:** C

#### P4. The media library mounts a `<video preload="metadata">` per non-encoded video tile
- **Location:** `packages/cms/src/pages/admin/Media.tsx:378-381`
- **Problem:** a 100-per-page library with old MP4 uploads opens up to 100 range requests to the CDN when the page loads. Image tiles have no `loading="lazy"` (`:375`).
- **Fix:** add `loading="lazy" decoding="async"` on `<img>`. For plain videos render a static placeholder and load `<video>` on hover/visible (IntersectionObserver), or generate a poster at upload.
- **Risk:** low. **Phase:** A

#### P5. The gallery admin loads every item and every tier list without pagination
- **Location:** `packages/cms/src/pages/admin/gallery/GalleryAdmin.tsx:175-200`, `routes/gallery.ts:237-244`
- **Problem:** `GET /admin/items` returns the whole gallery (no limit), and `subscriptionTiers.options()` + `subscriptionTiers.list()` are both fetched for the same data. With thousands of items the admin is slow, and each publish sends everything (see P2).
- **Fix:** drop the duplicate tier fetch (derive options from `list()`). Longer term, virtualise the grid and load per collection (the folder view already scopes `viewRows`).
- **Risk:** medium. **Phase:** C

---

### UI / UX / accessibility

#### U1. Media grid items cannot be used with the keyboard
- **Location:** `packages/cms/src/pages/admin/Media.tsx:371`
- **Problem:** `<div class="media-grid__item" onClick={openModal}>` has no role, no tabindex and no key handler, so a keyboard user cannot open the viewer. The download button is a bare `↓` with only `title` (`:417-421`).
- **Fix:** make the preview a `<button type="button" class="media-grid__open">` (or add `role="button" tabindex="0"` + Enter/Space). Add `aria-label="Download"` to the arrow button.
- **Risk:** low. **Phase:** A

#### U2. Media library errors are silent or shown with `alert()`
- **Location:** `packages/cms/src/pages/admin/Media.tsx:128-137` (list `catch { return [] }`), `:165-178` (upload has no try/catch), `:196,233` (`alert`)
- **Problem:** a failed list fetch shows "No media found.", so an empty library and a 500 look the same. A failed classic upload is an unhandled rejection with no feedback. Errors use native `alert()`, while the gallery admin uses `toast`. `UploadTray.tsx:57` uses native `confirm()`.
- **Fix:** keep an `error()` signal → `<div class="alert alert--error">` with **Retry**. Wrap `handleUpload` in try/catch → `toast.error`. Replace `alert`/`confirm` with `toast` and the existing `confirmMediaDelete`/`ConfirmModal`.
- **Risk:** low. **Phase:** A

#### U3. The media library cannot select several items, has no bulk delete and no multi-file upload
- **Location:** `packages/cms/src/pages/admin/Media.tsx:291-301`
- **Problem:** the server has `POST /media/bulk-delete` (`cms.media.bulkRemove`) and `/media/bulk` uploads, and `confirmMediaDelete` already accepts several ids, but the page offers one file input (no `multiple`), no drag-and-drop and no selection. Cleaning up a library means one confirm per file.
- **Fix:** add `multiple` + a drop zone (send each file to `startUpload`/`upload`). Add a selection mode using `components/ui/Checkbox` (selection, not a setting, per the house rule) with a bulk **Delete** that goes through `confirmMediaDelete({ ids })` → `bulkRemove`.
- **Risk:** medium. **Phase:** B

#### U4. No alt-text field on media. The upload modal copies the description into `alt`
- **Location:** `packages/cms/src/components/admin/media/MediaEditModal.tsx:225-255`, `MediaUploadModal.tsx:134,180`
- **Problem:** `media.alt` drives `alt=` on every gallery tile, lightbox, Image block and SSR figure. The edit modal edits Title / Description / Credits only, so alt cannot be corrected after upload. At upload, `alt = description`, so a long caption ("Photo taken at…, courtesy of…") becomes the screen-reader text.
- **Fix:** add an **Alt text** `FormField` (hint: "Describe the image for screen readers; leave empty for decorative images") to both modals. Stop copying the caption. `updateMeta` already accepts `alt`.
- **Risk:** low. **Phase:** A

#### U5. The gallery lightbox does not trap focus or return focus on close
- **Location:** `packages/cms/src/components/gallery/GalleryLightbox.tsx:52-62`
- **Problem:** focus moves to Close when the lightbox opens, but Tab leaves the dialog into the page behind it (`aria-modal` alone does not stop this). When it closes, focus stays on `<body>`, so a keyboard user loses their place in the grid. The document-level ←/→ handler also takes arrow keys while the video player has focus, so seeking with the keyboard is not possible in the lightbox.
- **Fix:** add a small shared `useFocusTrap(el, { restoreTo: document.activeElement })` (ModalShell probably has the logic, so extract it). Ignore ←/→ when `e.target` is inside `.vp-` controls.
- **Risk:** low. **Phase:** A

#### U6. The lightbox loads the full-size original and does not preload neighbours
- **Location:** `packages/cms/src/components/gallery/GalleryLightbox.tsx:90`
- **Problem:** `<img src={media.url}>` is the original upload (often 5–20 MB from a phone). There is no loading indicator, so each arrow press shows a blank stage until the original arrives.
- **Fix:** show the thumbnail at once as a blurred placeholder and swap in the full image on `onLoad`. Preload `items[i±1]` with `new Image()`. Later, create a ~2048px "display" rendition at upload (a second `createThumbnail` width) and use it here.
- **Risk:** low (preload/placeholder); the rendition is Phase B. **Phase:** A

#### U7. Public gallery listing errors look like an empty gallery; "Load more" errors are unhandled
- **Location:** `packages/cms/src/pages/gallery/useGalleryItems.ts:18-36`
- **Problem:** the first page uses `.catch(() => null)`, so a failure shows the empty state. `loadMore` has `try/finally` without catch, so a failure is an unhandled rejection and the button does nothing. A `loadMore` that is still running when `key` changes (viewer signs in, collection changes) appends results from the old collection.
- **Fix:** add an `error` signal and a "Couldn't load — Retry" state. Catch in `loadMore`. Keep a generation counter and drop stale responses.
- **Risk:** low. **Phase:** A

#### U8. `/watch/:id` treats every error as "Video not found" and shows a blank loading state
- **Location:** `packages/cms/src/pages/Watch.tsx:52-54, 72`
- **Problem:** a network error or a 500 shows the 404 page with "it has been removed". The loading fallback is an empty `<div>` with no spinner and no `aria-busy`. The page has no `noindex` meta, although private-video watch pages are not useful search results.
- **Fix:** use NotFound only for `NotFoundError`. Otherwise show an error + retry. Add a spinner/skeleton with `aria-busy="true"`. Add `<Meta name="robots" content="noindex">` when `accessLevel === 'private'`.
- **Risk:** low. **Phase:** A

#### U9. Gallery Settings has no leave-guard for unsaved changes
- **Location:** `packages/cms/src/pages/admin/gallery/GallerySettings.tsx:62,121-126`
- **Problem:** `dirty()` is computed and shown as "Unsaved changes", but leaving the page (or switching to the Gallery tab in the sidebar) drops the edits without a question. The gallery admin page has a guard (`GalleryAdmin.tsx:905-910`).
- **Fix:** use the same navigation guard (`useLeaveGuard`/`beforeunload`) when `dirty()`. Add Ctrl/Cmd+S to save, as on the admin page.
- **Risk:** low. **Phase:** A

---

### Styling / consistency

#### G-A1. `formatSize` / `getTypeLabel` are defined five times
- **Location:** `components/admin/media/MediaEditModal.tsx:39-50`, `MediaUploadModal.tsx:31`, `MediaPickerModal.tsx:36`, `MediaSelectModal.tsx:141`, plus `mediaUtils.ts:3-9` (the shared one) and `videoFormat.ts:3` `formatBytes`
- **Problem:** the copies have already drifted (some have GB, some stop at MB). `Media.tsx` already imports from `mediaUtils`.
- **Fix:** import `formatSize`/`getTypeLabel` from `mediaUtils` everywhere. Merge `formatBytes` into it, or move it to `@sitesurge/types` `formatFileSize`, which already exists in `utils/format.ts`.
- **Risk:** low. **Phase:** A

#### G-A2. `CommitInput` is gallery-local but is the project-wide blur-commit pattern
- **Location:** `packages/cms/src/components/admin/gallery/CommitInput.tsx`
- **Problem:** `CLAUDE.md` requires every admin text field to commit on blur. This component is the clean implementation, but it is in `admin/gallery/`. Other editors write the same logic again or skip it (see G-A3).
- **Fix:** move it to `components/admin/forms/CommitInput.tsx` (export it from the forms barrel next to `FormField`). Point to it in `ADMIN_STYLES.md` → text inputs.
- **Risk:** low. **Phase:** A

#### G-A3. `ImageLinkPicker` lifts the URL on each keystroke
- **Location:** `packages/cms/src/components/admin/media/ImageLinkPicker.tsx:92-98`
- **Problem:** `onInput={(e) => props.onChange({ imageUrl })}` goes to the header/footer editors, whose item lists are `createSignal<T[]>` rebuilt with `.map()`. This is the remount and lost-focus pattern the house rule forbids.
- **Fix:** use `CommitInput` (G-A2) with `onCommit`.
- **Risk:** low. **Phase:** A

#### G-A4. Media page filter bar is built from inline style blocks
- **Location:** `packages/cms/src/pages/admin/Media.tsx:305-347`
- **Problem:** about 25 inline declarations (flex row, search wrapper, absolute clear button with `color: '#94a3b8'`). The same search+clear pattern exists in `MediaSelectModal.tsx:186-200`. This breaks the "repeated inline styles belong in a partial" rule and the no-literal-hex rule.
- **Fix:** add `.media-filters`, `.media-filters__search`, `.media-filters__clear` to `pages/admin/styles/_media.scss` (colour `$text-light`). Better, extract a `<SearchInput value onSearch debounce>` component that both screens use.
- **Risk:** low. **Phase:** A

#### G-A5. Two media pickers remain (`MediaPickerModal` vs `MediaSelectModal`)
- **Location:** `packages/cms/src/components/admin/media/MediaPickerModal.tsx` (used by `blocks/types/VideoBlock.tsx`, `DocumentBlock.tsx`)
- **Problem:** `CLAUDE.md` names `MediaSelectModal` as the reusable picker (type filter, viewer lightbox, pagination). Video and Document blocks still open the older `MediaPickerModal`, which has none of these features and its own grid styles.
- **Fix:** move both blocks to `MediaSelectModal types={['video']}` / `['document']`, then delete `MediaPickerModal` (through `/dead-code`).
- **Risk:** low. **Phase:** B

---

### Architecture / code health

#### A1. `GalleryAdmin.tsx` is 916 lines and holds draft, upload, collection and DnD logic
- **Location:** `packages/cms/src/pages/admin/gallery/GalleryAdmin.tsx`
- **Problem:** loading, draft restore/autosave, staging uploads, publish orchestration, collection CRUD, drag-and-drop, keyboard shortcuts and all rendering are in one component. `publish()` alone is 80 lines with nested state patches, and it is the riskiest flow (partial-upload recovery) but has no unit test. Only `galleryDraft.ts` is tested.
- **Fix:** extract `useGalleryDraft()` (rows/patch/restore/autosave), `publishGallery(draft, deps)` (pure orchestration, testable with fake `uploadMediaFile`/`publish`), `useGalleryDnd()`, and a `<GalleryGrid>` view. Add tests for publish-retry (some files uploaded, then failure → retry uploads only the rest).
- **Risk:** medium. **Phase:** C

#### A2. The video encode pipeline (737 lines) and repackage have no direct tests
- **Location:** `packages/api/src/services/video/pipeline.ts:335-536` (`runEncodeJob`), `repackage.ts`
- **Problem:** the logic that most affects correctness is untested: resume from READY rendition rows, the encryption decision, teaser window, quick-replay branch, original retention. Tests cover only the pure helpers (ffmpegArgs, ladder, probe) and the worker loop with mocks.
- **Fix:** split `runEncodeJob` into planned steps (`planEncode(video, renditions, settings) → Step[]`), then run them. Unit-test the planner (resume after rung 2, private → encrypt, live recording → quick replay first). Same for repackage.
- **Risk:** medium. **Phase:** C

#### A3. Gallery item removal is written four times
- **Location:** `services/gallery/items.ts:345` (`remove`), `:425` (`sync` removals), `collections.ts:200` (`deleteCollection`), `services/media.ts:485` (`discard`)
- **Problem:** each one deletes rows, deletes comment threads (C6), clears the gallery + sitemap caches and audits, in slightly different ways (one has `.catch(() => {})`, one runs in a transaction, one does not).
- **Fix:** one `removeGalleryItems(client, where, ctx)` in `services/gallery/items.ts` that returns `{ ids, mediaIds }`. All four call it. This is where C6 gets fixed once.
- **Risk:** low. **Phase:** B

#### A4. Media usage misses mail-send archives and discussion bodies
- **Location:** `packages/api/src/services/mediaUsage.ts:96-232`
- **Problem:** the guard says "not in use", but deleting can still break: (1) sent emails. `mail_send_jobs.rendered_html_template` is the archived email that `/mail/:jobId` serves, and its images 404 after the delete. (2) Comment/forum Markdown bodies with image links. (3) `pages.featured_image`, if the column exists (posts/campaigns/events are covered).
- **Fix:** add sources for `mail_send_jobs.rendered_html_template` (label "Sent email: <subject>", link to the job page) and `comments.body`. Show sent-email uses as "archived — will show a broken image", not as a block.
- **Risk:** low. **Phase:** B

#### A5. Dead or stale tooling: `regenerate-thumbnails.ts` and hardcoded production host
- **Location:** `packages/api/scripts/regenerate-thumbnails.ts`, `rebuild-thumbnails.ts:44`, `backfill-media-dimensions.ts:31`
- **Problem:** `rebuild-thumbnails` (v3) replaces `regenerate-thumbnails` (v2) for every image, so v2 has nothing left to do. Both new scripts use `process.env.SITE_URL || 'https://surgemedia.us'` as the fallback, so a consumer install that runs them without `SITE_URL` fetches from the wrong site. They also set `updated_at = NOW()` on every image, which breaks the library's "Recently updated" sort.
- **Fix:** flag `regenerate-thumbnails.ts` for `/dead-code`. Fail fast when `SITE_URL` is unset (or read it from site settings). Do not change `updated_at` in maintenance scripts.
- **Risk:** low. **Phase:** A

---

### Feature gaps

#### F1. "Unused" filter and "In gallery" badge in the media library
- **Location:** `packages/cms/src/pages/admin/Media.tsx`, `routes/gallery.ts:274-282` (`/admin/media-links`, which has no admin caller today)
- **Problem:** operators often ask "what can I delete?" The usage engine exists, but it is only reachable one item at a time. `GET /gallery/admin/media-links` (documented as "the Media library shows which media is published") is not called by the admin at all.
- **Fix:** call `cms.gallery.admin.mediaLinks(pageIds)` per page → an "In gallery" chip on tiles. Add a **Usage: All / Used / Unused** filter backed by a server-side `media.list({ usage: 'unused' })` (needs P3's index/ref table to be cheap; until then, a per-page usage call).
- **Risk:** medium. **Phase:** B

#### F2. Gallery item / collection search and bulk edit in the admin
- **Location:** `packages/cms/src/pages/admin/gallery/GalleryAdmin.tsx`
- **Problem:** with hundreds of items, there is no search or type filter in the admin grid, and no multi-select to move items, set visibility, add a tag or remove several at once. `POST /admin/items/move` already accepts many ids.
- **Fix:** add a filter box (title/tag) over `viewRows` and a selection mode (`components/ui/Checkbox`). Bulk actions: Move to…, Visibility…, Add tag, Remove. All are draft edits except Move (see C5).
- **Risk:** medium. **Phase:** B

#### F3. Copy-link / embed snippet for a gallery item and a public video
- **Location:** `packages/cms/src/components/admin/gallery/GalleryItemPanel.tsx`, `components/admin/media/MediaEditModal.tsx`
- **Problem:** the edit modal copies the media URL. There is no one-click copy of the public item page (`item.url`) or of the `{{gallery(ids='…')}}` template for one item or collection, which editors type by hand.
- **Fix:** add **Copy page link** and **Copy template** buttons to the item and collection panels. Add **Copy watch link** (`/watch/:id`) to the video edit modal.
- **Risk:** low. **Phase:** A

#### F4. Per-viewer gallery list caching only covers anonymous viewers
- **Location:** `packages/api/src/services/gallery/items.ts:240-262`, `collections.ts:85-99`
- **Problem:** each signed-in member view runs `viewerLevel` + `viewerGrants` + two gated queries, with no cache. Members-only galleries are exactly the ones that get signed-in traffic.
- **Fix:** cache by grant signature (`level + sorted roles + sorted tierIds` hash) instead of "anonymous only". Most members share a few signatures, and `invalidateGalleryCache` already clears the whole prefix.
- **Risk:** medium (cache correctness must hold; the signature must contain every input of the gate). **Phase:** C

#### F5. Video: no admin view of "who watched / share links issued"
- **Location:** `packages/api/src/services/video/manage.ts:share`
- **Problem:** share links are audited (`audit()`), but the video's admin panel does not list them. Combined with S6, an operator cannot answer "is this private video being passed around?"
- **Fix:** list the `share` audit rows for the media in `VideoStatusPanel` (created by, days, expiry). With S6, add Revoke.
- **Risk:** low. **Phase:** C
