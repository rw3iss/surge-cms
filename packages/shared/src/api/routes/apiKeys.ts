/**
 * Wire DTOs for the /api-keys module. Validation schemas live in
 * `packages/api/src/routes/apiKeys.ts`.
 */

import type { ApiKeyScope, } from '../auth';

/**
 * An API key row as returned to admins. The key hash is never exposed;
 * `keyPrefix` (first 12 chars of the plaintext) identifies it. Defined
 * here as the wire shape — the API package's repo carries its own row
 * type with `Date` fields, which serialize to ISO strings on the wire.
 */
export interface ApiKey {
    id: string;
    name: string;
    keyPrefix: string;
    scopes: ApiKeyScope[];
    createdBy: string | null;
    lastUsedAt: string | null;
    revokedAt: string | null;
    createdAt: string;
}

/** GET /api/v1/api-keys — list of keys (hashes never returned). */
export type ApiKeyListResponse = ApiKey[];

/** POST /api/v1/api-keys — body. */
export interface ApiKeyCreateBody {
    name: string;
    scopes?: ApiKeyScope[];
}

/**
 * POST /api/v1/api-keys (201) — the new key plus its plaintext, returned
 * ONCE. `key` is never retrievable again.
 */
export interface ApiKeyCreateResponse {
    apiKey: ApiKey;
    key: string;
}

/** DELETE /api/v1/api-keys/:id — params. */
export interface ApiKeyDeleteParams {
    id: string;
}

/** DELETE /api/v1/api-keys/:id — the revoked key row. */
export type ApiKeyDeleteResponse = ApiKey;
