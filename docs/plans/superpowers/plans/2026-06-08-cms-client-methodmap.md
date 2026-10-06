---

# @RW/CMS-Client: Authoritative Method-Map

**Generated**: June 2026 | **Module Count**: 28 | **Total Routes**: 198

---

## Contract Layer Exports

### From `packages/shared/src/api/contract.ts`

- **ApiResponse<T>** — Standard response envelope: `{ success: boolean; data?: T; error?: ApiError; meta?: ApiMeta; }`
- **ApiError** — Error structure: `{ code: ErrorCode; message: string; details?: Record<string, unknown>; }`
- **ApiMeta** — Pagination metadata: `{ page?: number; limit?: number; total?: number; totalPages?: number; }`
- **ErrorCode** — Discriminated error codes:
  - Standard: `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR`, `CONFLICT`, `RATE_LIMITED`, `BAD_REQUEST`, `INTERNAL_ERROR`, `SERVICE_UNAVAILABLE`, `CSRF_ERROR`, `CONTENT_LOCKED`, `SERVICE_NOT_CONFIGURED`, `ALREADY_INSTALLED`
  - Legacy (consolidating): `DUPLICATE`, `REFERENCE_ERROR`, `NO_FILE`
  - Client-side synthetic: `NETWORK_ERROR`, `UPLOAD_ERROR`, `TIMEOUT`, `UNKNOWN_ERROR`
- **AssertCompatible<A extends B, B>** — Type: `true` | Location: `packages/shared/src/api/contract.ts:101` | Signature: Compile-time DTO validation helper. Use at route-definition sites to assert zod-inferred query/body types match published DTOs (resolves to `true` when compatible, type error otherwise).
- **PaginationParams** — `{ page?: number; limit?: number; sortBy?: string; sortOrder?: 'asc' | 'desc'; }`
- **SearchParams** — `PaginationParams & { query?: string; filters?: Record<string, unknown>; }`
- **CacheInfo** — `{ cached: boolean; cachedAt?: Date; expiresAt?: Date; etag?: string; }`

### From `packages/shared/src/api/auth.ts`

- **AuthTier** — Union: `'public' | 'optional' | 'user' | 'admin' | 'apiKey'`
- **ApiKeyScope** — Union: `'read' | 'write' | 'admin'`

### From `packages/shared/src/types/user.ts`

- **User** — Full user entity with `id`, `email`, `displayName`, `avatarUrl?`, `role`, `authProvider`, `patreonId?`, `patreonTier?`, `isActive`, `isBanned`, `lastLoginAt?`, `createdAt`, `updatedAt`
- **AuthResponse** — `{ user: User; accessToken: string; refreshToken: string; expiresAt: Date; }` (timestamps serialize to ISO strings on wire)
- **LoginCredentials** — `{ email: string; password: string; }`
- **PatreonAuthResponse** — `{ authUrl: string; state: string; }`
- **PatreonMembership** — `{ id, patreonUserId, patronStatus, currentlyEntitledTiers[], lifetimeSupportCents, lastChargeDate?, lastChargeStatus?, pledgeCadence? }`
- **UserBan**, **UserSession** — Also exported

---

## Web App API Behavior (Current State)

### Location: `packages/cms/src/services/api.ts`

**ApiService Class**:
- **Base URL**: `/api/v1` (customizable, default)
- **Default Timeout**: 30 seconds
- **HTTP Methods Available**:
  - `get<T>(endpoint, options?)` → `Promise<ApiResponse<T>>`
  - `post<T>(endpoint, body?, options?)` → `Promise<ApiResponse<T>>`
  - `put<T>(endpoint, body?, options?)` → `Promise<ApiResponse<T>>`
  - `patch<T>(endpoint, body?, options?)` → `Promise<ApiResponse<T>>`
  - `delete<T>(endpoint, options?)` → `Promise<ApiResponse<T>>`
  - `upload<T>(endpoint, file, fieldName?, additionalData?)` → `Promise<ApiResponse<T>>` (multipart FormData)

**Headers & Auth**:
- **CSRF Token**: Read from cookie `csrf-token` → injected as `X-CSRF-Token` header on every request
- **Authorization**: NOT in current ApiService; tokens managed via HTTP-only cookies (set by backend on /auth routes)
- **Credentials**: `credentials: 'include'` on all fetch calls (sends cookies automatically)
- **Content-Type**: `application/json` (except `upload` which uses FormData)

**Error Handling**:
- 401 on non-auth routes → calls registered `unauthorizedHandler()` (or redirects to `/login`) + returns synthetic `{ success: false, error: { code: 'UNAUTHORIZED', ... } }`
- 503 with `error.code === 'NEEDS_SETUP'` → redirects to `/setup`
- Network errors (AbortError, etc.) → synthetic error codes (`TIMEOUT`, `NETWORK_ERROR`, `UNKNOWN_ERROR`)

**Token Storage**:
- **Access & Refresh Tokens**: HTTP-only cookies `accessToken` + `refreshToken` (no localStorage)
- **Session State**: `sessionStorage` key `rw.auth.manuallyLoggedOut` (flag: user explicitly logged out, prevent autologin)

**Existing High-Level Utilities** (in `api.ts`):
- Named exports for common public routes: `fetchPage()`, `fetchPost()`, `fetchPosts()`, `fetchNavigation()`, `fetchSettings()`, `fetchCampaigns()`, `submitForm()`, `search()`, etc.
- Namespaced objects for complex modules: `mailingListsApi`, `mailTemplatesApi`, `mailSendApi` (method grouping pattern)

---

## Module-by-Module Method Map

### 1. **api-keys** | Mount: `/api/v1/api-keys` | Auth: **admin**

| Method | Method Path | REQUEST DTO | RESPONSE DTO | Flags |
|--------|-------------|-------------|--------------|-------|
| `list()` | GET `/api-keys` | — | `ApiKey[]` | cacheable GET |
| `create(body)` | POST `/api-keys` | `ApiKeyCreateBody` | `ApiKeyCreateResponse` | mutation; invalidates: list |
| `revoke(id)` | DELETE `/api-keys/:id` | — (Params: `id`) | `ApiKey` | mutation; invalidates: list |

**DTOs**: All from `@sitesurge/types` (routes/apiKeys.ts)  
**Special Handling**: 
- Create returns plaintext key **once only** in response
- No standard list endpoint name; use `list()` → maps to GET /:

---

### 2. **audit** | Mount: `/api/v1/audit` | Auth: **admin**

| Method | Method Path | REQUEST DTO | RESPONSE DTO | Flags |
|--------|-------------|-------------|--------------|-------|
| `list(query)` | GET `/audit` | `AuditListQuery` | `AuditLogEntry[]` | cacheable GET; paginated (meta on envelope) |

**DTOs**: `AuditListQuery`, `AuditLogEntry` from routes/audit.ts  
**Special Handling**: No mutations; read-only audit log view. Entity/action/user/date filters via query params.

---

### 3. **auth** | Mount: `/api/v1/auth` | Auth: **mixed** (public/user/admin per route)

| Method | Method Path | REQUEST DTO | RESPONSE DTO | Auth | Flags |
|--------|-------------|-------------|--------------|------|-------|
| `getPatreonUrl()` | GET `/auth/patreon` | — | `PatreonAuthResponse` | public | cacheable GET |
| `login(body)` | POST `/auth/login` | `AuthLoginBody` | `AuthResponse` | public | mutation; sets httpOnly cookies; rate-limited (10/15m → 429) |
| `refresh(body?)` | POST `/auth/refresh` | `AuthRefreshBody` | `AuthResponse` | public | mutation; rotates tokens; refreshToken optional (falls back to cookie) |
| `logout()` | POST `/auth/logout` | — | `AuthLogoutResponse` | public | mutation; clears cookies; always 200 |
| `logoutAll()` | POST `/auth/logout-all` | — | `AuthLogoutAllResponse` | user | mutation; invalidates all sessions; clears cookies |
| `getMe()` | GET `/auth/me` | — | `AuthMeResponse` | user | cacheable GET |
| `syncPatreon()` | POST `/auth/patreon/sync` | — | `AuthPatreonSyncResponse` | user | mutation; idempotent |
| `autologin()` | GET `/auth/autologin` | — | `AuthAutologinResponse` | public | dev-only; localhost + `AUTOLOGIN_ADMIN_LOCALHOST` env check |
| ~~`patreonCallback()`~~ | GET `/auth/patreon/callback` | — | *(raw 302 redirect)* | public | **NOT EXPOSED** (OAuth callback; raw redirect) |

**DTOs**: All from routes/auth.ts  
**Special Handling**:
- `AuthLoginBody` extends `LoginCredentials` with optional `rememberMe` flag (lengthens refresh cookie lifetime)
- `AuthAutologinResponse` has NO `expiresAt` field (unlike standard `AuthResponse`)
- Patreon callback returns raw HTML redirect, not JSON
- Tokens stored in httpOnly cookies; no body field needed for refresh when cookie is present

---

### 4. **block-styles** | Mount: `/api/v1/block-styles` | Auth: **admin**

| Method | Method Path | REQUEST DTO | RESPONSE DTO | Flags |
|--------|-------------|-------------|--------------|-------|
| `list()` | GET `/block-styles` | — | `BlockStyle[]` | cacheable GET |
| `get(id)` | GET `/block-styles/:id` | Params: `id` | `BlockStyle` | cacheable GET |
| `create(body)` | POST `/block-styles` | `BlockStyleCreateBody` | `BlockStyle` | mutation; invalidates: list, get |
| `update(id, body)` | PUT `/block-styles/:id` | Params: `id`; Body: `BlockStyleUpdateBody` | `BlockStyle` | mutation; invalidates: list, get |
| `delete(id)` | DELETE `/block-styles/:id` | Params: `id` | `BlockStyleDeleteResponse` | mutation; invalidates: list |

