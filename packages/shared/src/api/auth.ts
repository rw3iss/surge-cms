/**
 * Auth tiers every API route declares. The route framework enforces
 * them; the docs generator and client SDK read them.
 *
 *   public   — no auth.
 *   optional — anon OK; response is shaped by role when a user is present
 *              (admins see drafts, members unlock gated content).
 *   user     — any authenticated user (Bearer JWT or cookie).
 *   staff    — content-editing staff: admin/sysadmin/editor (or API key).
 *   admin    — admin/sysadmin role required.
 *   apiKey   — admin-equivalent access for standalone clients via API
 *              key (Phase 2). Until then it behaves like `admin`.
 *   userOrKey — any signed-in user OR an API key; the HANDLER decides with
 *              permissions (e.g. contributors on their own posts —
 *              `services/postAccess.ts`). For routes a role admin shell opens.
 */
export const AUTH_TIERS = ['public', 'optional', 'user', 'staff', 'admin', 'apiKey', 'userOrKey',] as const;

export type AuthTier = (typeof AUTH_TIERS)[number];

export const API_KEY_SCOPES = ['read', 'write', 'admin',] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];
