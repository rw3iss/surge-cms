/**
 * Post-sign-in destinations, kept pure so they can be tested.
 *
 *   returnPathFrom  `?redirect=` / `?return=` → a SAFE site path ('' = none).
 *                   External, protocol-relative and back-to-/login values are
 *                   refused (a login page that sends you back to itself loops).
 *   loginRoutePath  the role's "page after sign-in" (stored WITHOUT the leading
 *                   slash) → a safe site path; null when unset.
 */
import { safeReturnPath, } from '../utils/accessDenied';

const isLoginPath = (p: string,) => /^\/login(?:[/?#]|$)/.test(p,);

export function returnPathFrom(...raws: unknown[]): string {
    for (const raw of raws) {
        if (typeof raw !== 'string' || !raw) continue;
        const safe = safeReturnPath(raw,);
        return safe && !isLoginPath(safe,) ? safe : '';
    }
    return '';
}

export function loginRoutePath(route: string | null | undefined,): string | null {
    if (route == null) return null;
    // Leading slashes are stripped so `//host` can never be produced.
    const safe = safeReturnPath(`/${String(route,).trim().replace(/^\/+/, '',)}`,);
    if (!safe || isLoginPath(safe,)) return '/';
    return safe;
}