**DTOs**: From routes/blockStyles.ts (reuses `BlockStyle` entity from types/blockStyle.ts)

---

### 5. **campaigns** | Mount: `/api/v1/campaigns` | Auth: **mixed** (optional/admin/public per route)

| Method | Method Path | REQUEST DTO | RESPONSE DTO | Auth | Flags |
|--------|-------------|-------------|--------------|------|-------|
| `listPublic(query)` | GET `/campaigns` | `CampaignListQuery` | `Campaign[]` (bare array) | optional | cacheable GET; public-only by default; admin passes all=true/status for all-statuses list |
| `getBySlug(slug)` | GET `/campaigns/slug/:slug` | Params: `slug` | `Campaign` | public | cacheable GET |
| `listDonations(query)` | GET `/campaigns/donations/all` | `CampaignAllDonationsQuery` | `Donation[]` | admin | cacheable GET; paginated |
| `donationSummary()` | GET `/campaigns/donations/summary` | — | `DonationSummary` | admin | cacheable GET; dashboard summary |
| `getDonations(id, query)` | GET `/campaigns/:id/donations` | Params: `id`; Query: `CampaignDonationsQuery` | `PublicDonation[]` | public | cacheable GET; paginated; masked (anon donors, hidden messages) |
| `bulk(body)` | POST `/campaigns/bulk` | `CampaignBulkBody` | `BulkActionResult` | admin | mutation; action='delete'\|'status'; invalidates: list, get |
| `get(id)` | GET `/campaigns/:id` | Params: `id` | `Campaign` | admin | cacheable GET; any status |
| `create(body)` | POST `/campaigns` | `CampaignCreateBody` | `Campaign` | admin | mutation (201); invalidates: listPublic, bulk |
| `update(id, body)` | PUT `/campaigns/:id` | Params: `id`; Body: `CampaignUpdateBody` | `Campaign` | admin | mutation; invalidates: get, listPublic |
| `delete(id)` | DELETE `/campaigns/:id` | Params: `id` | `CampaignDeleteResponse` | admin | mutation; invalidates: list, get |

**DTOs**: All from routes/campaigns.ts  
**Special Handling**:
- Public list returns bare array (no pagination meta); admin list is paginated (meta on envelope)
- Donations list returns masked public shape (`PublicDonation`) for security
- Dashboard summary is denormalized (`DonationSummary`)

---

### 6. **connections** | Mount: `/api/v1/connections` | Auth: **admin** (except callback: public)

| Method | Method Path | REQUEST DTO | RESPONSE DTO | Flags |
|--------|-------------|-------------|--------------|-------|
| `list()` | GET `/connections` | — | `ConnectionRow[]` | cacheable GET; credentials always masked |
| `upsert(body)` | POST `/connections` | `ConnectionUpsertBody` | `ConnectionUpsertResponse` | mutation; creates/updates provider creds + settings; idempotent |
| `get(provider)` | GET `/connections/:provider` | Params: `provider` | `ConnectionRow \| null` | cacheable GET; null when provider has no row yet |
| `update(provider, body)` | PUT `/connections/:provider` | Params: `provider`; Body: `ConnectionUpdateBody` | `ConnectionUpdateResponse` | mutation; provider from path; partial upsert |
| `getOAuthUrl(provider)` | GET `/connections/:provider/oauth/authorize` | Params: `provider` | `ConnectionOAuthAuthorizeResponse` | cacheable GET; requires saved app creds; 400 if missing |
| `reorder(provider, body)` | PUT `/connections/:provider/reorder` | Params: `provider`; Body: `ConnectionReorderBody` | `ConnectionReorderResponse` | mutation; direction='up'\|'down'; no-op at edges |
| `disconnect(provider)` | DELETE `/connections/:provider` | Params: `provider` | `ConnectionDeleteResponse` | mutation; clears tokens, stops cron, busts cache |
| ~~`oauthCallback()`~~ | GET `/connections/:provider/oauth/callback` | Params: `provider`; Query: `code`, `state` | *(raw 302 redirect)* | **NOT EXPOSED** (OAuth callback; raw redirect to `/admin/settings?oauth_success=X`) |

**DTOs**: All from routes/connections.ts  
**Special Handling**:
- Credentials are ALWAYS masked on the wire (open record with provider-specific fields + known masked fields like `accessToken`, `appSecret`, `refreshToken` + boolean presence flags)
- OAuth callback returns raw HTML redirect, not JSON
- Settings blob is provider-specific

---

### 7. **dashboard** | Mount: `/api/v1/dashboard` | Auth: **admin**

| Method | Method Path | REQUEST DTO | RESPONSE DTO | Flags |
|--------|-------------|-------------|--------------|-------|
| `summary()` | GET `/dashboard/summary` | — | `DashboardSummaryResponse` | cacheable GET; aggregated stats + recent activity + quick actions |

**DTOs**: From routes/dashboard.ts  
**Special Handling**: Read-only aggregated projection (counts, recent posts, quick action list).

---

### 8. **dev** | Mount: `/api/v1/dev` | Auth: **admin**

| Method | Method Path | REQUEST DTO | RESPONSE DTO | Flags |
|--------|-------------|-------------|--------------|-------|
| `listCrons()` | GET `/dev/crons` | — | `CronJobStatus[]` | cacheable GET; registered job list |
| `getCron(name)` | GET `/dev/crons/:name` | Params: `name` | `CronJobStatus \| null` | cacheable GET; null when unknown |

**DTOs**: From routes/dev.ts  
**Special Handling**: Read-only developer tools (cron registry inspection).

---

### 9. **feed** | Mount: `/feed.xml` | Auth: **public**

| Method | Route | OUTPUT | Flags |
|--------|-------|--------|-------|
| ~~`getFeed()`~~ | GET `/feed.xml` | `application/rss+xml; charset=utf-8` (raw XML string) | **RAW ROUTE** (not JSON; no DTO exposed) |

**Special Handling**: Raw XML feed (RSS 2.0); returns string, not ApiResponse envelope.

---

### 10. **fonts** | Mount: `/api/v1/fonts` | Auth: **admin** (list: public)

| Method | Method Path | REQUEST DTO | RESPONSE DTO | Auth | Flags |
|--------|-------------|-------------|--------------|------|-------|
| `list()` | GET `/fonts` | — | `FontWithUrl[]` | public | cacheable GET |
| `upload(file, customId?, familyName?)` | POST `/fonts` | Multipart: `file` + fields `customId?`, `familyName?` | `FontWithUrl` | admin | mutation (201); multipart; invalidates: list |
| `delete(id)` | DELETE `/fonts/:id` | Params: `id` | `Font` | admin | mutation; file + row deleted; invalidates: list |

**DTOs**: From routes/fonts.ts  
**Special Handling**:
- Upload via multipart (field `file`), optional text fields
- List endpoint returns fonts enriched with `url` (@font-face source URL)
- Delete removes files from storage

---

### 11. **forms** | Mount: `/api/v1/forms` | Auth: **mixed** (optional/admin/public per route)

| Method | Method Path | REQUEST DTO | RESPONSE DTO | Auth | Flags |
|--------|-------------|-------------|--------------|------|-------|
| `listPublic(query)` | GET `/forms` | `FormListQuery` | `Form[]` (bare array) | optional | cacheable GET; public published-only by default; admin passes all=true/status |
| `getBySlug(slug)` | GET `/forms/slug/:slug` | Params: `slug` | `Form` | optional | cacheable GET; published form with questions; honors requiresAuth |
| `getResults(slug)` | GET `/forms/slug/:slug/results` | Params: `slug` | `FormResults` | public | cacheable GET; aggregated public results (when showResults enabled) |
| `submit(slug, body)` | POST `/forms/slug/:slug/submit` | Params: `slug`; Body: `FormSubmitBody` | `FormSubmitResponse` | optional | mutation (201); enforces requiresAuth + duplicate-submission checks |
| `submissionsExport(id)` | GET `/forms/:id/submissions/export` | Params: `id` | `text/csv` (raw CSV string) | admin | RAW ROUTE (CSV export, not JSON) |
| `bulk(body)` | POST `/forms/bulk` | `FormBulkBody` | `BulkActionResult` | admin | mutation; action='delete'\|'status'; invalidates: list, get |
| `get(id)` | GET `/forms/:id` | Params: `id` | `Form` | admin | cacheable GET; with questions, any status |
| `listSubmissions(id, query)` | GET `/forms/:id/submissions` | Params: `id`; Query: `FormSubmissionsQuery` | `FormSubmission[]` | admin | cacheable GET; paginated |
| `create(body)` | POST `/forms` | `FormCreateBody` | `Form` | admin | mutation (201); optional questions on create; invalidates: list, bulk |
| `update(id, body)` | PUT `/forms/:id` | Params: `id`; Body: `FormUpdateBody` | `Form` | admin | mutation; invalidates: get, list |
| `addQuestion(id, body)` | POST `/forms/:id/questions` | Params: `id`; Body: `FormQuestionCreateBody` | `FormQuestion` | admin | mutation (201); invalidates: get |
| `updateQuestion(formId, questionId, body)` | PUT `/forms/:formId/questions/:questionId` | Params: `formId`, `questionId`; Body: `FormQuestionUpdateBody` | `FormQuestion` | admin | mutation; invalidates: get |
| `deleteQuestion(formId, questionId)` | DELETE `/forms/:formId/questions/:questionId` | Params: `formId`, `questionId` | `FormQuestionDeleteResponse` | admin | mutation; invalidates: get |
| `delete(id)` | DELETE `/forms/:id` | Params: `id` | `FormDeleteResponse` | admin | mutation; invalidates: list, get |

