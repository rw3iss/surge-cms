/**
 * "You may not view this" — the fallback for a visitor who followed a link
 * (typically from an email) to a page or media item they cannot see.
 *
 * Today the fallback is the login page: `/login?redirect=<returnTo>&reason=<code>`,
 * where the login page explains why and, after signing in, returns the visitor
 * to the item. Shared so the API (a direct video link) and the SPA build the
 * SAME URL and read the SAME reason codes.
 *
 *   signin    — not signed in: "This resource requires an account."
 *   forbidden — signed in, but lacks the role / membership level.
 *   tier      — like forbidden, naming the level (`&tier=<name>`).
 */
export type AccessDeniedReason = 'signin' | 'forbidden' | 'tier';

const REASONS: readonly AccessDeniedReason[] = ['signin', 'forbidden', 'tier',];

/** A safe same-site path, or '' (rejects external and protocol-relative values). */
export function safeReturnPath(raw: string | null | undefined,): string {
    if (!raw || typeof raw !== 'string') return '';
    if (raw.startsWith('//',) || /^[a-z][a-z0-9+.-]*:/i.test(raw,) || raw.includes('\\',)) return '';
    return raw.startsWith('/',) ? raw : `/${raw}`;
}

/** The reason code from a query value, or null when absent/unknown. */
export function parseDeniedReason(raw: unknown,): AccessDeniedReason | null {
    return typeof raw === 'string' && (REASONS as readonly string[]).includes(raw,) ? raw as AccessDeniedReason : null;
}

/** `/login?redirect=<returnTo>&reason=<code>[&tier=<name>]` (site-relative). */
export function loginUrlForDenied(returnTo: string, reason: AccessDeniedReason, tierName?: string | null,): string {
    const p: string[] = [];
    const back = safeReturnPath(returnTo,);
    // Never send the login page back to itself.
    if (back && !/^\/login(?:[/?#]|$)/.test(back,)) p.push(`redirect=${encodeURIComponent(back,)}`,);
    const r = reason === 'tier' && !tierName ? 'forbidden' : reason;
    p.push(`reason=${r}`,);
    if (r === 'tier' && tierName) p.push(`tier=${encodeURIComponent(tierName,)}`,);
    return `/login?${p.join('&',)}`;
}

/** The sentence the login page shows for a reason. */
export function deniedMessage(reason: AccessDeniedReason, tierName?: string | null,): string {
    if (reason === 'signin') return 'This resource requires an account.';
    if (reason === 'tier' && tierName) return `This resource requires the ${tierName} membership.`;
    return 'You do not have the appropriate permissions to view this resource.';
}
