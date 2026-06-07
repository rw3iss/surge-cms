/**
 * Wire DTOs for the mailing-lists feature. ONE file covers BOTH manifest
 * modules because they share a service (`services/mailingLists.ts`) and
 * the same entity types:
 *
 *   - `mailing-lists` — admin tier, mounted at /api/v1/mailing-lists
 *     (list CRUD + subscriber CRUD / bulk / force-confirm).
 *   - `lists` — public/optional tier, mounted at /api/v1/lists
 *     (the single public subscribe-by-slug endpoint).
 *
 * Validation/auth live in `packages/api/src/routes/mailingLists.ts`;
 * business logic in `packages/api/src/services/mailingLists.ts`.
 *
 * Entity types (`MailingList`, `MailingListSubscriber`, `SubscriberStatus`)
 * are reused verbatim from `../../types/mail` — they already model the
 * true wire shape (timestamps as ISO strings, `subscriberCount` optional
 * on list reads). DTOs here only add request bodies/queries and the few
 * response wrappers the service returns around those entities.
 */

import type {
    MailingList,
    MailingListSubscriber,
    SubscriberStatus,
} from '../../types/mail';

// ════════════════════════════════════════════════════════════════════
//  ADMIN — /api/v1/mailing-lists
// ════════════════════════════════════════════════════════════════════

// ─── GET /mailing-lists ───────────────────────────────────────────────

/** GET /mailing-lists — every list, each with `subscriberCount` joined
 *  in. Returned as a bare array (no pagination meta). */
export type MailingListListResponse = MailingList[];

// ─── POST /mailing-lists ──────────────────────────────────────────────

/** Body for POST /mailing-lists (create). `slug` is lowercase
 *  `[a-z0-9-]`. */
export interface MailingListCreateBody {
    slug: string;
    name: string;
    description?: string;
    isEnabled?: boolean;
    registeredUsersOnly?: boolean;
    doubleOptIn?: boolean;
    defaultTemplateId?: string | null;
}

/** POST /mailing-lists (201) — the created list. */
export type MailingListCreateResponse = MailingList;

// ─── GET /mailing-lists/:id ───────────────────────────────────────────

/** Params for the list-by-id family of routes. */
export interface MailingListIdParams {
    id: string;
}

/** GET /mailing-lists/:id — the list. */
export type MailingListGetResponse = MailingList;

// ─── PUT /mailing-lists/:id ───────────────────────────────────────────

/** Body for PUT /mailing-lists/:id — every field optional (partial). */
export type MailingListUpdateBody = Partial<MailingListCreateBody>;

/** PUT /mailing-lists/:id — the updated list. */
export type MailingListUpdateResponse = MailingList;

// ─── DELETE /mailing-lists/:id ────────────────────────────────────────

/** DELETE /mailing-lists/:id — `{ ok: true }` on success. */
export interface MailingListDeleteResponse {
    ok: true;
}

// ─── GET /mailing-lists/:id/subscribers ───────────────────────────────

/** Query accepted by GET /mailing-lists/:id/subscribers. `limit`/`offset`
 *  travel as strings and coerce server-side; `status` narrows to a
 *  `SubscriberStatus` in the handler (typed `string` on the wire). */
export interface MailingListSubscribersQuery {
    limit?: number;
    offset?: number;
    search?: string;
    status?: string;
}

/**
 * GET /mailing-lists/:id/subscribers — NON-STANDARD list shape. The
 * service returns `{ items, total }` as the `data` payload (offset/limit
 * pagination lives INSIDE data, not on the `ApiResponse.meta` envelope),
 * so this is an object wrapper, not a bare element array.
 */
export interface MailingListSubscribersResponse {
    items: MailingListSubscriber[];
    total: number;
}

// ─── POST /mailing-lists/:id/subscribers ──────────────────────────────

/** Body for POST /mailing-lists/:id/subscribers (admin add — force
 *  confirmed). Idempotent: re-adding an existing email reactivates it. */