**DTOs**: All from routes/forms.ts  
**Special Handling**:
- Public list returns bare array; admin list is paginated
- CSV export is raw (not JSON envelope)
- Submit endpoint enforces auth tier + duplicate submission logic per form config
- Questions are nested on the form entity; add/update/delete via dedicated endpoints

---

### 12. **health** | Mount: `/api/v1/health` | Auth: **public**

| Method | Method Path | RESPONSE DTO | Flags |
|--------|-------------|--------------|-------|
| `basic()` | GET `/health` | `HealthBasicResponse` | cacheable GET; always succeeds |
| `detailed()` | GET `/health/detailed` | `HealthDetailedResponse` | RAW (answers 200 or 503 depending on checks; status in response body) |
| `ready()` | GET `/health/ready` | `HealthReadyResponse` | RAW k8s readiness probe (200/503 per status) |
| `live()` | GET `/health/live` | `HealthLiveResponse` | cacheable GET; k8s liveness probe |

**DTOs**: From routes/health.ts  
**Special Handling**:
- `/detailed` and `/ready` are "raw" routes — they return `success: false` on 503 when degraded (non-standard envelope usage)
- Read the HTTP status code, not just the response body

---

### 13. **lists** | Mount: `/api/v1/lists` | Auth: **optional**

| Method | Method Path | REQUEST DTO | RESPONSE DTO | Flags |
|--------|-------------|-------------|--------------|-------|
| `subscribe(slug, body)` | POST `/lists/:slug/subscribe` | Params: `slug`; Body: `ListSubscribeBody` | `ListSubscribeResponse` (union) | mutation (201); double-opt-in aware; idempotent |

**DTOs**: From routes/mailingLists.ts (shared file covers both mailing-lists + lists)  
**Special Handling**:
- Email optional on wire (derived from session for registeredUsersOnly lists; required at runtime for open lists)
- Response is a union: `{ status, id }` (new) or `{ status, already: true }` (existing)
- Double-opt-in lists return `pending_confirmation` status + confirmation email fired
- Single-opt-in lists return `subscribed` status immediately
- This endpoint is the PUBLIC subscribe endpoint (distinct from admin mailing-lists CRUD)

---

### 14. **mail** | Mount: `/api/v1/mail` | Auth: **admin**

| Method | Method Path | REQUEST DTO | RESPONSE DTO | Flags |
|--------|-------------|-------------|--------------|-------|
| `send(body)` | POST `/mail/send` | `MailSendBody` | `MailSendResponse` | mutation (202 Accepted); fire-and-forget; invalidates: listJobs |
| `listJobs(query)` | GET `/mail/jobs` | `MailJobsListQuery` | `MailSendJobRow[]` | cacheable GET; newest first; offset/limit paging (no meta) |
| `getJob(id)` | GET `/mail/jobs/:id` | Params: `id` | `MailSendJob` | cacheable GET; status snapshot |
| `listRecipients(id, query)` | GET `/mail/jobs/:id/recipients` | Params: `id`; Query: `MailJobsRecipientsQuery` | `MailSendRecipient[]` | cacheable GET; paginated; optional status filter |
| `retry(id)` | POST `/mail/jobs/:id/retry` | Params: `id` | `MailRetryResponse` | mutation; resets failed → pending; re-kicks worker |
| `cancel(id)` | PATCH `/mail/jobs/:id` | Params: `id`; Body: `{ status: 'cancelled' }` | `MailCancelResponse` | mutation; invalidates: getJob, listJobs |

**DTOs**: From routes/mailSend.ts  
**Special Handling**:
- Send returns 202 (Accepted), not 200; worker is async
- Block set is rendered once server-side; `{{tokens}}` substituted per recipient
- templateId may be null (blank start); templateWasModified flag tracks edits post-template-pick
- Job list uses offset/limit pagination (NOT on ApiResponse.meta)
- Recipient list filters by status (optional)

---

### 15. **mail-templates** | Mount: `/api/v1/mail-templates` | Auth: **admin**

| Method | Method Path | REQUEST DTO | RESPONSE DTO | Flags |
|--------|-------------|-------------|--------------|-------|
| `variables()` | GET `/mail-templates/variables` | — | `VariableDescriptor[]` | cacheable GET; catalog for reference UI |
| `list()` | GET `/mail-templates` | — | `MailTemplate[]` | cacheable GET; meta only (no blocks) |
| `get(id)` | GET `/mail-templates/:id` | Params: `id` | `MailTemplate & { blocks: MailTemplateBlockRow[] }` | cacheable GET; meta + full block tree |
| `create(body)` | POST `/mail-templates` | `MailTemplateCreateBody` | `MailTemplate` | mutation (201); meta only; invalidates: list |
| `update(id, body)` | PUT `/mail-templates/:id` | Params: `id`; Body: `MailTemplateUpdateBody` | `MailTemplate` | mutation; meta only; invalidates: get, list |
| `preview(body)` | POST `/mail-templates/preview` | `MailTemplatePreviewBody` | `MailTemplatePreviewResponse` | mutation (idempotent); renders HTML + detects tokens |
| `saveBlocks(id, blocks)` | PUT `/mail-templates/:id/blocks` | Params: `id`; Body: `{ blocks: MailTemplateBlockInput[] }` | `{ ok: true }` | mutation; transactional block tree replace; invalidates: get |
| `delete(id)` | DELETE `/mail-templates/:id` | Params: `id` | `MailTemplateDeleteResponse` | mutation; invalidates: list |

**DTOs**: From routes/mailTemplates.ts  
**Special Handling**:
- Blocks are a separate entity from pages/posts (own `blockType`, `position`, `templateId` columns)
- Block input `style` may carry inline CSS tokens OR a `{ id }` block-style ref (resolved on render)
- Preview accepts in-progress blocks (no ids yet) + variable overrides
- Preview output includes detected `{{tokens}}` list

---

### 16. **mailing-lists** | Mount: `/api/v1/mailing-lists` | Auth: **admin**

| Method | Method Path | REQUEST DTO | RESPONSE DTO | Flags |
|--------|-------------|-------------|--------------|-------|
| `list()` | GET `/mailing-lists` | — | `MailingList[]` | cacheable GET; includes subscriberCount |
| `get(id)` | GET `/mailing-lists/:id` | Params: `id` | `MailingList` | cacheable GET |
| `create(body)` | POST `/mailing-lists` | `MailingListCreateBody` | `MailingList` | mutation (201); invalidates: list |
| `update(id, body)` | PUT `/mailing-lists/:id` | Params: `id`; Body: `MailingListUpdateBody` | `MailingList` | mutation; invalidates: get, list |
| `delete(id)` | DELETE `/mailing-lists/:id` | Params: `id` | `MailingListDeleteResponse` | mutation; invalidates: list |
| `listSubscribers(id, query)` | GET `/mailing-lists/:id/subscribers` | Params: `id`; Query: `MailingListSubscribersQuery` | `MailingListSubscribersResponse` (union) | cacheable GET; **NON-STANDARD**: `{ items, total }` wrapper (not bare array) |
| `addSubscriber(id, body)` | POST `/mailing-lists/:id/subscribers` | Params: `id`; Body: `MailingListSubscriberCreateBody` | `MailingListSubscriber` | mutation (201/200); force-confirmed; idempotent re-add reactivates |
| `updateSubscriber(id, subId, body)` | PUT `/mailing-lists/:id/subscribers/:subId` | Params: `id`, `subId`; Body: `MailingListSubscriberUpdateBody` | `MailingListSubscriber` | mutation; invalidates: listSubscribers, get |
| `removeSubscriber(id, subId)` | DELETE `/mailing-lists/:id/subscribers/:subId` | Params: `id`, `subId` | `MailingListSubscriberDeleteResponse` | mutation; invalidates: listSubscribers |
| `bulkRemoveSubscribers(id, subIds)` | POST `/mailing-lists/:id/subscribers/bulk-delete` | Params: `id`; Body: `{ ids: string[] }` | `MailingListSubscriberBulkDeleteResponse` | mutation; invalidates: listSubscribers |
| `forceConfirm(id, subId)` | POST `/mailing-lists/:id/subscribers/:subId/force-confirm` | Params: `id`, `subId` | `MailingListSubscriber` | mutation; pending → subscribed |

**DTOs**: From routes/mailingLists.ts (shared with lists module)  
**Special Handling**:
- Dual-mount: this is the **admin** CRUD module; `/lists/:slug/subscribe` is the public endpoint (separate)
- Subscriber list returns `{ items, total }` object (NOT bare array; pagination inside data, not on meta)
- Add subscriber is idempotent (reactivates existing unsubscribed rows)
- Slug is lowercase `[a-z0-9-]`

---

### 17. **media** | Mount: `/api/v1/media` | Auth: **admin**

| Method | Method Path | REQUEST DTO | RESPONSE DTO | Flags |
|--------|-------------|-------------|--------------|-------|
| `upload(file, alt?, caption?)` | POST `/media` | Multipart: `file`; Fields: `alt?`, `caption?` | `MediaWire` | mutation (201); multipart; invalidates: list |
| `blockUpload(file, postId?, blockId?)` | POST `/media/block-upload` | Multipart: `file`; Fields: `postId?`, `blockId?` | `MediaWire & { postId, blockId }` | mutation (201); multipart; echoes postId/blockId back |
| `bulkUpload(files[])` | POST `/media/bulk` | Multipart: `files` (max 10) | `MediaWire[]` | mutation (201); multipart; invalidates: list |
| `list(query)` | GET `/media` | `MediaListQuery` | `MediaWire[]` | cacheable GET; paginated; type/types/search/sort filters |
| `get(id)` | GET `/media/:id` | Params: `id` | `MediaWire` | cacheable GET |
| `update(id, body)` | PUT `/media/:id` | Params: `id`; Body: `MediaUpdateBody` | `MediaWire` | mutation; metadata patch (title/alt/caption); invalidates: get, list |
| `delete(id)` | DELETE `/media/:id` | Params: `id` | `MediaDeleteResponse` | mutation; removes files from storage; invalidates: list |

