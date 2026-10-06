# Payments Service Split — Implementation Plan

> **For agentic workers:** Execute this plan with the `superpowers:subagent-driven-development` skill — one subagent per task, each task built, tested, and committed in isolation before the next. This is a pure structural refactor: **NO externally observable behavior may change.** Every function name currently imported by `routes/payments.ts` must stay importable from `services/payments.ts`. Do not touch the Stripe webhook signature verification or the raw-body handling.

## Goal

Split `packages/api/src/services/payments.ts` (~791 lines, 4 responsibilities) along SRP lines. The webhook verify + dispatch (`handleWebhook` + the ~260-line `switch(event.type)`) moves to a dedicated `services/payment/webhook.ts`; optionally the admin transaction/subscription listers move to `services/payments.admin.ts`. `services/payments.ts` re-exports the moved symbols so the public import surface (`import * as payments`) is byte-for-byte identical to callers.

## Architecture

- **`services/payments.ts`** stays the single public entry point. `routes/payments.ts` does `import * as payments from '../services/payments'` and calls 14 functions. That import must keep resolving all 14 names — moved bodies are re-exported from `payments.ts`.
- **`services/payment/`** already holds the provider abstraction (`index.ts` → `getPaymentProvider()`, `stripe.ts`, `stripeCompat.ts`, `types.ts`). The webhook dispatcher belongs here because it is the consumer of the provider + Stripe compat shims. New file: `services/payment/webhook.ts`.
- **Circular-import rule:** `webhook.ts` must NOT import from `services/payments.ts`. It imports only downward/sideways (`./index`, `./stripeCompat`, `../cache`, `../../db`, `../../config`, `../../utils/logger`, dynamic `../shop/fulfillment.js`). `payments.ts` imports (re-exports) *from* `webhook.ts`. One-directional → no cycle.
- **Shared pagination helper:** `paginate()` + `Paginated<T>` are used by both user-tier (`listUserTransactions`, stays in `payments.ts`) and admin listers (candidates to move). Extract them to `services/payment/pagination.ts` so both files import the helper with no cross-import between `payments.ts` and `payments.admin.ts`.

## Tech Stack

Express (thin route layer, `defineRoute`), Stripe (`stripe` npm SDK, provider abstraction + `stripeCompat` version shims), pg (raw `query()`), Redis cache (`cache.invalidateCampaignCache`), Vitest.

---

## File Structure

**Created**

- `packages/api/src/services/payment/webhook.ts` — Stripe webhook verify + dispatch. Public export `handleWebhook`; private `dispatchWebhookEvent` (the `switch(event.type)`). Owns: signature verification (dev-mode skip + prod verify), always-200 contract, and all 8 event-type cases (payment_intent.succeeded incl. shop delegation, payment_intent.payment_failed, charge.refunded, customer.subscription.{created,updated,deleted}, invoice.payment_{succeeded,failed}).
- `packages/api/src/services/payment/pagination.ts` — `Paginated<T>` interface + `paginate()` helper (moved out of `payments.ts` so it is a neutral shared dependency).
- *(Optional, Task 3)* `packages/api/src/services/payments.admin.ts` — admin transaction/subscription listers: `adminListSubscriptions`, `adminListTransactions`, `adminListUserTransactions`.

**Modified**

- `packages/api/src/services/payments.ts` — remove the moved bodies; add `export { handleWebhook } from './payment/webhook';` (and, after Task 3, `export { adminListSubscriptions, adminListTransactions, adminListUserTransactions } from './payments.admin';`). Import `paginate`/`Paginated` from `./payment/pagination`. Retains user-tier donations/subscriptions, plan CRUD (`adminListPlans`, `createPlan`, `updatePlan`, `publicPlans`, `mapPlanRow`), and the exported `DonateInput` / `PlanInput` interfaces.

**Re-export strategy (keeps public surface stable)**

`routes/payments.ts` uses `import * as payments` and references exactly: `createCustomer`, `donate`, `subscribe`, `unsubscribe`, `listUserSubscriptions`, `listUserTransactions`, `handleWebhook`, `adminListSubscriptions`, `adminListTransactions`, `adminListUserTransactions`, `adminListPlans`, `createPlan`, `updatePlan`, `publicPlans`. A `export { name } from './...'` re-export in `payments.ts` makes the moved names appear on the `* as payments` namespace exactly as before — no route change, no manifest change, no `docs/API.md` regen needed. `DonateInput` and `PlanInput` stay exported from `payments.ts` (no external importer today, but keep them for safety).

