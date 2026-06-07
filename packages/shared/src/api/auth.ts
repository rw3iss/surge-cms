/**
 * Auth tiers every API route declares. The route framework enforces
 * them; the docs generator and client SDK read them.
 *
 *   public   — no auth.
 *   optional — anon OK; response is shaped by role when a user is present
 *              (admins see drafts, members unlock gated content).
 *   user     — any authenticated user (Bearer JWT or cookie).
 *   admin    — admin/sysadmin role required.
 *   apiKey   — admin-equivalent access for standalone clients via API
 *              key (Phase 2). Until then it behaves like `admin`.
 */
export const AUTH_TIERS = ['public', 'optional', 'user', 'admin', 'apiKey',] as const;

export type AuthTier = (typeof AUTH_TIERS)[number];

export const API_KEY_SCOPES = ['read', 'write', 'admin',] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];