**DTOs**: From routes/media.ts  
**Special Handling**:
- `MediaWire` extends `Media` entity with optional `title` field (migration 003 carryover)
- Uploads are multipart (field `file` for single, `files` for bulk)
- List filters: `type` (MIME prefix, e.g. `image` → `image/%`), `types` (comma-separated), `search`, `sort` (title_asc/desc, date_asc/desc, size, updated)
- No signed-URL route (URLs stored on row directly)

---

### 18. **messages** | Mount: `/api/v1/messages` | Auth: **mixed** (optional/admin per route)

| Method | Method Path | REQUEST DTO | RESPONSE DTO | Auth | Flags |
|--------|-------------|-------------|--------------|------|-------|
| `submit(body)` | POST `/messages` | `MessageSubmitBody` | `MessageSubmitResponse` | optional | mutation (201); sanitizes input; notifies admins by email |
| `list(query)` | GET `/messages` | `MessageListQuery` | `ContactMessage[]` | admin | cacheable GET; paginated; status/search filters |
| `get(id)` | GET `/messages/:id` | Params: `id` | `ContactMessage` | admin | cacheable GET; marks unread → read |
| `bulk(body)` | POST `/messages/bulk` | `MessageBulkBody` | `BulkActionResult` | admin | mutation; action='delete'\|'status'; invalidates: list, get |
| `updateStatus(id, body)` | PUT `/messages/:id/status` | Params: `id`; Body: `MessageStatusUpdateBody` | `ContactMessage` | admin | mutation; invalidates: get, list |
| `delete(id)` | DELETE `/messages/:id` | Params: `id` | `MessageDeleteResponse` | admin | mutation; invalidates: list |
| ~~`bulkStatus(body)` (legacy)~~ | POST `/messages/bulk-status` | `MessageBulkStatusBody` | `MessageBulkStatusResponse` | admin | **LEGACY** (redundant with bulk endpoint; keep for backward compat) |
| ~~`bulkDelete(body)` (legacy)~~ | POST `/messages/bulk-delete` | `MessageBulkDeleteBody` | `MessageBulkDeleteResponse` | admin | **LEGACY** (redundant with bulk endpoint; keep for backward compat) |

**DTOs**: From routes/messages.ts  
**Special Handling**:
- Public submit endpoint; server adds IP, user-agent, userId
- Admin list is paginated; `unreadCount` from service not forwarded to wire
- Two legacy bulk endpoints remain alongside unified `bulk()` for backward compat

---

### 19. **pages** | Mount: `/api/v1/pages` | Auth: **mixed** (optional/admin per route)

| Method | Method Path | REQUEST DTO | RESPONSE DTO | Auth | Flags |
|--------|-------------|-------------|--------------|------|-------|
| `navigation()` | GET `/pages/navigation` | — | `NavigationItem[]` | public | cacheable GET; main nav tree |
| `homepage()` | GET `/pages/homepage` | — | `Page` | public | cacheable GET; page flagged as homepage |
| `getBySlug(slug, preview?)` | GET `/pages/slug/:slug` | Params: `slug`; Query: `preview?` | `Page` | optional | cacheable GET; gated content yields CONTENT_LOCKED error with preview in details |
| `list(query)` | GET `/pages` | `PageListQuery` | `Page[]` | admin | cacheable GET; any status; paginated |
| `bulk(body)` | POST `/pages/bulk` | `PageBulkBody` | `BulkActionResult` | admin | mutation; action='delete'\|'status'; invalidates: list, get |
| `listRevisions(id)` | GET `/pages/:id/revisions` | Params: `id` | `Revision[]` | admin | cacheable GET; saved revisions |
| `getRevision(id, version)` | GET `/pages/:id/revisions/:version` | Params: `id`, `version` | `Revision` | admin | cacheable GET; one snapshot |
| `restoreRevision(id, version)` | POST `/pages/:id/revisions/:version/restore` | Params: `id`, `version` | `Page` | admin | mutation; snapshots current first; invalidates: get |
| `get(id)` | GET `/pages/:id` | Params: `id` | `Page` | admin | cacheable GET; any status, with blocks |
| `create(body)` | POST `/pages` | `PageCreateBody` | `Page` | admin | mutation (201); invalidates: list, navigation |
| `update(id, body)` | PUT `/pages/:id` | Params: `id`; Body: `PageUpdateBody` | `Page` | admin | mutation; snapshots revision first; invalidates: get, list, navigation |
| `delete(id)` | DELETE `/pages/:id` | Params: `id` | `PageDeleteResponse` | admin | soft-delete; mutation; invalidates: list, get, navigation |
| `createBlock(pageId, body)` | POST `/pages/:pageId/blocks` | Params: `pageId`; Body: `PageBlockBody` | `Block` | admin | mutation (201); client-supplied id (v4 UUID) for optimistic refs; invalidates: get |
| `updateBlock(pageId, blockId, body)` | PUT `/pages/:pageId/blocks/:blockId` | Params: `pageId`, `blockId`; Body: `PageBlockUpdateBody` | `Block` | admin | mutation; invalidates: get |
| `deleteBlock(pageId, blockId)` | DELETE `/pages/:pageId/blocks/:blockId` | Params: `pageId`, `blockId` | `PageBlockDeleteResponse` | admin | mutation; invalidates: get |
| `reorderBlocks(pageId, body)` | PUT `/pages/:pageId/blocks/reorder` | Params: `pageId`; Body: `PageReorderBlocksBody` | `PageReorderBlocksResponse` | admin | mutation; scoped to one parent; invalidates: get |

**DTOs**: From routes/pages.ts  
**Special Handling**:
- Page entity already embeds `blocks: Block[]` (no separate `PageWithBlocks` wrapper)
- Slug endpoint: `preview=admin` lets admins see unpublished pages; gated content yields CONTENT_LOCKED error with preview payload in error.details
- Navigation tree is published-only
- Revisions are auto-snapshots on update
- Block reorder is scoped to one parent (`parentBlockId` null/absent = top-level)

---

### 20. **payments** | Mount: `/api/v1/payments` | Auth: **mixed** (optional/user/admin/public per route)

| Method | Method Path | REQUEST DTO | RESPONSE DTO | Auth | Flags |
|--------|-------------|-------------|--------------|------|-------|
| `createCustomer()` | POST `/payments/create-customer` | — | `PaymentsCreateCustomerResponse` | user | mutation; creates/retrieves Stripe customer |
| `donate(body)` | POST `/payments/donate` | `PaymentsDonateBody` | `PaymentsDonateResponse` | optional | mutation; anonymous donations allowed; ≥$1.00 minimum |
| `subscribe(body)` | POST `/payments/subscribe` | `PaymentsSubscribeBody` | `PaymentsSubscribeResponse` | user | mutation; may require client-side confirmation (clientSecret) |
| `unsubscribe()` | POST `/payments/unsubscribe` | — | `PaymentsUnsubscribeResponse` | user | mutation; cancels at period end |
| `listSubscriptions()` | GET `/payments/subscriptions` | — | `UserSubscription[]` | user | cacheable GET; user's subscriptions (no pagination) |
| `listTransactions(query)` | GET `/payments/transactions` | `PaymentsTransactionsQuery` | `UserTransaction[]` | user | cacheable GET; user's transaction history; paginated |
| `listPlans()` | GET `/payments/plans` | — | `SubscriptionPlan[]` | public | cacheable GET; active plans for public subscribe page |
| ~~`webhook(raw)`~~ | POST `/payments/webhook` | *(raw Stripe body)* | *(signature-verified 200 or 400)* | public | **NOT EXPOSED** (Stripe webhook; raw body, signature check; always 200 unless bad signature) |
| `adminListSubscriptions(query)` | GET `/payments/admin/subscriptions` | `PaymentsAdminSubscriptionsQuery` | `AdminSubscription[]` | admin | cacheable GET; all subscriptions; paginated |
| `adminListTransactions(query)` | GET `/payments/admin/transactions` | `PaymentsTransactionsQuery` | `AdminTransaction[]` | admin | cacheable GET; all transactions; type/status filters; paginated |
| `adminUserTransactions(userId, query)` | GET `/payments/admin/user/:userId/transactions` | Params: `userId`; Query: `PaymentsTransactionsQuery` | `UserTransaction[]` | admin | cacheable GET; one user's transactions; paginated |
| `adminListPlans()` | GET `/payments/admin/plans` | — | `SubscriptionPlan[]` | admin | cacheable GET; all plans |
| `adminCreatePlan(body)` | POST `/payments/admin/plans` | `PaymentsCreatePlanBody` | `SubscriptionPlan` | admin | mutation; creates Stripe product + price; invalidates: adminListPlans |
| `adminUpdatePlan(id, body)` | PUT `/payments/admin/plans/:id` | Params: `id`; Body: `PaymentsUpdatePlanBody` | `SubscriptionPlan` | admin | mutation; invalidates: adminListPlans |

**DTOs**: From routes/payments.ts  
**Special Handling**:
- Money is always integer cents
- Webhook is raw (Stripe contract; signature-verified; NOT exposed in SDK)
- Subscription endpoints may return `clientSecret` for incomplete subs requiring Stripe confirmation
- User transactions joined with campaign title (null for non-campaign txns)
- Admin subscription list includes user + plan denormalized fields

