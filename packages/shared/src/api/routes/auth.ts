/**
 * Wire DTOs for the /auth module. Validation/rate-limiting and cookie
 * handling live in `packages/api/src/routes/auth.ts`.
 *
 * ## Cookies (shared across every token-minting route)
 *
 * Login, refresh, the Patreon callback, and autologin all set an httpOnly
 * `accessToken` + `refreshToken` cookie pair on the response ALONGSIDE the
 * tokens in the body — a browser client can rely on the cookies while a
 * non-browser client reads the body. Logout / logout-all clear both
 * cookies. These DTOs describe the JSON BODY only; the cookie pair is a
 * side effect documented here, not part of the typed payload.
 *
 * ## Reused entity types
 *
 * `AuthResponse` and `LoginCredentials` already live in `../../types/user`
 * and describe the true wire shape, so they are REFERENCED here rather than
 * redefined. `AuthResponse.expiresAt` is typed `Date` (and the nested
 * `User` carries `Date` timestamps); on the wire those serialize to ISO
 * `string`s per the package-wide timestamp convention — no reconciliation
 * was needed, the existing types already match the service output.
 */

import type { AuthResponse, LoginCredentials, PatreonAuthResponse, User, } from '../../types/user';

// ─── GET /auth/patreon ────────────────────────────────────────────

/** GET /auth/patreon — Patreon OAuth authorization URL + CSRF state. */
export type AuthPatreonResponse = PatreonAuthResponse;

// ─── GET /auth/patreon/callback ───────────────────────────────────
// RAW REDIRECT — no JSON body. On success the handler sets the auth
// cookie pair and 302s to `${frontendUrl}${returnUrl}?auth=success`; on
// failure it 302s to `${frontendUrl}/login?error=<reason>`. There is no
// response DTO because nothing is returned through the JSON envelope.

// ─── POST /auth/login ─────────────────────────────────────────────

/** Body for POST /auth/login. Extends the shared `LoginCredentials` with
 *  the optional remember-me flag, which only lengthens the refresh-token
 *  COOKIE lifetime (7d → 30d) — the server session row keeps its expiry.
 *  Pre-gated by a per-IP rate limiter (10 attempts / 15 min → 429
 *  RATE_LIMITED). */
export interface AuthLoginBody extends LoginCredentials {
    rememberMe?: boolean;
}

/** POST /auth/login — the authenticated user plus fresh tokens. Also sets
 *  the httpOnly cookie pair. */
export type AuthLoginResponse = AuthResponse;

// ─── POST /auth/refresh ───────────────────────────────────────────

/** Body for POST /auth/refresh. `refreshToken` is optional in the body —
 *  when omitted the handler falls back to the `refreshToken` cookie; a 401
 *  results if neither is present. */
export interface AuthRefreshBody {
    refreshToken?: string;
}

/** POST /auth/refresh — rotated tokens + user. Also resets the cookie pair. */
export type AuthRefreshResponse = AuthResponse;

// ─── POST /auth/logout ────────────────────────────────────────────

/** POST /auth/logout — clears the auth cookie pair and invalidates the
 *  current session token. Always 200, even when no session was found. */
export interface AuthLogoutResponse {
    message: string;
}

// ─── POST /auth/logout-all ────────────────────────────────────────

/** POST /auth/logout-all — invalidates every session for the current user
 *  and clears the auth cookie pair. */
export interface AuthLogoutAllResponse {
    message: string;
}

// ─── GET /auth/autologin ──────────────────────────────────────────

/**
 * GET /auth/autologin — DEV ONLY. Gated by `AUTOLOGIN_ADMIN_LOCALHOST` and
 * a localhost-IP check (404 / 403 otherwise). Mints an admin session and
 * sets the cookie pair. Unlike `AuthResponse` it carries NO `expiresAt`
 * field — the service returns only the user and the two tokens.
 */
export interface AuthAutologinResponse {
    user: User;
    accessToken: string;
    refreshToken: string;
}

// ─── GET /auth/me ─────────────────────────────────────────────────

/** GET /auth/me — the currently-authenticated user, wrapped. */
export interface AuthMeResponse {
    user: User;
}

// ─── POST /auth/patreon/sync ──────────────────────────────────────

/**
 * POST /auth/patreon/sync — re-syncs the caller's Patreon membership.
 * Requires a linked Patreon account (400 otherwise).
 *
 * `membership` is the `patreon_memberships` row as stored (RAW snake_case
 * columns from a `SELECT *` — the service does NOT map it to camelCase), or
 * null when no membership row exists. Typed as an open record because the
 * shape is the DB row, not the camelCase `PatreonMembership` entity.
 */
export interface AuthPatreonSyncResponse {
    membership: Record<string, unknown> | null;
}
