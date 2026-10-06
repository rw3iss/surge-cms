# Mailing Lists — Design Spec

**Date:** 2026-05-11
**Status:** Approved (brainstorming complete)
**Scope:** New `mailing_lists` feature module: dependency-aware feature toggle, lists + subscribers, content-block-based mail templates with email render mode, send wizard with tracked send jobs and SMTP provider abstraction, public subscribe + token-based unsubscribe.

---

## 1. Overview

A new **`mailing_lists`** feature module ships with three admin surfaces:

1. **List management** — admins create mailing lists, manage subscribers (registered users *or* email-only), set per-list options (enabled, registered-users-only, double-opt-in, default template).
2. **Template management** — admins author mail templates using the existing Content Block system, with an email-render mode that inlines styles and adapts each block type for email-client compatibility.
3. **Send wizard** — admins pick a list + template (or new), edit content in-place if needed, preview, confirm, and send. Sends run as tracked jobs with per-recipient delivery status and live progress.

The feature **requires `users`** (declared via the new feature dependency system, which ships first as shared infrastructure).

### Cross-cutting concerns shipped with this feature

- **Feature dependency system** — declarative `requires: []` config, cascade-aware enable/disable, lazy-install migrations.
- **SMTP provider abstraction** — refactors existing `email.ts` into a `MailProvider` interface; ships `SmtpMailProvider` (Nodemailer, default); stubs Mailgun/SendGrid/Postmark for future native REST adapters.
- **List-Unsubscribe** headers + token-based public unsubscribe URLs.

---

## 2. Feature Dependency System (shared infrastructure)

### Goal

Allow features to declare prerequisites. Enabling a feature with unmet prerequisites prompts the operator to enable the chain. Disabling a feature that other features depend on prompts a cascade-disable. Lazy-install migrations run only when a feature is enabled for the first time.

### Registry

New module: `backend/src/features/registry.ts`. Single source of truth replacing the scattered `FEATURE_TO_SETTING_KEY` map in `routes/settings.ts`.

```ts
export type FeatureKey =
  | 'patreon' | 'posts' | 'campaigns' | 'forms' | 'messages' | 'users'
  | 'mailing_lists';

export interface FeatureConfig {
  key: FeatureKey;
  label: string;
  description?: string;
  defaultEnabled: boolean;
  requires?: FeatureKey[];
  migrations?: string[];  // Filenames in db/migrations/ tagged @feature <key>
}

export const FEATURE_REGISTRY: Record<FeatureKey, FeatureConfig> = {
  // ... existing six features re-registered with requires: []
  mailing_lists: {
    key: 'mailing_lists',
    label: 'Mailing Lists',
    description: 'Author mail templates and send to subscriber lists.',
    defaultEnabled: false,
    requires: ['users'],
    migrations: [
      '030_create_mailing_lists.sql',
      '031_create_mailing_list_subscribers.sql',
      '032_create_mail_templates.sql',
      '033_create_mail_template_blocks.sql',
      '034_create_mail_send_jobs.sql',
      '035_create_mail_send_recipients.sql',
      '036_seed_mailing_lists_feature_setting.sql',
    ],
  },
};
```

### Validator

`validateEnable(target: Record<FeatureKey, boolean>, current: Record<FeatureKey, boolean>): ValidationResult`

Pure function. Returns one of:

- `{ ok: true, plan: FeatureKey[] }` — ordered list of features to flip. Prerequisites first on enable; dependents first on disable.
- `{ ok: false, kind: 'missing_prerequisites', target: FeatureKey, missing: FeatureKey[] }` — operator wants to enable `target` but its prerequisites are disabled.
- `{ ok: false, kind: 'has_dependents', target: FeatureKey, dependents: FeatureKey[] }` — operator wants to disable `target` but enabled dependents would break.

`getDependents(key)` is computed lazily by inverting the `requires` graph. Cycles are detected at boot and fail-fast.

### Endpoint changes — `PUT /settings`

Payload gains two optional flags:

```ts
{
  features?: Partial<Record<FeatureKey, boolean>>,
  enableDependencies?: boolean,   // auto-enable missing prerequisites
  disableDependents?: boolean,    // auto-disable enabled dependents
  // ... rest of settings payload unchanged
}
```

Behavior:

1. Run `validateEnable(merged, current)`.
2. If `ok: false` and the corresponding flag is *not* set → return `409 Conflict` with `{ kind, missing | dependents }`. Frontend uses this to open the confirmation modal.
3. If `ok: false` and the flag *is* set → expand the plan to include the dependent flips, re-validate, then proceed.
4. For each feature being newly enabled: run `applyFeatureMigrations(key)` (see §8) before flipping its `*_enabled` row. All flips happen inside a single transaction; any failure rolls back the whole plan.
5. Audit-log the full plan as one entry.

### Frontend

- **`stores/siteSettings.ts`** gains `getFeatureConfig(key)`, `getMissingPrerequisites(key)`, `getEnabledDependents(key)`.
- **`FeatureToggleRow`** component (`components/admin/features/FeatureToggleRow.tsx`):
  - Renders one feature: label, toggle, info icon.
  - Hover info-icon → tooltip listing prerequisites ("Requires: Users") and current state of each.
  - When prerequisites are unmet: toggle visually disabled (dimmed, `cursor: not-allowed`), but *clickable* — click opens `FeatureDependencyModal` rather than flipping.
  - When prerequisites are met: regular toggle behavior.
  - When dependents are enabled and operator toggles off: opens the same modal in disable-cascade mode.