**Not touched:** `routes/payments.ts`, `app.ts` (line 120 `app.use('/api/v1/payments/webhook', raw({ type: 'application/json' }))` mounted before `json()` in `running` mode), `services/payment/{index,stripe,stripeCompat,types}.ts`, `services/shop/fulfillment.ts`, `services/cache.ts`, `middleware/csrf.test.ts` (only asserts the path string).

---

## Task 1 — Extract shared pagination helper

Prep step so the webhook and admin moves don't fight over the `paginate` helper. Pure move, no behavior change.

**Files**
- Create: `packages/api/src/services/payment/pagination.ts`
- Modify: `packages/api/src/services/payments.ts` (delete lines 229–236; add one import)

**Steps**
- [ ] Create `packages/api/src/services/payment/pagination.ts` with the exact bodies moved verbatim:
  ```ts
  export interface Paginated<T> {
      data: T[];
      meta: { page: number; limit: number; total: number; totalPages: number; };
  }

  export function paginate<T>(data: T[], page: number, limit: number, total: number,): Paginated<T> {
      return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit,), }, };
  }
  ```
- [ ] In `payments.ts`, delete the local `interface Paginated<T>` + `function paginate<T>` (current lines 229–236).
- [ ] Add to the import block at the top of `payments.ts`:
  ```ts
  import { paginate, type Paginated, } from './payment/pagination';
  ```
- [ ] Confirm the 3 remaining `paginate(...)` / `Paginated<...>` references in `payments.ts` (`listUserTransactions`, `adminListSubscriptions`, `adminListTransactions`, `adminListUserTransactions`) still resolve to the import.

**Verify**
- [ ] `pnpm --filter @sitesurge/server run build` — expect clean `tsc` exit (no unused-import / missing-symbol errors).
- [ ] `pnpm --filter @sitesurge/server test` — expect **108 tests pass** (green, unchanged).

**Commit**
- [ ] `git add -A && git commit -m "refactor(payments): extract paginate helper to payment/pagination"`

---

## Task 2 — Extract the Stripe webhook to `payment/webhook.ts` (primary)

Highest value, most isolated. Move `handleWebhook` (lines 532–571) and the private `dispatchWebhookEvent` (lines 573–791) verbatim, adjusting only relative import paths (file descends one dir: `services/` → `services/payment/`). **The signature-verification block and the always-200 contract must be copied character-for-character.**

**Files**
- Create: `packages/api/src/services/payment/webhook.ts`
- Modify: `packages/api/src/services/payments.ts` (delete lines 519–791 body; add re-export; prune now-unused imports)

**Steps**
- [ ] Create `packages/api/src/services/payment/webhook.ts`. Header imports (note the path shifts — one level deeper than `payments.ts`):
  ```ts
  import Stripe from 'stripe';
  import { config, } from '../../config';
  import { query, } from '../../db';
  import { cache, } from '../cache';
  import { getPaymentProvider, } from './index';
  import { invoicePaymentIntentId, invoiceSubscriptionId, subscriptionPeriod, } from './stripeCompat';
  import { logger, } from '../../utils/logger';

  const paymentProvider = getPaymentProvider();
  ```
- [ ] Copy `handleWebhook` verbatim (its exported signature must stay identical):
  ```ts
  export async function handleWebhook(
      rawBody: string | Buffer,
      signature: string | undefined,
  ): Promise<{ status: number; body: Record<string, unknown>; }> {
      let event: Stripe.Event;

      try {
          if (config.stripe.webhookSecret) {
              if (!signature) {
                  logger.warn('Webhook received without stripe-signature header',);
                  return { status: 400, body: { error: 'Missing stripe-signature header', }, };
              }
              event = paymentProvider.verifyWebhookSignature(rawBody, signature,) as Stripe.Event;
          } else {
              logger.warn(
                  'STRIPE_WEBHOOK_SECRET is not set - skipping webhook signature verification (development mode)',
              );
              event = (Buffer.isBuffer(rawBody,) ? JSON.parse(rawBody.toString(),) : rawBody) as Stripe.Event;
          }
      } catch (err) {
          logger.error('Webhook signature verification failed', { error: err, },);
          return { status: 400, body: { error: 'Webhook signature verification failed', }, };
      }

      try {
          await dispatchWebhookEvent(event,);
      } catch (processingError) {
          logger.error('Error processing webhook event', {
              eventType: event.type,
              eventId: event.id,
              error: processingError,
          },);
      }

      return { status: 200, body: { received: true, }, };
  }
  ```
  Keep the full doc-comment (the "rawBody is the EXACT request body" note) above it.