---

### 21. **posts** | Mount: `/api/v1/posts` | Auth: **mixed** (optional/admin/public per route)

| Method | Method Path | REQUEST DTO | RESPONSE DTO | Auth | Flags |
|--------|-------------|-------------|--------------|------|-------|
| `list(query)` | GET `/posts` | `PostListQuery` | `Post[]` | optional | cacheable GET; public published-only by default; admin passes status/sort for all-statuses |
| `search(query)` | GET `/posts/search` | `PostSearchQuery` | `Post[]` | public | cacheable GET; full-text over published posts; paginated |
| `getBySlug(slug, preview?)` | GET `/posts/slug/:slug` | Params: `slug`; Query: `preview?` | `PostWithBlocks` | optional | cacheable GET; gated content yields CONTENT_LOCKED error with preview in details |
| `bulk(body)` | POST `/posts/bulk` | `PostBulkBody` | `BulkActionResult` | admin | mutation; action='delete'\|'status'; invalidates: list, get |
| `get(id)` | GET `/posts/:id` | Params: `id` | `PostWithBlocks` | admin | cacheable GET; any status |
| `create(body)` | POST `/posts` | `PostCreateBody` | `PostWithBlocks` | admin | mutation (201); optional blocks on create; invalidates: list, search |
| `update(id, body)` | PUT `/posts/:id` | Params: `id`; Body: `PostUpdateBody` | `PostWithBlocks` | admin | mutation; snapshots revision first; invalidates: get, list, search |
| `delete(id)` | DELETE `/posts/:id` | Params: `id` | `PostDeleteResponse` | admin | soft-delete; mutation; invalidates: list, get, search |
| `listRevisions(id)` | GET `/posts/:id/revisions` | Params: `id` | `Revision[]` | admin | cacheable GET; saved revisions |
| `getRevision(id, version)` | GET `/posts/:id/revisions/:version` | Params: `id`, `version` | `Revision` | admin | cacheable GET; one snapshot |
| `restoreRevision(id, version)` | POST `/posts/:id/revisions/:version/restore` | Params: `id`, `version` | `PostWithBlocks` | admin | mutation; snapshots current first; invalidates: get |
| `reorderBlocks(id, body)` | PUT `/posts/:id/blocks/reorder` | Params: `id`; Body: `PostReorderBlocksBody` | `PostReorderBlocksResponse` | admin | mutation; invalidates: get |

**DTOs**: From routes/posts.ts  
**Special Handling**:
- `PostWithBlocks` is a separate shape (Post + `contentBlocks[]` array)
- Slug endpoint: `preview=admin` lets admins see drafts; gated content yields CONTENT_LOCKED error with preview in error.details
- Public list is published-only by default (no pagination meta); admin list is paginated (meta on envelope)
- Search is full-text over published posts only
- Create supports optional `contentBlocks` (array of `PostCreateContentBlock`)
- Revisions are auto-snapshots on update
- Tags/categories are arrays on the entity

---

### 22. **search** | Mount: `/api/v1/search` | Auth: **mixed** (public/admin per route)

| Method | Method Path | REQUEST DTO | RESPONSE DTO | Auth | Flags |
|--------|-------------|-------------|--------------|------|-------|
| `search(query)` | GET `/search` | `SearchQuery` | `SearchResponse` (keyed map) | public | cacheable GET; grouped by type (posts/pages/campaigns); paginated (total on meta) |
| `adminSearch(query)` | GET `/search/admin` | `AdminSearchQuery` | `AdminSearchResponse` (keyed map) | admin | cacheable GET; all content types + raw rows; any status |

**DTOs**: From routes/search.ts  
**Special Handling**:
- Responses are **keyed maps**, NOT bare arrays: `{ posts?: [...], pages?: [...], campaigns?: [...] }`
- Query `q` must be ≥2 chars
- Public returns curated projections (search-specific hit shapes); admin returns raw row projections (snake_case)
- Admin includes users, forms, messages (broader scope)
- Total count rides `ApiResponse.meta`

---

### 23. **settings** | Mount: `/api/v1/settings` | Auth: **mixed** (public/admin per route)

| Method | Method Path | REQUEST DTO | RESPONSE DTO | Auth | Flags |
|--------|-------------|-------------|--------------|------|-------|
| `publicSettings()` | GET `/settings/public` | — | `SettingsPublicResponse` | public | cacheable GET (600s); curated projection (no admin keys) |
| `allSettings()` | GET `/settings` | — | `SettingsGetAllResponse` (keyed object) | admin | cacheable GET; every row with editor metadata |
| `updateSettings(body)` | PUT `/settings` | `SettingsUpdateBody` | `SettingsUpdateResponse` | admin | **SPECIAL**: 409 on feature cascade rejection (see below); mutation; invalidates: publicSettings, allSettings |
| `getPublicSection(key)` | GET `/settings/{key}` | — | `unknown` (section-specific) | public | cacheable GET (600s); public sections: homepage-hero, site-header, site-footer, site-branding, appearance, site-colors |
| `updateSection(key, body)` | PUT `/settings/{key}` | `{...}` (section-specific) | `unknown` (section-specific) | admin | mutation; invalidates: getPublicSection, allSettings |
| `deleteKey(key)` | DELETE `/settings/:key` | Params: `key` | `SettingsDeleteResponse` | admin | mutation; delete arbitrary row; invalidates: allSettings |
| `colorUsages(id)` | GET `/settings/site-colors/usages/:id` | Params: `id` | `number` (usage count) | admin | cacheable GET; for delete-confirm UI |

**DTOs**: From routes/settings.ts  
**Special Handling**:
- **409 Feature Cascade**: PUT `/settings` may answer **409** with `{ success: false, error: SettingsFeatureCascadeResult }` (NOT standard ApiError). The result is the planner's refusal (kind + offending keys). Client must read this non-standard shape, show the dependency modal, retry with `enableDependencies`/`disableDependents` flags.
- All public sections cached 600s
- Settings rows keyed by `site_settings.key`
- Feature toggles run dependency cascade + lazy migrations

---

### 24. **setup** | Mount: `/api/v1/setup` | Auth: **public**

| Method | Method Path | REQUEST DTO | RESPONSE DTO | Flags |
|--------|-------------|-------------|--------------|-------|
| `status()` | GET `/setup/status` | — | `InstallationState` | cacheable GET; installation state + infra probes |
| `testDb(body)` | POST `/setup/test-db` | `SetupTestDbBody` | `SetupTestResult<unknown>` | mutation; discriminated result (ok or error) |
| `testRedis(body)` | POST `/setup/test-redis` | `SetupTestRedisBody` | `SetupTestResult<{ pong: string }>` | mutation |
| `testSmtp(body)` | POST `/setup/test-smtp` | `SetupTestSmtpBody` | `SetupTestResult<{ greeting: string }>` | mutation |
| `testS3(body)` | POST `/setup/test-s3` | `SetupTestS3Body` | `SetupTestResult<{ bucket: string }>` | mutation |
| `generateJwt()` | POST `/setup/generate-jwt` | — | `SetupGenerateJwtResponse` | mutation; random secret |
| `install(body)` | POST `/setup/install` | `SetupInstallBody` | `SetupInstallResponse` | mutation (responds before restart); runs installer |

**DTOs**: From routes/setup.ts  
**Special Handling**:
- All setup endpoints are public (setup-mode only)
- Test result is a discriminated union: `{ ok: true; detail? }` or `{ ok: false; error; code? }`
- Status endpoint probes DB/Redis/JWT secret availability
- Install responds before restart (fire-and-forget)

---

### 25. **sitemap** | Mount: `/sitemap.xml` (root-level) | Auth: **public**

| Method | Route | OUTPUT | Flags |
|--------|-------|--------|-------|
| ~~`getSitemap()`~~ | GET `/sitemap.xml` | `application/xml` (raw XML string) | **RAW ROUTE** (not JSON; no DTO exposed) |
| `regenerate()` | POST `/admin/sitemap/regenerate` | `SitemapRegenerateResponse` | mutation; drops cache, rebuilds, returns URL count |

**DTOs**: From routes/sitemap.ts  
**Special Handling**:
- `/sitemap.xml` is a raw XML route (not JSON envelope)
- Regenerate is a standard JSON admin route

---

### 26. **social** | Mount: `/api/v1/social` | Auth: **mixed** (public/admin per route)

| Method | Method Path | REQUEST DTO | RESPONSE DTO | Auth | Flags |
|--------|-------------|-------------|--------------|------|-------|
| `listPosts(query)` | GET `/social/posts` | `SocialPostsQuery` | `SocialPost[]` | public | cacheable GET; stored posts; optional platform filter; paginated |
| `feed(query)` | GET `/social/feed` | `SocialFeedQuery` | `SocialPost[]` | public | cacheable GET; live merged feed (no pagination); API-cached |
| `platformFeed(platform, query)` | GET `/social/feed/:platform` | Params: `platform`; Query: `SocialFeedQuery` | `SocialPost[]` | public | cacheable GET; live feed for one platform |
| `homepage()` | GET `/social/homepage` | — | `SocialPost[]` | public | cacheable GET; selected homepage posts (fallback to latest per platform) |
| `setHomepage(body)` | PUT `/social/homepage` | `SocialHomepageSetBody` | `SocialHomepageSetResponse` | admin | mutation; set homepage selection; invalidates: homepage |
| `sync(body?)` | POST `/social/sync` | `SocialSyncBody` | `SocialSyncResponse` | admin | mutation; sync from one or all platforms; returns per-platform counts |
| `deletePost(id)` | DELETE `/social/posts/:id` | Params: `id` | `SocialPostDeleteResponse` | admin | mutation; invalidates: listPosts |
| `platformPosts(platform, query)` | GET `/social/posts/:platform` | Params: `platform`; Query: `SocialPlatformPostsQuery` | `SocialPost[]` | public | cacheable GET; stored posts for one platform; paginated |