- **`FeatureDependencyModal`** component:
  - Renders the chain of features to be toggled, ordered.
  - Two buttons: Cancel | "Enable Users + Mailing Lists" (or "Disable Mailing Lists + Users").
  - Confirm calls `PUT /settings` with the appropriate flag.
- **Settings → Features panel** refactored to iterate `FEATURE_REGISTRY`, render one `FeatureToggleRow` each. No hardcoded toggle list.

---

## 3. Data Model

Six new tables. All migrations tagged `-- @feature mailing_lists`.

### `mailing_lists`

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PK` | |
| `slug` | `TEXT UNIQUE NOT NULL` | Public subscribe URL `/lists/:slug/subscribe` |
| `name` | `TEXT NOT NULL` | |
| `description` | `TEXT` | |
| `is_enabled` | `BOOLEAN DEFAULT true` | Soft-disable without delete |
| `registered_users_only` | `BOOLEAN DEFAULT false` | Gates the public subscribe endpoint |
| `double_opt_in` | `BOOLEAN DEFAULT false` | Per-list confirmation flow |
| `default_template_id` | `UUID NULL → mail_templates(id) ON DELETE SET NULL` | Wizard starting point |
| `created_by` | `UUID → users(id)` | |
| `created_at`, `updated_at` | `TIMESTAMPTZ` | |

**Indexes:** `(slug)` unique, `(is_enabled)`.

### `mailing_list_subscribers`

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PK` | |
| `list_id` | `UUID → mailing_lists(id) ON DELETE CASCADE` | |
| `user_id` | `UUID NULL → users(id) ON DELETE SET NULL` | Null for email-only subscribers |
| `email` | `TEXT NOT NULL` | Canonical, lowercased; denormalized for send-time speed |
| `name` | `TEXT NULL` | |
| `phone` | `TEXT NULL` | |
| `status` | `TEXT NOT NULL DEFAULT 'subscribed'` | `subscribed \| pending_confirmation \| unsubscribed \| bounced \| complained` |
| `confirmation_token` | `TEXT NULL` | One-shot, cleared after double-opt-in confirmation |
| `unsubscribe_token` | `TEXT NOT NULL` | Stable HMAC, generated on insert |
| `custom_fields` | `JSONB DEFAULT '{}'` | Open-ended per-list extras |
| `subscribed_at`, `confirmed_at`, `unsubscribed_at`, `last_send_at` | `TIMESTAMPTZ` | |

**Indexes:** `UNIQUE(list_id, lower(email))`, `(user_id)`, `(status)`, `(unsubscribe_token)`.

### `mail_templates`

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PK` | |
| `name` | `TEXT NOT NULL` | |
| `description` | `TEXT` | |
| `is_enabled` | `BOOLEAN DEFAULT true` | |
| `subject` | `TEXT NOT NULL` | Supports `{{variables}}` |
| `preheader` | `TEXT NULL` | Preview-pane line |
| `from_name`, `from_email`, `reply_to` | `TEXT NULL` | Falls back to `EMAIL_FROM` env when null |
| `created_by` | `UUID → users(id)` | |
| `created_at`, `updated_at` | `TIMESTAMPTZ` | |

**Indexes:** `(is_enabled)`, `(name)`.

### `mail_template_blocks`

Mirrors the `blocks` schema exactly, scoped to a template. This is the storage decision from brainstorming Q1 (option a).

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PK` | |
| `template_id` | `UUID → mail_templates(id) ON DELETE CASCADE` | |
| `parent_block_id` | `UUID NULL → mail_template_blocks(id) ON DELETE CASCADE` | For Group composition |
| `block_type` | `block_type` (shared enum) | Reuses existing enum — no migration churn |
| `position` | `INTEGER NOT NULL` | |
| `settings` | `JSONB NOT NULL DEFAULT '{}'` | |
| `style` | `JSONB NOT NULL DEFAULT '{}'` | |
| `created_at`, `updated_at` | `TIMESTAMPTZ` | |

**Indexes:** `(template_id, parent_block_id, position)`, `(template_id)`.

### `mail_send_jobs`

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PK` | |
| `list_id` | `UUID → mailing_lists(id)` | |
| `template_id` | `UUID NULL → mail_templates(id) ON DELETE SET NULL` | Original template; may be edited inline before send |
| `subject` | `TEXT NOT NULL` | Snapshot |
| `preheader`, `from_name`, `from_email`, `reply_to` | `TEXT` | Snapshot |
| `rendered_html_template` | `TEXT NOT NULL` | Merged blocks output **with** `{{...}}` tokens still in place; per-recipient substitution at delivery |
| `status` | `TEXT NOT NULL DEFAULT 'pending'` | `pending \| running \| completed \| failed \| cancelled` |
| `total_recipients` | `INT` | |
| `sent_count` | `INT DEFAULT 0` | |
| `failed_count` | `INT DEFAULT 0` | |
| `started_at`, `completed_at` | `TIMESTAMPTZ` | |
| `error` | `TEXT` | Job-level error (worker crash, etc.) |
| `created_by` | `UUID → users(id)` | |
| `created_at` | `TIMESTAMPTZ` | |

**Indexes:** `(status)`, `(list_id, created_at DESC)`.

### `mail_send_recipients`

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PK` | |
| `job_id` | `UUID → mail_send_jobs(id) ON DELETE CASCADE` | |
| `subscriber_id` | `UUID NULL → mailing_list_subscribers(id) ON DELETE SET NULL` | Null after subscriber delete; row preserved for audit |
| `email` | `TEXT NOT NULL` | Snapshot |
| `status` | `TEXT NOT NULL DEFAULT 'pending'` | `pending \| sent \| failed \| skipped` |
| `error` | `TEXT NULL` | |
| `sent_at` | `TIMESTAMPTZ NULL` | |
| `attempt_count` | `INT DEFAULT 0` | |

