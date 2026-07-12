import {
    createClient,
    UnauthorizedError,
    type CmsClient,
    type CmsError,
} from '@sitesurge/client';

/**
 * The one networking path for @sitesurge/admin.
 *
 * Cookie auth mode preserves the SPA's historical httpOnly + CSRF session:
 * the client ensures a `csrf-token` cookie, echoes it as `x-csrf-token` on
 * unsafe methods, and sends `credentials: 'include'` on every request — the
 * exact transport the old `services/api.ts` hand-rolled.
 *
 * Same-origin base URL: `window.location.origin` is the page origin; the
 * client appends `/api/v1`. In dev the Vite proxy forwards `/api/v1` → :3001,
 * so same-origin works without CORS. (`api.ts` used a relative `/api/v1`,
 * which is equivalent for an SPA always loaded from the API's own origin.)
 *
 * SSR safety: @sitesurge/admin is a pure client-rendered SPA (`src/index.tsx`
 * calls `render()` against `document.getElementById('root')`; there is no
 * `renderToString`/`hydrate` entry and no Node import of app modules). This
 * module is therefore only ever evaluated in the browser, where `window`
 * is defined — the eager `createClient` call is safe. (If a future SSR/Node
 * entry imports this module, guard `baseUrl` behind a `typeof window`
 * check; not needed today.)
 */

const isBrowser = typeof window !== 'undefined';

export const cms: CmsClient = createClient({
    baseUrl: isBrowser ? window.location.origin : 'http://localhost',
    auth: { mode: 'cookie', },
    // localStorage adapter: the SWR cache survives reloads. In Node/SSR the
    // client's 'localstorage' adapter is unavailable; it would fall back to
    // memory — fine, since this module is browser-only anyway.
    cache: { adapter: 'localstorage', },
},);

/**
 * Cross-cutting 401 handler, replicating the old `services/api.ts` seam.
 *
 * The auth store registers its session-expired handler here at boot (the
 * `setUnauthorizedHandler(fn)` indirection keeps this module free of
 * UI/state imports). On an `UnauthorizedError` from the error bus we call
 * the registered handler; if none is registered (very early calls) we fall
 * back to a hard redirect to /login so an auth failure is never silently
 * swallowed.
 */
let unauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null,): void {
    unauthorizedHandler = handler;
}

/**
 * Auth-path 401 suppression.
 *
 * The old `api.ts` skipped the session-expired handler for any 401 whose
 * endpoint started with `/auth/` — a failed login/me/autologin/logout must
 * NOT pop the "session expired" modal. The error bus carries no request
 * path, so the auth store wraps its OWN auth calls in `suppressUnauthorized`
 * (or toggles the flag) so their 401s skip the bus handler while still being
 * caught by the auth store's local try/catch.
 *
 * Phase B note: no app call site routes through `cms` yet (call-site
 * migration is Phase C+), so this guard is dormant until the auth store
 * adopts it. It is exported now so Phase C can wire it without touching
 * this module again.
 */
let authSuppressionDepth = 0;
export function suppressUnauthorized<T,>(fn: () => Promise<T>,): Promise<T> {
    authSuppressionDepth++;
    return fn().finally(() => {
        authSuppressionDepth = Math.max(0, authSuppressionDepth - 1,);
    },);
}

cms.onError((e: CmsError,) => {
    // ── 401 → session-expired (non-auth paths only) ──────────────────
    if (e instanceof UnauthorizedError) {
        // A 401 from one of the auth store's own calls is handled by its
        // local try/catch — don't also fire the session-expired modal.
        if (authSuppressionDepth > 0) return;
        if (unauthorizedHandler) {
            unauthorizedHandler();
        } else if (isBrowser) {
            window.location.href = '/login';
        }
        return;
    }

    // ── 503 NEEDS_SETUP → /setup (unless already there) ──────────────
    // The backend's setup gate replies 503 with `code: 'NEEDS_SETUP'`.
    // That code isn't in the client's mapped error set, so it surfaces as
    // a base CmsError with status 503 (a generic/feature 503 surfaces as
    // ServiceUnavailableError with code SERVICE_UNAVAILABLE/_NOT_CONFIGURED,
    // which we deliberately do NOT redirect on). Only the NEEDS_SETUP
    // signal bounces to the wizard, matching the old `api.ts`
    // (`status === 503 && error.code === 'NEEDS_SETUP'`).
    const isNeedsSetup = e.status === 503 && e.code === 'NEEDS_SETUP';
    if (isNeedsSetup && isBrowser && !window.location.pathname.startsWith('/setup',)) {
        window.location.href = '/setup';
    }
},);