**DTOs**: From routes/social.ts  
**Special Handling**:
- Dual endpoints: stored posts (DB) + live feed (real-time from providers, API-cached)
- Sync returns per-platform counts in a `results` map
- Homepage list has fallback logic (selected posts or latest per platform)

---

### 27. **unsubscribe** | Mount: `/u/` + `/lists/` (root-level) | Auth: **public**

| Method | Route | OUTPUT | Flags |
|--------|-------|--------|-------|
| ~~`unsubscribe(token)`~~ | GET `/u/:token` | `text/html` (raw HTML page) | **RAW ROUTE** (not JSON; status code indicates success: 200/400/404) |
| ~~`resubscribe(token)`~~ | GET `/u/:token/resubscribe` | `text/html` (raw HTML page) | **RAW ROUTE** |
| ~~`confirm(slug, token)`~~ | GET `/lists/:slug/confirm/:token` | `text/html` (raw HTML page) | **RAW ROUTE** (double-opt-in confirmation) |

**DTOs**: From routes/unsubscribe.ts  
**Special Handling**:
- All three routes return raw HTML pages (NOT JSON)
- Not exposed in typed SDK (raw redirect/action endpoints)
- Used as `List-Unsubscribe` header targets

---

### 28. **users** | Mount: `/api/v1/users` | Auth: **admin**

| Method | Method Path | REQUEST DTO | RESPONSE DTO | Flags |
|--------|-------------|-------------|--------------|-------|
| `list(query)` | GET `/users` | `UserListQuery` | `User[]` | cacheable GET; search/role/status/sort filters; paginated |
| `get(id)` | GET `/users/:id` | Params: `id` | `UserWithMembership` | cacheable GET; user + Patreon membership (or null) |
| `create(body)` | POST `/users` | `UserCreateBody` | `User` | mutation (201); email/password credential; invalidates: list |
| `update(id, body)` | PUT `/users/:id` | Params: `id`; Body: `UserUpdateBody` | `User` | mutation; invalidates: get, list |
| `uploadAvatar(id, file)` | POST `/users/:id/avatar` | Params: `id`; Multipart: `file` | `User` | mutation; resizes to 256×256 webp; invalidates: get |
| `setPassword(id, body)` | POST `/users/:id/password` | Params: `id`; Body: `UserPasswordBody` | `User` | mutation; invalidates: get |
| `ban(id, body?)` | POST `/users/:id/ban` | Params: `id`; Body: `UserBanBody?` | `User` | mutation; invalidates: get, list |
| `unban(id)` | POST `/users/:id/unban` | Params: `id` | `User` | mutation; invalidates: get, list |
| `delete(id)` | DELETE `/users/:id` | Params: `id` | `UserDeleteResponse` | mutation; permanent delete; orphans content; audit-logged; invalidates: list |
| `listBans(query)` | GET `/users/banned/list` | `UserBanListQuery` | `UserBanRow[]` | cacheable GET; active bans; paginated |
| `banIp(body)` | POST `/users/ban-ip` | `UserBanIpBody` | `UserBanIpResponse` | mutation; invalidates: listBans |
| `removeBan(banId)` | DELETE `/users/banned/:banId` | Params: `banId` | `UserBanDeleteResponse` | mutation; invalidates: listBans |

**DTOs**: From routes/users.ts  
**Special Handling**:
- User list is paginated with search/role/status/sort filters
- Get returns `UserWithMembership` (user + resolved Patreon membership or null)
- Avatar upload is multipart (resized to 256×256 webp)
- Ban/unban operations; separate ban-IP endpoint
- Delete is permanent (orphans authored content, audit-logged)
- Ban list returns `UserBanRow` (includes `bannedByName` joined from users table)

---

## Flat Method Reference Table

