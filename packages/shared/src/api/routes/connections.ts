/**
 * Wire DTOs for the /connections module (social connections). Validation,
 * credential masking, and OAuth orchestration live in
 * `packages/api/src/routes/connections.ts` + `services/connections.ts`.
 *
 * ## Credentials are always MASKED on the wire
 *
 * Stored `credentials` is a JSONB blob holding app id/secret plus issued
 * OAuth tokens. `sanitizeCredentials` runs before any read leaves the
 * server: `accessToken` becomes `head8…tail4` (and a `hasAccessToken`
 * flag is added), `appSecret` / `refreshToken` become `••••••••` (with
 * `hasAppSecret` / `hasRefreshToken` flags). Non-secret metadata (e.g.
 * `appId`, `accountId`) passes through untouched. RAW secrets are NEVER
 * returned — `MaskedCredentials` describes only what a client can ever
 * see. It is an OPEN record (extra provider-specific metadata keys ride
 * through), so the masked/flag fields are documented as optional hints.
 */

// ─── Masked credentials + the wire connection row ─────────────────

/**
 * The shape `sanitizeCredentials` emits. Open-ended (provider metadata
 * keys pass through), with the known masked fields + their boolean
 * presence flags called out. A flag is present only when its underlying
 * secret existed before masking.
 */
export interface MaskedCredentials {
    /** non-secret app/client identifier (passes through unmasked) */
    appId?: string;
    /** masked to dots + last 6 chars (X-style) when an access token is stored */
    accessToken?: string;
    hasAccessToken?: boolean;
    /** masked to `••••••••` when an app secret is stored */
    appSecret?: string;
    hasAppSecret?: boolean;
    /** masked to `••••••••` when a refresh token is stored */
    refreshToken?: string;
    hasRefreshToken?: boolean;
    /** masked to dots + last 6 chars (X-style) when a consumer/API key is stored */
    apiKey?: string;
    hasApiKey?: boolean;
    /** masked to `••••••••` when a consumer/API key secret is stored (X OAuth 1.0a) */
    apiSecret?: string;
    hasApiSecret?: boolean;
    /** masked to `••••••••` when an access token secret is stored (X OAuth 1.0a) */
    accessSecret?: string;
    hasAccessSecret?: boolean;
    [key: string]: unknown;
}

/**
 * A social-connection row as returned by list/get. Columns are mapped
 * snake_case → camelCase; `credentials` is the masked record (never raw).
 * Timestamps serialize to ISO strings. `settings` is an open provider-
 * specific blob.
 */
export interface ConnectionRow {
    id: string;
    provider: string;
    isConnected: boolean;
    isEnabled: boolean;
    displayName: string | null;
    accountId: string | null;
    credentials: MaskedCredentials;
    settings: Record<string, unknown>;
    autoPublish: boolean;
    autoPublishCount: number | null;
    sortOrder: number;
    lastSyncedAt: string | null;
    connectedBy: string | null;
    createdAt: string;
    updatedAt: string;
}

// ─── GET /connections ─────────────────────────────────────────────

/** GET /connections — all connections, credentials masked. */
export type ConnectionListResponse = ConnectionRow[];

// ─── POST /connections ────────────────────────────────────────────

/** Body for the connection upsert (POST /connections creates/updates;
 *  PUT /connections/:provider takes `provider` from the path and accepts
 *  a partial of this shape). `credentials` is the RAW blob a client
 *  supplies; it is merged over the stored creds so saving app creds never
 *  wipes issued tokens. */
export interface ConnectionUpsertBody {
    provider: string;
    enabled?: boolean;
    autoPublish?: boolean;
    autoPublishCount?: number | null;
    credentials?: Record<string, unknown>;
    /** Provider-specific settings blob (e.g. X `{ twitterMode }`). Merged. */
    settings?: Record<string, unknown>;
}

/** POST /connections — confirmation message. */
export interface ConnectionUpsertResponse {
    message: string;
}

// ─── GET /connections/:provider/oauth/authorize ───────────────────

/** Params for the per-provider routes. */
export interface ConnectionProviderParams {
    provider: string;
}

/** GET /connections/:provider/oauth/authorize — OAuth authorization URL +
 *  CSRF state (stored server-side for 10 min). Requires saved app creds
 *  (400 MISSING_CREDENTIALS otherwise). */
export interface ConnectionOAuthAuthorizeResponse {
    authUrl: string;
    state: string;
}

// ─── GET /connections/:provider/oauth/callback ────────────────────
// RAW REDIRECT — no JSON body. Persists the exchanged token, then 302s to
// `${frontendUrl}/admin/settings?oauth_success=<provider>` or
// `…?oauth_error=<message>`. No response DTO.

// ─── PUT /connections/:provider/reorder ───────────────────────────

/** Body for PUT /connections/:provider/reorder — move one slot up/down in
 *  the manual sort order. No-op (still 200) at the edge. */
export interface ConnectionReorderBody {
    direction: 'up' | 'down';
}

/** PUT /connections/:provider/reorder — confirmation message. */
export interface ConnectionReorderResponse {
    message: string;
}

// ─── GET /connections/:provider ───────────────────────────────────

/** GET /connections/:provider — one connection (credentials masked), or
 *  null when the provider has no row yet. */
export type ConnectionGetResponse = ConnectionRow | null;

// ─── PUT /connections/:provider ───────────────────────────────────

/** Body for PUT /connections/:provider — partial upsert; `provider` is
 *  taken from the path, not the body. */
export type ConnectionUpdateBody = Partial<ConnectionUpsertBody>;

/** PUT /connections/:provider — confirmation message. */
export interface ConnectionUpdateResponse {
    message: string;
}

// ─── DELETE /connections/:provider ────────────────────────────────

/** DELETE /connections/:provider — disconnect: clears issued tokens (keeps
 *  app creds), stops the refresh cron, busts the cache. Confirmation msg. */
export interface ConnectionDeleteResponse {
    message: string;
}