**Indexes:** `(job_id, status)`, `(subscriber_id)`.

### Why this shape

- **Snapshotted HTML on the job, per-recipient context on the recipient row** → re-sending a failed recipient regenerates only the merge, never the whole template. Editing a template post-send doesn't disturb in-flight or historical sends.
- **`email` denormalized** everywhere → send-time queries never join through `users`. Lists survive user deletion.
- **`unsubscribe_token` is stable HMAC** → links in old emails keep working forever, one-click unsubscribe needs no session.
- **`block_type` enum is shared** with pages/posts → no enum migration churn.

---

## 4. Mail Template Editor & Email Render Mode

### Editor Reuse

The template detail page mounts the existing `BlockEditor` against a new data adapter, `MailTemplateBlockAdapter`, that loads/saves to `mail_template_blocks` instead of `blocks`. The adapter is the only new piece of editor code.

`BlockEditor`, `ContentBlock`, `AddBlockMenu`, per-type editors, drag/drop, inline editing for Rich Text / HTML, Group composition — all reused unchanged.

### `BlockTypeConfig` extensions

`frontend/src/config/blockTypes.ts` adds:

```ts
emailRender: 'full' | 'fallback' | 'unsupported';  // default 'full'
emailRenderWarning?: string;                       // tooltip for warning icon
```