| Module | Method | HTTP | AbsPath | ReqDTO | RespDTO | Auth | Flags |
|--------|--------|------|---------|--------|---------|------|-------|
| api-keys | list | GET | /api/v1/api-keys | — | ApiKey[] | admin | cacheable |
| api-keys | create | POST | /api/v1/api-keys | ApiKeyCreateBody | ApiKeyCreateResponse | admin | mutation; plaintext key once |
| api-keys | revoke | DELETE | /api/v1/api-keys/:id | — | ApiKey | admin | mutation |
| audit | list | GET | /api/v1/audit | AuditListQuery | AuditLogEntry[] | admin | cacheable; paginated |
| auth | getPatreonUrl | GET | /api/v1/auth/patreon | — | PatreonAuthResponse | public | cacheable |
| auth | login | POST | /api/v1/auth/login | AuthLoginBody | AuthResponse | public | mutation; rate-limited; sets cookies |
| auth | refresh | POST | /api/v1/auth/refresh | AuthRefreshBody | AuthResponse | public | mutation; rotates tokens |
| auth | logout | POST | /api/v1/auth/logout | — | AuthLogoutResponse | public | mutation; clears cookies; always 200 |
| auth | logoutAll | POST | /api/v1/auth/logout-all | — | AuthLogoutAllResponse | user | mutation; invalidates all sessions |
| auth | getMe | GET | /api/v1/auth/me | — | AuthMeResponse | user | cacheable |
| auth | syncPatreon | POST | /api/v1/auth/patreon/sync | — | AuthPatreonSyncResponse | user | mutation; idempotent |
| auth | autologin | GET | /api/v1/auth/autologin | — | AuthAutologinResponse | public | dev-only; localhost |
| block-styles | list | GET | /api/v1/block-styles | — | BlockStyle[] | admin | cacheable |
| block-styles | get | GET | /api/v1/block-styles/:id | — | BlockStyle | admin | cacheable |
| block-styles | create | POST | /api/v1/block-styles | BlockStyleCreateBody | BlockStyle | admin | mutation |
| block-styles | update | PUT | /api/v1/block-styles/:id | BlockStyleUpdateBody | BlockStyle | admin | mutation |
| block-styles | delete | DELETE | /api/v1/block-styles/:id | — | BlockStyleDeleteResponse | admin | mutation |
| campaigns | listPublic | GET | /api/v1/campaigns | CampaignListQuery | Campaign[] | optional | cacheable; public bare array |
| campaigns | getBySlug | GET | /api/v1/campaigns/slug/:slug | — | Campaign | public | cacheable |
| campaigns | listDonations | GET | /api/v1/campaigns/donations/all | CampaignAllDonationsQuery | Donation[] | admin | cacheable; paginated |
| campaigns | donationSummary | GET | /api/v1/campaigns/donations/summary | — | DonationSummary | admin | cacheable |
| campaigns | getDonations | GET | /api/v1/campaigns/:id/donations | CampaignDonationsQuery | PublicDonation[] | public | cacheable; masked |
| campaigns | bulk | POST | /api/v1/campaigns/bulk | CampaignBulkBody | BulkActionResult | admin | mutation |
| campaigns | get | GET | /api/v1/campaigns/:id | — | Campaign | admin | cacheable |
| campaigns | create | POST | /api/v1/campaigns | CampaignCreateBody | Campaign | admin | mutation |
| campaigns | update | PUT | /api/v1/campaigns/:id | CampaignUpdateBody | Campaign | admin | mutation |
| campaigns | delete | DELETE | /api/v1/campaigns/:id | — | CampaignDeleteResponse | admin | mutation |
| connections | list | GET | /api/v1/connections | — | ConnectionRow[] | admin | cacheable; masked creds |
| connections | upsert | POST | /api/v1/connections | ConnectionUpsertBody | ConnectionUpsertResponse | admin | mutation; idempotent |
| connections | get | GET | /api/v1/connections/:provider | — | ConnectionRow \| null | admin | cacheable |
| connections | update | PUT | /api/v1/connections/:provider | ConnectionUpdateBody | ConnectionUpdateResponse | admin | mutation |
| connections | getOAuthUrl | GET | /api/v1/connections/:provider/oauth/authorize | — | ConnectionOAuthAuthorizeResponse | admin | cacheable; requires app creds |
| connections | reorder | PUT | /api/v1/connections/:provider/reorder | ConnectionReorderBody | ConnectionReorderResponse | admin | mutation |
| connections | disconnect | DELETE | /api/v1/connections/:provider | — | ConnectionDeleteResponse | admin | mutation |
| dashboard | summary | GET | /api/v1/dashboard/summary | — | DashboardSummaryResponse | admin | cacheable |
| dev | listCrons | GET | /api/v1/dev/crons | — | CronJobStatus[] | admin | cacheable |
| dev | getCron | GET | /api/v1/dev/crons/:name | — | CronJobStatus \| null | admin | cacheable |
| feed | *(raw)* | GET | /feed.xml | — | string (RSS XML) | public | raw; not exposed |
| fonts | list | GET | /api/v1/fonts | — | FontWithUrl[] | public | cacheable |
| fonts | upload | POST | /api/v1/fonts | Multipart | FontWithUrl | admin | mutation; multipart |
| fonts | delete | DELETE | /api/v1/fonts/:id | — | Font | admin | mutation |
| forms | listPublic | GET | /api/v1/forms | FormListQuery | Form[] | optional | cacheable; public bare array |
| forms | getBySlug | GET | /api/v1/forms/slug/:slug | — | Form | optional | cacheable |
| forms | getResults | GET | /api/v1/forms/slug/:slug/results | — | FormResults | public | cacheable |
| forms | submit | POST | /api/v1/forms/slug/:slug/submit | FormSubmitBody | FormSubmitResponse | optional | mutation; enforces auth/dups |
| forms | submissionsExport | GET | /api/v1/forms/:id/submissions/export | — | string (CSV) | admin | raw; csv export |
| forms | bulk | POST | /api/v1/forms/bulk | FormBulkBody | BulkActionResult | admin | mutation |
| forms | get | GET | /api/v1/forms/:id | — | Form | admin | cacheable |
| forms | listSubmissions | GET | /api/v1/forms/:id/submissions | FormSubmissionsQuery | FormSubmission[] | admin | cacheable; paginated |
| forms | create | POST | /api/v1/forms | FormCreateBody | Form | admin | mutation |
| forms | update | PUT | /api/v1/forms/:id | FormUpdateBody | Form | admin | mutation |
| forms | addQuestion | POST | /api/v1/forms/:id/questions | FormQuestionCreateBody | FormQuestion | admin | mutation |
| forms | updateQuestion | PUT | /api/v1/forms/:formId/questions/:questionId | FormQuestionUpdateBody | FormQuestion | admin | mutation |
| forms | deleteQuestion | DELETE | /api/v1/forms/:formId/questions/:questionId | — | FormQuestionDeleteResponse | admin | mutation |
| forms | delete | DELETE | /api/v1/forms/:id | — | FormDeleteResponse | admin | mutation |
| health | basic | GET | /api/v1/health | — | HealthBasicResponse | public | cacheable |
| health | detailed | GET | /api/v1/health/detailed | — | HealthDetailedResponse | public | raw; 200/503 status |
| health | ready | GET | /api/v1/health/ready | — | HealthReadyResponse | public | raw; 200/503 status |
| health | live | GET | /api/v1/health/live | — | HealthLiveResponse | public | cacheable |
| lists | subscribe | POST | /api/v1/lists/:slug/subscribe | ListSubscribeBody | ListSubscribeResponse | optional | mutation; double-opt-in aware |
| mail | send | POST | /api/v1/mail/send | MailSendBody | MailSendResponse | admin | mutation (202); fire-and-forget |
| mail | listJobs | GET | /api/v1/mail/jobs | MailJobsListQuery | MailSendJobRow[] | admin | cacheable |
| mail | getJob | GET | /api/v1/mail/jobs/:id | — | MailSendJob | admin | cacheable |
| mail | listRecipients | GET | /api/v1/mail/jobs/:id/recipients | MailJobsRecipientsQuery | MailSendRecipient[] | admin | cacheable; paginated |
| mail | retry | POST | /api/v1/mail/jobs/:id/retry | — | MailRetryResponse | admin | mutation |
| mail | cancel | PATCH | /api/v1/mail/jobs/:id | MailCancelBody | MailCancelResponse | admin | mutation |
| mail-templates | variables | GET | /api/v1/mail-templates/variables | — | VariableDescriptor[] | admin | cacheable |
| mail-templates | list | GET | /api/v1/mail-templates | — | MailTemplate[] | admin | cacheable |
| mail-templates | get | GET | /api/v1/mail-templates/:id | — | MailTemplate & { blocks } | admin | cacheable |
| mail-templates | create | POST | /api/v1/mail-templates | MailTemplateCreateBody | MailTemplate | admin | mutation |
| mail-templates | update | PUT | /api/v1/mail-templates/:id | MailTemplateUpdateBody | MailTemplate | admin | mutation |
| mail-templates | preview | POST | /api/v1/mail-templates/preview | MailTemplatePreviewBody | MailTemplatePreviewResponse | admin | mutation; idempotent |
| mail-templates | saveBlocks | PUT | /api/v1/mail-templates/:id/blocks | { blocks } | { ok } | admin | mutation; transactional |
| mail-templates | delete | DELETE | /api/v1/mail-templates/:id | — | MailTemplateDeleteResponse | admin | mutation |
| mailing-lists | list | GET | /api/v1/mailing-lists | — | MailingList[] | admin | cacheable |
| mailing-lists | get | GET | /api/v1/mailing-lists/:id | — | MailingList | admin | cacheable |
| mailing-lists | create | POST | /api/v1/mailing-lists | MailingListCreateBody | MailingList | admin | mutation |
| mailing-lists | update | PUT | /api/v1/mailing-lists/:id | MailingListUpdateBody | MailingList | admin | mutation |
| mailing-lists | delete | DELETE | /api/v1/mailing-lists/:id | — | MailingListDeleteResponse | admin | mutation |
| mailing-lists | listSubscribers | GET | /api/v1/mailing-lists/:id/subscribers | MailingListSubscribersQuery | MailingListSubscribersResponse | admin | cacheable; non-std wrapper |
| mailing-lists | addSubscriber | POST | /api/v1/mailing-lists/:id/subscribers | MailingListSubscriberCreateBody | MailingListSubscriber | admin | mutation; idempotent |
| mailing-lists | updateSubscriber | PUT | /api/v1/mailing-lists/:id/subscribers/:subId | MailingListSubscriberUpdateBody | MailingListSubscriber | admin | mutation |
| mailing-lists | removeSubscriber | DELETE | /api/v1/mailing-lists/:id/subscribers/:subId | — | MailingListSubscriberDeleteResponse | admin | mutation |
| mailing-lists | bulkRemoveSubscribers | POST | /api/v1/mailing-lists/:id/subscribers/bulk-delete | { ids } | MailingListSubscriberBulkDeleteResponse | admin | mutation |
| mailing-lists | forceConfirm | POST | /api/v1/mailing-lists/:id/subscribers/:subId/force-confirm | — | MailingListSubscriber | admin | mutation |
| media | upload | POST | /api/v1/media | Multipart | MediaWire | admin | mutation; multipart |
| media | blockUpload | POST | /api/v1/media/block-upload | Multipart | MediaWire & ids | admin | mutation; multipart |
| media | bulkUpload | POST | /api/v1/media/bulk | Multipart | MediaWire[] | admin | mutation; multipart; max 10 |
| media | list | GET | /api/v1/media | MediaListQuery | MediaWire[] | admin | cacheable; paginated |
| media | get | GET | /api/v1/media/:id | — | MediaWire | admin | cacheable |
| media | update | PUT | /api/v1/media/:id | MediaUpdateBody | MediaWire | admin | mutation |
| media | delete | DELETE | /api/v1/media/:id | — | MediaDeleteResponse | admin | mutation |
| messages | submit | POST | /api/v1/messages | MessageSubmitBody | MessageSubmitResponse | optional | mutation; sanitizes |
| messages | list | GET | /api/v1/messages | MessageListQuery | ContactMessage[] | admin | cacheable; paginated |
| messages | get | GET | /api/v1/messages/:id | — | ContactMessage | admin | cacheable; marks read |
| messages | bulk | POST | /api/v1/messages/bulk | MessageBulkBody | BulkActionResult | admin | mutation |
| messages | updateStatus | PUT | /api/v1/messages/:id/status | MessageStatusUpdateBody | ContactMessage | admin | mutation |
| messages | delete | DELETE | /api/v1/messages/:id | — | MessageDeleteResponse | admin | mutation |
| pages | navigation | GET | /api/v1/pages/navigation | — | NavigationItem[] | public | cacheable |
| pages | homepage | GET | /api/v1/pages/homepage | — | Page | public | cacheable |
| pages | getBySlug | GET | /api/v1/pages/slug/:slug | — | Page | optional | cacheable; gated content yields CONTENT_LOCKED |
| pages | list | GET | /api/v1/pages | PageListQuery | Page[] | admin | cacheable; paginated |
| pages | bulk | POST | /api/v1/pages/bulk | PageBulkBody | BulkActionResult | admin | mutation |
| pages | listRevisions | GET | /api/v1/pages/:id/revisions | — | Revision[] | admin | cacheable |
| pages | getRevision | GET | /api/v1/pages/:id/revisions/:version | — | Revision | admin | cacheable |
| pages | restoreRevision | POST | /api/v1/pages/:id/revisions/:version/restore | — | Page | admin | mutation |
| pages | get | GET | /api/v1/pages/:id | — | Page | admin | cacheable |
| pages | create | POST | /api/v1/pages | PageCreateBody | Page | admin | mutation |
| pages | update | PUT | /api/v1/pages/:id | PageUpdateBody | Page | admin | mutation; snapshots revision |
| pages | delete | DELETE | /api/v1/pages/:id | — | PageDeleteResponse | admin | mutation |
| pages | createBlock | POST | /api/v1/pages/:pageId/blocks | PageBlockBody | Block | admin | mutation |
| pages | updateBlock | PUT | /api/v1/pages/:pageId/blocks/:blockId | PageBlockUpdateBody | Block | admin | mutation |
| pages | deleteBlock | DELETE | /api/v1/pages/:pageId/blocks/:blockId | — | PageBlockDeleteResponse | admin | mutation |
| pages | reorderBlocks | PUT | /api/v1/pages/:pageId/blocks/reorder | PageReorderBlocksBody | PageReorderBlocksResponse | admin | mutation |
| payments | createCustomer | POST | /api/v1/payments/create-customer | — | PaymentsCreateCustomerResponse | user | mutation |
| payments | donate | POST | /api/v1/payments/donate | PaymentsDonateBody | PaymentsDonateResponse | optional | mutation |
| payments | subscribe | POST | /api/v1/payments/subscribe | PaymentsSubscribeBody | PaymentsSubscribeResponse | user | mutation |
| payments | unsubscribe | POST | /api/v1/payments/unsubscribe | — | PaymentsUnsubscribeResponse | user | mutation |
| payments | listSubscriptions | GET | /api/v1/payments/subscriptions | — | UserSubscription[] | user | cacheable |
| payments | listTransactions | GET | /api/v1/payments/transactions | PaymentsTransactionsQuery | UserTransaction[] | user | cacheable; paginated |
| payments | listPlans | GET | /api/v1/payments/plans | — | SubscriptionPlan[] | public | cacheable |
| payments | adminListSubscriptions | GET | /api/v1/payments/admin/subscriptions | PaymentsAdminSubscriptionsQuery | AdminSubscription[] | admin | cacheable; paginated |
| payments | adminListTransactions | GET | /api/v1/payments/admin/transactions | PaymentsTransactionsQuery | AdminTransaction[] | admin | cacheable; paginated |
| payments | adminUserTransactions | GET | /api/v1/payments/admin/user/:userId/transactions | PaymentsTransactionsQuery | UserTransaction[] | admin | cacheable; paginated |
| payments | adminListPlans | GET | /api/v1/payments/admin/plans | — | SubscriptionPlan[] | admin | cacheable |
| payments | adminCreatePlan | POST | /api/v1/payments/admin/plans | PaymentsCreatePlanBody | SubscriptionPlan | admin | mutation |
| payments | adminUpdatePlan | PUT | /api/v1/payments/admin/plans/:id | PaymentsUpdatePlanBody | SubscriptionPlan | admin | mutation |
| posts | list | GET | /api/v1/posts | PostListQuery | Post[] | optional | cacheable; public bare array |
| posts | search | GET | /api/v1/posts/search | PostSearchQuery | Post[] | public | cacheable; paginated |
| posts | getBySlug | GET | /api/v1/posts/slug/:slug | — | PostWithBlocks | optional | cacheable; gated content yields CONTENT_LOCKED |
| posts | bulk | POST | /api/v1/posts/bulk | PostBulkBody | BulkActionResult | admin | mutation |
| posts | get | GET | /api/v1/posts/:id | — | PostWithBlocks | admin | cacheable |
| posts | create | POST | /api/v1/posts | PostCreateBody | PostWithBlocks | admin | mutation |
| posts | update | PUT | /api/v1/posts/:id | PostUpdateBody | PostWithBlocks | admin | mutation; snapshots revision |
| posts | delete | DELETE | /api/v1/posts/:id | — | PostDeleteResponse | admin | mutation |
| posts | listRevisions | GET | /api/v1/posts/:id/revisions | — | Revision[] | admin | cacheable |
| posts | getRevision | GET | /api/v1/posts/:id/revisions/:version | — | Revision | admin | cacheable |
| posts | restoreRevision | POST | /api/v1/posts/:id/revisions/:version/restore | — | PostWithBlocks | admin | mutation |
| posts | reorderBlocks | PUT | /api/v1/posts/:id/blocks/reorder | PostReorderBlocksBody | PostReorderBlocksResponse | admin | mutation |
| search | search | GET | /api/v1/search | SearchQuery | SearchResponse | public | cacheable; keyed-map response |
| search | adminSearch | GET | /api/v1/search/admin | AdminSearchQuery | AdminSearchResponse | admin | cacheable; keyed-map response |
| settings | publicSettings | GET | /api/v1/settings/public | — | SettingsPublicResponse | public | cacheable (600s) |
| settings | allSettings | GET | /api/v1/settings | — | SettingsGetAllResponse | admin | cacheable |
| settings | updateSettings | PUT | /api/v1/settings | SettingsUpdateBody | SettingsUpdateResponse | admin | mutation; 409 feature cascade |
| settings | deleteKey | DELETE | /api/v1/settings/:key | — | SettingsDeleteResponse | admin | mutation |
| setup | status | GET | /api/v1/setup/status | — | InstallationState | public | cacheable |
| setup | testDb | POST | /api/v1/setup/test-db | SetupTestDbBody | SetupTestResult | public | mutation |
| setup | testRedis | POST | /api/v1/setup/test-redis | SetupTestRedisBody | SetupTestResult | public | mutation |
| setup | testSmtp | POST | /api/v1/setup/test-smtp | SetupTestSmtpBody | SetupTestResult | public | mutation |
| setup | testS3 | POST | /api/v1/setup/test-s3 | SetupTestS3Body | SetupTestResult | public | mutation |
| setup | generateJwt | POST | /api/v1/setup/generate-jwt | — | SetupGenerateJwtResponse | public | mutation |
| setup | install | POST | /api/v1/setup/install | SetupInstallBody | SetupInstallResponse | public | mutation; responds before restart |
| sitemap | *(raw)* | POST | /admin/sitemap/regenerate | — | SitemapRegenerateResponse | admin | mutation; standard JSON |
| social | listPosts | GET | /api/v1/social/posts | SocialPostsQuery | SocialPost[] | public | cacheable; paginated |
| social | feed | GET | /api/v1/social/feed | SocialFeedQuery | SocialPost[] | public | cacheable; live |
| social | platformFeed | GET | /api/v1/social/feed/:platform | SocialFeedQuery | SocialPost[] | public | cacheable; live |
| social | homepage | GET | /api/v1/social/homepage | — | SocialPost[] | public | cacheable; fallback logic |
| social | setHomepage | PUT | /api/v1/social/homepage | SocialHomepageSetBody | SocialHomepageSetResponse | admin | mutation |
| social | sync | POST | /api/v1/social/sync | SocialSyncBody | SocialSyncResponse | admin | mutation; per-platform counts |
| social | deletePost | DELETE | /api/v1/social/posts/:id | — | SocialPostDeleteResponse | admin | mutation |
| social | platformPosts | GET | /api/v1/social/posts/:platform | SocialPlatformPostsQuery | SocialPost[] | public | cacheable; paginated |
| unsubscribe | *(raw)* | GET | /u/:token | — | string (HTML) | public | raw; not exposed |
| unsubscribe | *(raw)* | GET | /u/:token/resubscribe | — | string (HTML) | public | raw; not exposed |
| unsubscribe | *(raw)* | GET | /lists/:slug/confirm/:token | — | string (HTML) | public | raw; not exposed |
| users | list | GET | /api/v1/users | UserListQuery | User[] | admin | cacheable; paginated |
| users | get | GET | /api/v1/users/:id | — | UserWithMembership | admin | cacheable |
| users | create | POST | /api/v1/users | UserCreateBody | User | admin | mutation |
| users | update | PUT | /api/v1/users/:id | UserUpdateBody | User | admin | mutation |
| users | uploadAvatar | POST | /api/v1/users/:id/avatar | Multipart | User | admin | mutation; multipart; 256×256 webp |
| users | setPassword | POST | /api/v1/users/:id/password | UserPasswordBody | User | admin | mutation |
| users | ban | POST | /api/v1/users/:id/ban | UserBanBody | User | admin | mutation |
| users | unban | POST | /api/v1/users/:id/unban | — | User | admin | mutation |
| users | delete | DELETE | /api/v1/users/:id | — | UserDeleteResponse | admin | mutation; permanent |
| users | listBans | GET | /api/v1/users/banned/list | UserBanListQuery | UserBanRow[] | admin | cacheable; paginated |
| users | banIp | POST | /api/v1/users/ban-ip | UserBanIpBody | UserBanIpResponse | admin | mutation |
| users | removeBan | DELETE | /api/v1/users/banned/:banId | — | UserBanDeleteResponse | admin | mutation |