- [ ] Copy `dispatchWebhookEvent` verbatim (stays **private / non-exported**), including the whole `switch (event.type)` with all 8 cases + `default`. **One path adjustment only** — the dynamic shop import descends a level:
  ```ts
  // was: await import('./shop/fulfillment.js');
  const { fulfillShopOrder, } = await import('../shop/fulfillment.js');
  ```
  Every SQL string, `cache.invalidateCampaignCache()` call, `subscriptionPeriod(...)`, `invoiceSubscriptionId(...)`, `invoicePaymentIntentId(...)` usage, and log line must be identical to the original.
- [ ] In `payments.ts`, delete the entire `// ─── Stripe webhook event dispatch ───` section (current lines 519–791: `handleWebhook` + `dispatchWebhookEvent`).
- [ ] Add the re-export near the top of `payments.ts` (after the imports, so `import * as payments` still exposes `handleWebhook`):
  ```ts
  export { handleWebhook, } from './payment/webhook';
  ```
- [ ] Prune imports in `payments.ts` that are now used **only** by the removed webhook code. Check each before deleting — several are still used by the user/admin/plan code that remains:
  - `Stripe` (line 10) — after the move, grep `payments.ts` for `Stripe.` / `Stripe(`. `createPlan` builds `new (await import('stripe')).default(...)` (a *dynamic* import, not the top `import Stripe`). If no static `Stripe` reference remains, delete the `import Stripe from 'stripe';` line; otherwise keep it.
  - `invoicePaymentIntentId, invoiceSubscriptionId, subscriptionPeriod` (line 16) — used only by the webhook dispatch → **delete this import line from `payments.ts`** (now lives in `webhook.ts`).
  - `logger` (line 17) — grep remaining `payments.ts` for `logger.`; keep only if still referenced (likely not → delete).
  - `cache` (line 15) — used only by `cache.invalidateCampaignCache()` in the webhook → grep; delete if unreferenced.
  - `config` (line 11) — still used by `createPlan` (`config.stripe.secretKey!`) → **keep**.
  - `getPaymentProvider` + `const paymentProvider = getPaymentProvider()` (lines 15/20) — still used by `donate`/`subscribe`/`unsubscribe`/`createCustomer` → **keep**.
  - `query`, `AppError`, `NotFoundError`, `ValidationError`, `uuidOrNull` → **keep** (used by retained functions).
  - Let `tsc` (with the repo's noUnusedLocals if enabled) or `oxlint` flag any missed unused import; remove exactly those.

**Verify**
- [ ] `pnpm --filter @sitesurge/server run build` — expect clean `tsc`; specifically no "unused import" and no "cannot find name `handleWebhook`" from `routes/payments.ts`.
- [ ] `pnpm --filter @sitesurge/server test` — expect **108 tests pass**. `middleware/csrf.test.ts` ("skips the Stripe webhook path", `/api/v1/payments/webhook`) must still pass unchanged.
- [ ] Sanity-grep the diff: `git diff services/payment/webhook.ts` vs original lines 519–791 should differ **only** in the `../shop/fulfillment.js` path and the added imports — every SQL statement and case body identical.

**Commit**
- [ ] `git add -A && git commit -m "refactor(payments): move Stripe webhook dispatch to payment/webhook.ts"`

---

## Task 3 (Optional) — Split admin listers to `payments.admin.ts`

Only if a further SRP cut is wanted. Move the three admin transaction/subscription listers. **Leave plan CRUD** (`adminListPlans`, `createPlan`, `updatePlan`, `publicPlans`) and `mapPlanRow` in `payments.ts` — `mapPlanRow` is shared by `adminListPlans` + `createPlan` + `updatePlan`, so moving it would spread the change; keep that responsibility whole in `payments.ts`.

**Files**
- Create: `packages/api/src/services/payments.admin.ts`
- Modify: `packages/api/src/services/payments.ts` (delete the 3 lister bodies; add re-export)

**Steps**
- [ ] Create `packages/api/src/services/payments.admin.ts`:
  ```ts
  import { query, } from '../db';
  import { paginate, type Paginated, } from './payment/pagination';
  ```
- [ ] Move verbatim (current lines 270–390): `adminListSubscriptions(status, page, limit)`, `adminListTransactions(filters, page, limit)`, `adminListUserTransactions(userId, page, limit)` — signatures unchanged:
  ```ts
  export async function adminListSubscriptions(status: string | undefined, page: number, limit: number,): Promise<Paginated<unknown>> { /* … */ }
  export async function adminListTransactions(filters: { type?: string; status?: string; }, page: number, limit: number,): Promise<Paginated<unknown>> { /* … */ }
  export async function adminListUserTransactions(userId: string, page: number, limit: number,): Promise<Paginated<unknown>> { /* … */ }
  ```
- [ ] Delete those three functions from `payments.ts` (the `// ─── Admin endpoints ───` block down to just before `mapPlanRow`).
- [ ] Add the re-export in `payments.ts` (keeps `import * as payments` intact):
  ```ts
  export { adminListSubscriptions, adminListTransactions, adminListUserTransactions, } from './payments.admin';
  ```
- [ ] Keep the `// ─── Admin endpoints ───` comment above `mapPlanRow`/`adminListPlans` which remain.
- [ ] Prune any import now unused in `payments.ts` (unlikely — `query`/`paginate` still used by retained functions); let the linter confirm.

**Verify**
- [ ] `pnpm --filter @sitesurge/server run build` — clean `tsc`; `routes/payments.ts` still resolves `payments.adminListSubscriptions` / `.adminListTransactions` / `.adminListUserTransactions`.
- [ ] `pnpm --filter @sitesurge/server test` — expect **108 tests pass**.

**Commit**
- [ ] `git add -A && git commit -m "refactor(payments): split admin listers into payments.admin.ts"`

---

## Risks & rollback

- **Stripe signature verification / raw body — highest risk.** `handleWebhook` verifies `paymentProvider.verifyWebhookSignature(rawBody, signature)` against the byte-exact Buffer that `app.ts` (line 120) delivers via `express.raw` mounted *before* `express.json`. Do not alter the route handler in `routes/payments.ts`, the `app.ts` mount, or the branch logic (prod-verify vs dev-skip). Copy the block character-for-character; the only edits in `webhook.ts` are import paths. If a webhook test or manual Stripe CLI replay returns 400 where it used to 200, the copy drifted — diff against the original and restore.
- **Always-200 contract.** Processing errors must stay swallowed inside the inner `try/catch` so Stripe stops retrying. Preserve the two-`try` structure exactly.
- **Circular import between `webhook.ts` and `payments.ts`.** `webhook.ts` imports `getPaymentProvider` from `./index` and helpers from `./stripeCompat`/`../cache` — never from `payments.ts`. `payments.ts` only *re-exports* from `webhook.ts`. If you accidentally import a `payments.ts` symbol into `webhook.ts`, Node's ESM cycle can yield `undefined` at module-eval time (e.g. `paymentProvider` unset) — build may pass but the webhook throws at runtime. Keep the dependency one-directional.
- **Dynamic shop import path.** The one substantive edit: `await import('./shop/fulfillment.js')` → `await import('../shop/fulfillment.js')` because the file moved one directory deeper. A wrong path only fails at runtime for `orderType==='shop'` intents (not covered by unit tests), so double-check it resolves relative to `services/payment/webhook.ts`.
- **Unused-import churn.** Removing webhook code strands `logger`/`cache`/`stripeCompat`/`Stripe` imports in `payments.ts`. Delete only the ones the compiler/linter flags; do not remove `config`/`query`/`getPaymentProvider`/error classes still used by retained functions.
- **Rollback:** each task is one commit. `git revert <sha>` (or `git reset --hard HEAD~1` before pushing) restores the prior state; the tasks are independent enough to revert Task 3 without affecting Task 2.

## Self-review checklist

- [ ] `routes/payments.ts` unchanged; `import * as payments` still resolves all 14 referenced names (`createCustomer`, `donate`, `subscribe`, `unsubscribe`, `listUserSubscriptions`, `listUserTransactions`, `handleWebhook`, `adminListSubscriptions`, `adminListTransactions`, `adminListUserTransactions`, `adminListPlans`, `createPlan`, `updatePlan`, `publicPlans`).
- [ ] `DonateInput` and `PlanInput` still exported from `payments.ts`.
- [ ] `handleWebhook` signature identical: `(rawBody: string | Buffer, signature: string | undefined) => Promise<{ status: number; body: Record<string, unknown>; }>`.
- [ ] Signature-verify block, dev-mode skip, and always-200 return copied verbatim; only import paths changed.
- [ ] `dispatchWebhookEvent` stayed private; all 8 cases + default intact; every SQL string byte-identical.
- [ ] Shop dynamic import repointed to `../shop/fulfillment.js` and resolves.
- [ ] No `webhook.ts` → `payments.ts` import (one-directional; no cycle).
- [ ] `app.ts` webhook mount + `middleware/csrf.test.ts` path assertion untouched and passing.
- [ ] `pnpm --filter @sitesurge/server run build` clean; `pnpm --filter @sitesurge/server test` = 108 passing after every task.
- [ ] No `docs/API.md` / `docs/api-manifest.json` change (no route/manifest surface changed).