| Block type | `emailRender` | Fallback strategy when rendering for mail |
|---|---|---|
| `rich_text` | `full` | Sanitized + style-inlined |
| `image` | `full` | Single image, explicit width/height attrs, `display: block` |
| `url_link` | `full` | Anchor with inline styles |
| `html` | `full` | Operator-authored; passed through (operator's responsibility) |
| `spacer` | `full` | Empty `<tr><td>` with height |
| `hero` | `full` | Image + heading + subheading, table-based layout |
| `group` | `full` | Nested `<table>`; each `group_item` is a `<td>` |
| `group_item` | `full` | Renders inside parent's table |
| `video` | `fallback` | Poster image + play-button overlay linking to video URL |
| `social` | `fallback` | Card with author + thumbnail + content excerpt, linking to original post |
| `form` | `fallback` | CTA button linking to the form's public page |
| `campaign` | `fallback` | Title + blurb + donate CTA linking to the campaign |
| `post_list` | `fallback` | List of rows, each: thumbnail + title + excerpt + read-more link |
| `carousel` | `fallback` | First slide only + "View more" link |
| `document` | `fallback` | Download-link card with file name + size |

`fallback` types render in `AddBlockMenu` (mail mode) with a small warning icon; tooltip uses `emailRenderWarning`. They are *not* hidden — operators can use them and accept the simplified rendering.

### Single source of truth: backend renderer

New module: `backend/src/services/mail/renderer.ts`.

```ts
renderMailHtml(blockTree: BlockNode[], ctx: RenderContext): { html: string; detectedVariables: string[] };
```

Produces a complete HTML document:

- DOCTYPE 4.01 transitional (best email-client coverage).
- `<head>`: `<meta charset>`, `<meta viewport>`, `<title>`, minimal `<style>` for media queries (most clients fall back to inline regardless).
- Outer `<table role="presentation" width="600">` centered. Each top-level block is a `<tr><td>` row.
- Groups → nested `<table>`; each `group_item` is a `<td>` with width/min/max applied as attributes + inline `style`.
- Rich text sanitized via the existing `sanitize.ts`, then style-inlined.
- Images get explicit `width`/`height` attributes (Outlook requires) and `style="display:block"`.
- **CSS variables substituted at render time** to literal values from resolved site appearance (swatches → hex, fonts → font-family string). No `var(--…)` survives.
- **Variable tokens `{{path.to.var}}` are NOT substituted** at render time — they survive into the final string. Per-recipient substitution happens at send time.

Per-block-type renderers live in `backend/src/services/mail/blocks/<type>.ts`. Each exports:

```ts
renderForEmail(block: BlockNode, ctx: RenderContext): string;
```

A registry maps `block_type → renderer`. Mirrors the frontend's `BlockRenderer.tsx` switch.

`RenderContext` includes resolved appearance (swatches, fonts, site colors), site name/url, an optional `iteratorIndex` (for blocks like `post_list` that render multiple items).

### Why backend-only

One renderer to maintain. The frontend preview is an iframe that posts the current draft to `POST /admin/mail/preview` and renders the returned HTML. No parallel renderer to drift.

### Preview Modal

`MailPreviewModal` is used by both the template editor and the send wizard.

- Near-full-window modal (90vw × 90vh, content area scrollable).
- Initial fetch: `POST /admin/mail/preview` with `{ blocks, subject, preheader, variables: {} }`. Response: `{ html, subject, preheader, detectedVariables: string[] }`.
- Modal renders the HTML inside an `<iframe srcdoc>` to isolate email CSS from admin CSS.
- **Top collapsible "Variables" section.** Lists each entry from `detectedVariables`, one input per token. Defaults pre-filled from the variable catalog (e.g. `user.name` → "Sample Subscriber"). On edit, debounce 250ms, refetch preview with updated `variables`, swap `srcdoc`. The renderer substitutes those values into the HTML before responding.
- Header: subject line (variables substituted) + close icon.
- Footer: close button.

### Variable System

Module: `backend/src/services/mail/variables.ts`.

```ts
interface VariableContext {
  user: { name?, email, phone?, custom: Record<string, unknown> } | null;
  list: { name, description?, slug };
  site: { name, url };
  unsubscribe_url: string;
  view_in_browser_url: string;
}

buildVariableContext(subscriber, list, site): VariableContext;
substituteVariables(html: string, ctx: VariableContext): string;
detectVariables(html: string): string[];
describeVariables(): VariableDescriptor[];  // The documented catalog
```

**Substitution:** regex-based replacement, dot-notation paths. Unknown paths render as empty string with a logged warning. Works inside HTML attributes (`href="{{unsubscribe_url}}"`).

**Catalog (V1):**

- `user.name`, `user.email`, `user.phone` — subscriber fields. Empty for anonymous email-only subscribers.
- `user.custom.<fieldName>` — bag from `subscribers.custom_fields`.
- `list.name`, `list.description`, `list.slug`.
- `site.name`, `site.url`.
- `unsubscribe_url` — token-bearing, always populated.
- `view_in_browser_url` — public archive URL. **V1: resolves to empty string.** Deferred to a post-V1 task — the schema supports it (the rendered HTML lives on the job row) but the public archive route and per-recipient hash routing are out of scope.

### Template Editor Page

Route: `/admin/mail-templates/:id` (and `/admin/mail-templates/new` → creates a draft).

Layout:

```
┌────────────────────────────────────────────────────┐
│  ← Templates       [Save]   [Preview]   [Delete]   │
├────────────────────────────────────────────────────┤
│  Name [_______]   Enabled ☑                        │
│  Description [____________________]                │
│  Subject  [____________________]   Preheader [___] │
│  From name [____]  From email [____]  Reply-to [_] │
├────────────────────────────────────────────────────┤
│   ┌──────── Content Blocks ───────────────────┐    │
│   │  [BlockEditor mounted on template]        │    │
│   └────────────────────────────────────────────┘    │
│                                                    │
│   ▶ Variables reference (collapsible)              │
│       lists {{user.name}}, {{list.name}}, …        │
│       with one-line description of each            │
└────────────────────────────────────────────────────┘
```

**Save is explicit** (not auto-save) — matches the Forms editor pattern. Templates change infrequently; the operator wants clear control over "this is the version sent."

---

## 5. Send Wizard, Worker, Provider Abstraction, Unsubscribe, Double Opt-In

### Send Wizard

Route: `/admin/mail/send?step=1|2`. Single page with a step signal driven from the query param.

**Step 1 — compose.**

- List dropdown (active enabled lists; shows subscriber count beside each name).
- Template dropdown (active enabled templates + "New blank template").
- Selecting a template clones its blocks + meta into local draft state.
- Meta inputs (subject, preheader, from-name, from-email, reply-to) pre-filled, editable for this send only. Does *not* mutate the template.
- `BlockEditor` mounted on the draft block tree. Optional "Save edits back to template" button (separate side request).
- Top-right "Preview" button → `MailPreviewModal`.
- Sticky footer: "Confirmation >" button, enabled when `list && (template || blocks.length > 0) && subject`.

**Step 2 — confirm.**

- Header card: list name, total subscribed recipient count, flags (`registered_users_only`, `double_opt_in`).
- Centered in-page preview (iframe `srcdoc` with rendered HTML + sample variables).
- Sticky footer: "Send..." button. On click → POSTs the send → button swaps to spinner "Scheduling…" → on 202 response, navigates to `/admin/mail/jobs/:jobId`.

Step state held in a `createStore` in the page component; navigating between steps via query param preserves the draft.

### Send Endpoint

`POST /admin/mail/send`

Body:

```ts
{
  listId: string;
  templateId?: string;
  subject: string;
  preheader?: string;
  fromName?: string;
  fromEmail?: string;
  replyTo?: string;
  blocks: BlockNode[];  // The full edited block tree
}
```

Backend:

1. Validates list is enabled + caller is admin.
2. Calls `renderMailHtml(blocks, ctx)` once. Result is the template-with-tokens.
3. In a transaction:
   - Inserts `mail_send_jobs` row (status `pending`, full snapshot).
   - Inserts one `mail_send_recipients` row per `status='subscribed'` subscriber on the list. `email` denormalized.
   - Sets `total_recipients`.
4. `setImmediate(() => sendWorker.kickJob(jobId))`.
5. Returns `202 { jobId }`.

### Worker — `backend/src/services/mail/sendWorker.ts`

```ts
kickJob(jobId: string): Promise<void>;
resumeRunningJobs(): Promise<void>;  // Called on app boot
```

`kickJob`:

1. Updates job `pending → running`, sets `started_at`.
2. Loops:
   - Pulls next chunk of `pending` recipients (`LIMIT $MAIL_SEND_CONCURRENCY`, default 10).
   - At chunk start: re-reads `mail_send_jobs.status`; bails if `cancelled` (in-flight chunk completes, no new chunks fire).
   - For each recipient: builds `VariableContext`, substitutes `{{...}}` in subject + html, calls `provider.send({...})`, updates recipient row to `sent` or `failed` + error string. Atomic counter increments on the job row.
   - `await sleep(MAIL_SEND_DELAY_MS)` (default 50ms) between chunks.
3. On no more pending: sets job `completed` (or `failed` if `failed_count === total_recipients`). Sets `completed_at`.

`resumeRunningJobs` on boot: scans for `status='running'` jobs and re-kicks each. Sent recipients are skipped naturally because the worker only pulls `pending`.

### Job Status Page

Route: `/admin/mail/jobs/:id`.

- Header: subject, list name, status badge, started/completed timestamps.
- Progress bar: `(sent_count + failed_count) / total_recipients`, polled every 2s while status is `pending`/`running`.
- Recipients table: paginated, status filter (default "All", "Failed only" tab for triage).
- Actions: **Retry failed** (`POST /admin/mail/jobs/:id/retry` resets `failed` rows to `pending`, re-kicks worker), **Cancel** (visible only when running).

### Provider Abstraction

```
backend/src/services/mail/providers/
├── types.ts        # MailProvider interface + OutboundMessage type
├── smtp.ts         # SmtpMailProvider (Nodemailer) — default
├── mailgun.ts      # Stub, NotImplementedError
├── sendgrid.ts     # Stub, NotImplementedError
├── postmark.ts     # Stub, NotImplementedError
└── factory.ts      # getProvider() reads MAIL_PROVIDER env
```

```ts
interface OutboundMessage {
  to: string;
  fromName?: string;
  fromEmail: string;
  replyTo?: string;
  subject: string;
  html: string;
  headers?: Record<string, string>;
}
interface MailProvider {
  send(msg: OutboundMessage): Promise<{ providerId?: string }>;
  verify(): Promise<boolean>;
}
```

Existing `backend/src/services/email.ts` refactors to a thin wrapper over `getProvider()` so welcome / donation-receipt emails also flow through the new pipeline. Behavioral change for existing flows: zero. If an operator later sets `MAIL_PROVIDER=mailgun` (after the stub is filled), *all* outbound mail uses the new provider.

### New Env Vars

```
MAIL_PROVIDER=smtp                # smtp | mailgun | sendgrid | postmark
MAIL_SEND_CONCURRENCY=10
MAIL_SEND_DELAY_MS=50
MAIL_UNSUBSCRIBE_SECRET=<random>  # HMAC key for unsubscribe tokens
```

### Unsubscribe

**Token shape:** `unsubscribe_token = subscriberId + '.' + listId + '.' + hmacBase64Url(subscriberId + ':' + listId, MAIL_UNSUBSCRIBE_SECRET)`. Generated on subscriber insert, stored on the row. Stable forever.

**Public routes** (mounted on the public Express router, *not* under `/api`):

- `GET /u/:token` — decodes, verifies HMAC, sets subscriber `status='unsubscribed'`, renders standalone HTML ("You have been unsubscribed from <list>. Changed your mind? [Resubscribe]"). Tolerant: already-unsubscribed → idempotent success page.
- `GET /u/:token/resubscribe` — sets status back to `subscribed` (or `pending_confirmation` if list has double-opt-in).
- `GET /lists/:slug/confirm/:token` — double-opt-in confirmation.

**`List-Unsubscribe` headers** on every outbound email:

```
List-Unsubscribe: <https://site/u/<token>>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

Triggers Gmail/Apple Mail native "Unsubscribe" button. Required for sender reputation at scale.

`{{unsubscribe_url}}` variable resolves to the same `/u/<token>` URL.

### Public Subscribe + Double Opt-In

**Public endpoint:** `POST /api/v1/lists/:slug/subscribe`

```ts
Body: { email: string; name?: string; phone?: string; customFields?: Record<string, unknown> }
```

Behavior:

1. Validates list exists + `is_enabled`.
2. If `registered_users_only`: requires authenticated session and uses logged-in user's identity (ignoring body email).
3. Idempotent: re-subscribing an existing `unsubscribed` row flips it back instead of inserting a duplicate.
4. Rate-limited via existing rate-limit middleware.
5. If `double_opt_in`: inserts subscriber as `pending_confirmation` + generates confirmation token; sends confirmation email via the same provider. Response: `{ status: 'pending_confirmation' }`.
6. If not: inserts as `subscribed`. Response: `{ status: 'subscribed' }`.

**Admin override:** "Force confirm" button on the subscriber row modal flips `pending_confirmation → subscribed` without an email round-trip.

### Audit + Caching

`logAudit()` calls on:

- List create / update / delete.
- Template create / update / delete.
- Send-job created / cancelled.
- Bulk subscriber actions (bulk delete, force confirm).

Redis caches:

- `mail:lists:enabled` — list catalog for public-form rendering, invalidated on any list mutation.
- `mail:templates` — admin template list, short TTL.

Per-list subscriber lists are not cached — they change too often; admin UI paginates from DB directly.

### Cancellation + Retry

- **Cancel** (running job): operator clicks button → `PATCH /admin/mail/jobs/:id` sets status `cancelled`. Worker checks at the start of each chunk and bails. In-flight chunk completes.
- **Retry failed** (completed/failed job): `POST /admin/mail/jobs/:id/retry` → resets all `failed` rows to `pending`, sets job back to `pending`, re-kicks worker.

### Out of Scope for V1 (explicit non-goals)

- Native REST adapters for Mailgun/SendGrid/Postmark — stubs only. SMTP via Nodemailer covers all of them functionally.
- Open/click tracking pixels and webhook ingestion.
- Automated bounce/complaint suppression (failures are logged; addresses must be manually removed).
- BullMQ / external job queue (in-process worker + boot resumer covers low-thousands lists).
- CSV bulk import for subscribers (stretch Phase 6 if useful).
- A real view-in-browser archive page (variable documented; resolves empty unless cheap implementation lands).

---

## 6. Admin UI Surface

### Routes & Pages

| Route | Page | Purpose |
|---|---|---|
| `/admin/mailing-lists` | `MailingLists.tsx` | Lists table (collapsible) + Templates table (collapsible) + "Send a Message…" button at top |
| `/admin/mailing-lists/new` | `MailingListEdit.tsx` (empty mode) | Create new list |
| `/admin/mailing-lists/:id` | `MailingListEdit.tsx` | List settings + subscribers table + Send-to-this-list button |
| `/admin/mail-templates/new` | `MailTemplateEdit.tsx` (empty mode) | Create new template |
| `/admin/mail-templates/:id` | `MailTemplateEdit.tsx` | Template meta + BlockEditor + Variables reference + Preview |
| `/admin/mail/send?step=1\|2` | `MailSend.tsx` | Two-step send wizard |
| `/admin/mail/jobs/:id` | `MailJob.tsx` | Live job status + recipients + retry/cancel |

### Sidebar

New entry in `AdminLayout.tsx` `NAV_ITEMS`, inserted right after "Messages":

```ts
{ path: '/admin/mailing-lists', label: 'Mailing Lists', icon: 'mail', feature: 'mailing_lists' }
```

Existing gating logic (`!item.feature || isFeatureEnabled(item.feature)`) handles visibility automatically.

### Shared Components

```
frontend/src/components/admin/
├── features/
│   ├── FeatureToggleRow.tsx           # toggle + info icon + dependency-aware disabled state
│   └── FeatureDependencyModal.tsx     # enable/disable cascade confirmation
├── mailing-lists/
│   ├── ListSettingsForm.tsx           # name/desc/flags/default-template editor
│   ├── SubscribersTable.tsx           # paginated, searchable, bulk-selectable
│   ├── SubscriberEditModal.tsx        # create/edit/remove subscriber row
│   └── BulkAddSubscribersModal.tsx    # stretch
└── mail/
    ├── TemplatesTable.tsx
    ├── MailTemplateBlockAdapter.ts    # wires BlockEditor → mail_template_blocks
    ├── MailPreviewModal.tsx           # iframe + variable form
    ├── VariableForm.tsx               # detected-variable inputs
    └── MailJobStatus.tsx              # progress bar + counts
```

### Settings → Features Panel

Refactored to iterate `FEATURE_REGISTRY` and render one `FeatureToggleRow` per feature. Mailing Lists row shows info icon → "Requires: Users" tooltip; disabled state when Users is off; click opens `FeatureDependencyModal`.

---

## 7. File Layout

### Backend

```
backend/src/
├── features/
│   └── registry.ts                # FEATURE_REGISTRY, FeatureConfig, validateEnable
├── db/
│   ├── migrate.ts                 # extended with @feature header parsing + advisory lock
│   └── migrations/
│       ├── 030_create_mailing_lists.sql                          -- @feature mailing_lists
│       ├── 031_create_mailing_list_subscribers.sql               -- @feature mailing_lists
│       ├── 032_create_mail_templates.sql                         -- @feature mailing_lists
│       ├── 033_create_mail_template_blocks.sql                   -- @feature mailing_lists
│       ├── 034_create_mail_send_jobs.sql                         -- @feature mailing_lists
│       ├── 035_create_mail_send_recipients.sql                   -- @feature mailing_lists
│       └── 036_seed_mailing_lists_feature_setting.sql            -- @feature mailing_lists
├── repositories/
│   ├── mailingLists.repo.ts
│   ├── mailingListSubscribers.repo.ts
│   ├── mailTemplates.repo.ts
│   ├── mailTemplateBlocks.repo.ts
│   ├── mailSendJobs.repo.ts
│   └── mailSendRecipients.repo.ts
├── routes/
│   ├── mailingLists.ts            # admin CRUD + subscriber CRUD + public subscribe
│   ├── mailTemplates.ts           # admin CRUD + block CRUD + preview
│   ├── mailSend.ts                # POST /send, GET /jobs/:id, retry, cancel
│   └── unsubscribe.ts             # public GET /u/:token, resubscribe, confirm
├── services/mail/
│   ├── renderer.ts                # renderMailHtml
│   ├── variables.ts               # substitute / detect / describe / buildContext
│   ├── sendWorker.ts              # kickJob, resumeRunningJobs
│   ├── unsubscribe.ts             # token gen / verify / mark / restore
│   ├── blocks/                    # per-type renderForEmail
│   │   ├── richText.ts
│   │   ├── image.ts
│   │   ├── urlLink.ts
│   │   ├── spacer.ts
│   │   ├── hero.ts
│   │   ├── html.ts
│   │   ├── group.ts
│   │   ├── video.ts
│   │   ├── social.ts
│   │   ├── form.ts
│   │   ├── campaign.ts
│   │   ├── postList.ts
│   │   ├── carousel.ts
│   │   ├── document.ts
│   │   └── index.ts               # registry
│   └── providers/
│       ├── types.ts
│       ├── smtp.ts
│       ├── mailgun.ts             # stub
│       ├── sendgrid.ts            # stub
│       ├── postmark.ts            # stub
│       └── factory.ts
└── sdk/
    ├── mailingLists.ts
    ├── mailTemplates.ts
    └── mail.ts                    # send orchestration for scripts
```

### Frontend

```
frontend/src/
├── pages/admin/
│   ├── MailingLists.tsx
│   ├── MailingListEdit.tsx
│   ├── MailTemplateEdit.tsx
│   ├── MailSend.tsx
│   └── MailJob.tsx
├── components/admin/              # (see §6 Shared Components)
├── config/
│   └── blockTypes.ts              # gains emailRender / emailRenderWarning
├── services/
│   └── api.ts                     # gains mailingLists, mailTemplates, mailSend helpers
├── stores/
│   └── siteSettings.ts            # gains feature dependency helpers
└── styles/                        # SCSS partials per CLAUDE.md ADMIN_STYLES.md conventions
```

### Shared

```
shared/src/types/
└── mail.ts                        # MailingList, MailingListSubscriber, MailTemplate,
                                   # MailSendJob, MailSendRecipient, OutboundMessage,
                                   # VariableContext, VariableDescriptor
```

---

## 8. Migration Runner Changes — Lazy Install

Goal: feature-tagged migrations run only when the feature is enabled (or on boot if it's already on). Existing always-on features keep their migrations applied at boot. No down migrations in V1.

### Header Format

```sql
-- @feature mailing_lists
CREATE TABLE ...
```

Optional. Migrations without a header are *global* — applied on every boot.

### Runner Behavior

`backend/src/db/migrate.ts`:

1. Read migration files in order.
2. Parse the leading comment block for `-- @feature <key>` header.
3. Track applied state in the existing migrations table; add a `feature` column (`NULL` for global).
4. **On boot:**
   - Apply all global migrations not yet applied.
   - For each feature where `*_enabled = true` in `site_settings`, apply that feature's tagged migrations not yet applied.
5. **On feature enable** (from `PUT /settings`):
   - Wrap in `pg_advisory_xact_lock(hashtext('feature:' + key))` so concurrent enable attempts can't race.
   - Apply outstanding tagged migrations.
   - On any migration failure: roll back the transaction, leave feature off, surface error in the response.
6. **On feature disable:** no DB schema work. Tables persist.

### New API

```ts
// backend/src/features/migrations.ts
applyFeatureMigrations(key: FeatureKey, tx: PoolClient): Promise<void>;
listOutstandingFeatureMigrations(key: FeatureKey): Promise<string[]>;
```

Called from the `PUT /settings` enable path before flipping `*_enabled`.

### Existing Features

The six existing features (`patreon`, `posts`, `campaigns`, `forms`, `messages`, `users`) keep their always-on tables. Their migrations stay untagged. No retrofit required.

---

## 9. Phased Rollout

Each phase is one PR with a green build (`npm run build`).

### Phase 1 — Feature Dependency Infrastructure

**Ships:** `FEATURE_REGISTRY`, `FeatureConfig`, `validateEnable`, `getDependents`. Migration runner `@feature` parsing. `applyFeatureMigrations` helper. `enableDependencies` / `disableDependents` flags on `PUT /settings`. `FeatureToggleRow`, `FeatureDependencyModal`. Settings → Features panel refactored to iterate the registry. Existing six features re-registered with `requires: []`.

**Verification:** Toggling any existing feature behaves exactly as today. No UI regression. The registry is the only mutation point for adding a new feature.

**Why first:** Unblocks Mailing Lists declaring `requires: ['users']`. Pure infrastructure.

### Phase 2 — Schema + Lists CRUD + Subscribers + Unsubscribe

**Ships:**
- Migrations 030–031 (lists + subscribers).
- `mailingLists.repo`, `mailingListSubscribers.repo`.
- Admin routes (CRUD for lists + subscribers).
- Public `POST /api/v1/lists/:slug/subscribe`.
- Public `GET /u/:token` (+ resubscribe).
- `MailingLists` and `MailingListEdit` pages.
- Sidebar entry (gated by `mailing_lists` feature).
- `mailing_lists` row in `site_settings` (migration 036, applied when feature first enabled).

**Verification:** Enabling the feature runs migrations 030, 031, 036 atomically (advisory lock). Lists can be created, subscribers added (admin) and subscribed (public). Unsubscribe links work.

**Smallest end-to-end vertical slice.** No templates, no send yet — but the dependency system + lazy install path is fully exercised.

### Phase 3 — Mail Templates

**Ships:**
- Migrations 032–033.
- `mailTemplates.repo`, `mailTemplateBlocks.repo`.
- `MailTemplateEdit` page.
- `MailTemplateBlockAdapter` wiring `BlockEditor` to `mail_template_blocks`.
- `BlockTypeConfig.emailRender` field populated.
- `renderMailHtml` + per-block-type renderers + `variables.ts`.
- `POST /admin/mail/preview` endpoint.
- `MailPreviewModal` + `VariableForm`.

**Verification:** Templates can be authored with the full block editor. Preview modal renders the email correctly, with variable substitution. Snapshot tests against fixture templates validate the renderer.

### Phase 4 — Send Wizard + Worker + Provider

**Ships:**
- Migrations 034–035.
- `mailSendJobs.repo`, `mailSendRecipients.repo`.
- `MailSend` (wizard) and `MailJob` (status) pages.
- `mailSend.ts` routes (`POST /send`, `GET /jobs/:id`, retry, cancel).
- `services/mail/sendWorker.ts` + boot resumer.
- `services/mail/providers/` with `SmtpMailProvider` (default) and stubbed Mailgun/SendGrid/Postmark.
- Existing `services/email.ts` refactored to use `getProvider()`.
- `List-Unsubscribe` headers on outbound mail.
- "Send to this list" entry point on `MailingListEdit`.

**Verification:** End-to-end send works against a local SMTP relay (Mailpit / MailHog). Concurrency + delay knobs verified. Boot resumer recovers from simulated mid-send crash. Retry on failed recipients works.

### Phase 5 — Polish

**Ships:**
- Double opt-in flow (subscribe → confirmation email → confirm endpoint).
- "Force confirm" admin action.
- Audit log entries on list/template/job mutations.
- Redis cache for enabled-list catalog.
- Variable catalog reference UI in template editor.
- Bulk delete subscribers, force-confirm bulk action.
- (Optional) `BulkAddSubscribersModal` with paste-emails / CSV.

**Verification:** Full feature works under realistic load against the documented scale (lists ≤ ~5,000 subscribers).

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **Email client compatibility.** Block-rendered HTML breaks in Outlook. | Table-based outer layout. Explicit width/height attrs on images. Inlined styles. Snapshot tests against Litmus-like fixtures (manual visual review acceptable for V1). |
| **Mid-send crashes.** Worker process dies, recipients stranded in `pending`. | Boot-time `resumeRunningJobs` re-kicks any job with `status='running'`. Per-recipient atomic updates mean only in-flight calls are lost; the next chunk picks up where it left off. |
| **Spam / abuse via public subscribe.** | Rate-limit middleware on `POST /lists/:slug/subscribe`. Double-opt-in per-list toggle. `registered_users_only` per-list toggle. Eventually: reCAPTCHA on the public form (out of scope V1). |
| **Provider rate limits.** SMTP relay throttles or rejects bursts. | Per-recipient failures logged with error; do not abort the job. Operator can configure `MAIL_SEND_DELAY_MS` and `MAIL_SEND_CONCURRENCY`. Retry-failed action handles transient throttles. |
| **Token forgery.** Forged unsubscribe tokens unsubscribe arbitrary subscribers. | HMAC-SHA256 with `MAIL_UNSUBSCRIBE_SECRET` env. Token includes `subscriber_id + list_id`; HMAC verifies both. No DB write without HMAC match. |
| **Template editor drift between web and email.** Operator authors with web preview, gets surprised by email output. | Backend renderer is single source of truth. Preview modal uses the same renderer, so what the operator sees in the modal is exactly what subscribers receive (modulo per-recipient variable substitution). |
| **Concurrent feature-enable races.** Two operators click "Enable Mailing Lists" simultaneously, both try to run migrations. | `pg_advisory_xact_lock(hashtext('feature:' + key))` in `applyFeatureMigrations`. Second caller waits for first to finish, then sees migrations already applied. |

---

## 11. Glossary

- **Feature.** A module of capability gated by a single `site_settings` row (`*_enabled`).
- **Feature config.** Static declaration in `FEATURE_REGISTRY` — label, requires, migrations.
- **Plan.** Ordered list of features to enable/disable produced by `validateEnable`.
- **Block.** Existing CMS content block (rich text, image, group, etc.).
- **Mail template.** A named, reusable design (subject + blocks + meta) used as a starting point for sends.
- **Send job.** One administrative send action targeting one list with one rendered HTML template.
- **Recipient.** One row per (job, subscriber) pair tracking delivery status.
- **Variable.** `{{path.to.value}}` token resolved per-recipient at send time.
- **Subscriber.** One row per (list, email) pair. May or may not link to a registered user.
- **Provider.** A `MailProvider` implementation: SMTP, Mailgun (stub), SendGrid (stub), Postmark (stub).