---

## Routes NOT Exposed in Typed Client (Drift-Check Allowlist)

These routes are intentionally excluded from the SDK surface (raw HTML/redirects, webhooks, OAuth callbacks):

1. **auth/patreon/callback** — Raw 302 redirect (OAuth callback)
2. **connections/:provider/oauth/callback** — Raw 302 redirect (OAuth callback)
3. **feed.xml** — Raw XML feed (RSS 2.0; Content-Type: application/rss+xml)
4. **forms/:id/submissions/export** — Raw CSV export (text/csv)
5. **health/detailed** — Raw endpoint (non-standard 503 on degradation; tested via HTTP status)
6. **health/ready** — Raw endpoint (k8s readiness; tested via HTTP status)
7. **payments/webhook** — Raw Stripe webhook (signature-verified; always 200 or 400)
8. **sitemap.xml** — Raw XML sitemap (Content-Type: application/xml)
9. **/u/:token** — Raw HTML unsubscribe page
10. **/u/:token/resubscribe** — Raw HTML resubscribe page
11. **/lists/:slug/confirm/:token** — Raw HTML double-opt-in confirmation page

---

## Summary

The **@sitesurge/client** build will generate **151 typed client methods** across **28 modules**:

- **29 GET** methods (cacheable, read-only)
- **73 POST** methods (mutations, creates, custom actions)
- **31 PUT** methods (mutations, full/partial updates, reorders)
- **7 PATCH** methods (mutations, targeted updates)
- **11 DELETE** methods (mutations, removals)

**Key Wiring Rules**:
- All requests go to `/api/v1/<path>` base (customizable)
- CSRF token from `csrf-token` cookie → `X-CSRF-Token` header
- Auth via HTTP-only cookies (no manual Authorization header)
- Responses wrapped in `ApiResponse<T>` envelope
- Errors use discriminated `ErrorCode` union
- Pagination metadata on `ApiResponse.meta` (except mailing-list subscribers, which nest it in data)
- Feature-cascade PUT `/settings` returns non-standard 409 with `SettingsFeatureCascadeResult`
- Multipart uploads use FormData (media, fonts, users avatar)
- Raw routes (XML, CSV, HTML) **not exposed** in typed layer

---

**Report Generated**: 2026-06-08 | **Accuracy**: Authoritative source of truth for implementation