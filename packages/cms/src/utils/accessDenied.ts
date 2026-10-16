/**
 * What happens when a visitor opens a page or media item they may not view
 * (typically from a link in an email).
 *
 * ONE switch: `ACCESS_DENIED_MODE`. Today it is `login` — forward to the login
 * page with a redirect back to the item and a `reason` the login page explains
 * (`signin` → "This resource requires an account.", `forbidden` / `tier` →
 * "You do not have the appropriate permissions…" + an upgrade link). A later
 * admin setting can choose `page` (an "Access denied" page) here without
 * touching the callers.
 *
 * NOT used where a page already gates inline (posts, events — UpgradeTout /
 * LoginModal), which is the better experience there.
 *
 * The URL builder + reason codes live in `@sitesurge/types` so the API's
 * direct video link sends a browser to exactly the same place.
 */
import { type AccessDeniedReason, deniedMessage, loginUrlForDenied, parseDeniedReason, safeReturnPath, } from '@sitesurge/types';
import { accessErrorOf, } from './accessRequired';

export { type AccessDeniedReason, deniedMessage, loginUrlForDenied, parseDeniedReason, safeReturnPath, };

export type AccessDeniedMode = 'login';

/** The single switch (future: read from an admin setting). */
export const ACCESS_DENIED_MODE: AccessDeniedMode = 'login';

/** Where the current page lives, for coming back after signing in. */
export function currentPath(): string {
    if (typeof window === 'undefined') return '/';
    return window.location.pathname + window.location.search + window.location.hash;
}

/** The reason for an API access error (403 SIGN_IN_REQUIRED / SUBSCRIPTION_REQUIRED), or null for any other failure. */
export function deniedReasonOf(err: unknown, signedIn: boolean,): { reason: AccessDeniedReason; tierName: string | null; } | null {
    const gate = accessErrorOf(err,);
    if (!gate) return null;
    if (gate.reason === 'signin' && !signedIn) return { reason: 'signin', tierName: null, };
    const tierName = gate.requiredTier?.name || null;
    return { reason: tierName ? 'tier' : 'forbidden', tierName, };
}

/**
 * Send the visitor to the access-denied fallback. `navigate` replaces the
 * history entry, so Back returns to where they came from, not to a page that
 * forwards them again.
 */
export function handleAccessDenied(
    navigate: (to: string, opts?: { replace?: boolean; },) => void,
    reason: AccessDeniedReason,
    opts: { returnTo?: string; tierName?: string | null; } = {},
): void {
    switch (ACCESS_DENIED_MODE) {
        case 'login':
        default:
            navigate(loginUrlForDenied(opts.returnTo ?? currentPath(), reason, opts.tierName,), { replace: true, },);
    }
}

/**
 * Loop guard for the login page: a SIGNED-IN visitor arriving with
 * `reason=signin` (their session had lapsed when the item was checked) is sent
 * back to the item ONCE; a second arrival for the same item shows the
 * "no permission" message instead of bouncing again.
 */
export function shouldRetryAfterSignin(returnTo: string,): boolean {
    if (typeof sessionStorage === 'undefined' || !returnTo) return false;
    const key = `sitesurge.denied.retried:${returnTo}`;
    try {
        if (sessionStorage.getItem(key,)) return false;
        sessionStorage.setItem(key, '1',);
        return true;
    } catch {
        return false;
    }
}