export interface MailingListSubscriberCreateBody {
    email: string;
    name?: string;
    phone?: string;
    customFields?: Record<string, unknown>;
}

/** POST /mailing-lists/:id/subscribers — the added/reactivated subscriber.
 *  201 when newly created, 200 when an existing row was reactivated. */
export type MailingListSubscriberCreateResponse = MailingListSubscriber;

// ─── PUT /mailing-lists/:id/subscribers/:subId ────────────────────────

/** Params for the per-subscriber routes. */
export interface MailingListSubscriberIdParams {
    id: string;
    subId: string;
}

/** Body for PUT /mailing-lists/:id/subscribers/:subId. The route layer
 *  forwards the raw body to the repo, which only honors these columns. */
export interface MailingListSubscriberUpdateBody {
    name?: string;
    phone?: string;
    email?: string;
    customFields?: Record<string, unknown>;
}

/** PUT /mailing-lists/:id/subscribers/:subId — the updated subscriber. */
export type MailingListSubscriberUpdateResponse = MailingListSubscriber;

// ─── DELETE /mailing-lists/:id/subscribers/:subId ─────────────────────

/** DELETE /mailing-lists/:id/subscribers/:subId — `{ ok: true }`. */
export interface MailingListSubscriberDeleteResponse {
    ok: true;
}

// ─── POST /mailing-lists/:id/subscribers/bulk-delete ──────────────────

/** Body for POST /mailing-lists/:id/subscribers/bulk-delete. `ids`
 *  defaults to `[]` server-side, so it is optional on the wire. */
export interface MailingListSubscribersBulkDeleteBody {
    ids?: string[];
}

/** POST /mailing-lists/:id/subscribers/bulk-delete — count removed. */
export interface MailingListSubscribersBulkDeleteResponse {
    removed: number;
}

// ─── POST /mailing-lists/:id/subscribers/:subId/force-confirm ─────────

/** POST .../force-confirm — the now-`subscribed` subscriber (the service
 *  re-reads the row after flipping status, so it may be `null` only in a
 *  TOCTOU race where the row vanished). */
export type MailingListSubscriberForceConfirmResponse = MailingListSubscriber | null;

// ════════════════════════════════════════════════════════════════════
//  PUBLIC — /api/v1/lists
// ════════════════════════════════════════════════════════════════════

// ─── POST /lists/:slug/subscribe ──────────────────────────────────────

/** Params for POST /lists/:slug/subscribe. */
export interface ListSubscribeParams {
    slug: string;
}

/**
 * Body for POST /lists/:slug/subscribe. `email` is optional on the wire:
 * for `registeredUsersOnly` lists the server derives it from the session
 * and ignores any supplied value; for open lists it is required at
 * runtime (the handler 400s when absent and no session email exists).
 */
export interface ListSubscribeBody {
    email?: string;
    name?: string;
    phone?: string;
    customFields?: Record<string, unknown>;
}

/**
 * POST /lists/:slug/subscribe — DOUBLE-OPT-IN-AWARE response union. The
 * service returns one of two object shapes depending on list config and
 * whether the email already existed:
 *
 *   - Double-opt-in list, new/un-confirmed email →
 *       `{ status: 'pending_confirmation', id }` (a confirmation email is
 *       fired; `id` is the new pending row) or `{ status, already: true }`
 *       when an existing non-subscribed row was flipped back to pending.
 *   - Single-opt-in list, new email →
 *       `{ status: 'subscribed', id }`.
 *   - Already subscribed (either mode) →
 *       `{ status: 'subscribed', already: true }`.
 *
 * `status` is always a `SubscriberStatus`; exactly one of `id` / `already`
 * is present. (`id` on the new-row branch, `already: true` on the
 * existing-row branch.)
 */
export type ListSubscribeResponse =
    | { status: SubscriberStatus; id: string; }
    | { status: SubscriberStatus; already: true; };
