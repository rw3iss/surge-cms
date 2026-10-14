/**
 * The membership level a SIGNED-OUT visitor chose on /subscribe, carried
 * through sign-up: /subscribe → /join?tier=&price=[&apply=1] → (verify email /
 * sign in) → Profile → Membership with that level pre-selected (or /subscribe
 * with the application open, for a level that requires approval).
 *
 * The URL carries it while the visitor stays on our pages; localStorage keeps
 * it across the verification email, which opens in a new tab. Kept for a day.
 */
export interface MembershipChoice {
    tier: string;
    price?: string | null;
    /** The level takes applications (approval) — finish on /subscribe, not the profile. */
    apply?: boolean;
}

const KEY = 'sitesurge.membershipChoice';
const TTL_MS = 24 * 60 * 60 * 1000;

/** Where to finish the chosen membership once signed in. */
export function choiceTarget(c: MembershipChoice,): string {
    const price = c.price ? `&price=${encodeURIComponent(c.price,)}` : '';
    return c.apply
        ? `/subscribe?apply=${encodeURIComponent(c.tier,)}${price}`
        : `/profile?tab=membership&tier=${encodeURIComponent(c.tier,)}${price}`;
}

/** /join link for a chosen level. */
export function joinUrl(c: MembershipChoice,): string {
    return `/join?tier=${encodeURIComponent(c.tier,)}${c.price ? `&price=${encodeURIComponent(c.price,)}` : ''}${c.apply ? '&apply=1' : ''}`;
}

/** /login link that comes back to finish the chosen level. */
export function loginUrlFor(c: MembershipChoice | null,): string {
    return c ? `/login?redirect=${encodeURIComponent(choiceTarget(c,),)}` : '/login';
}

export function rememberChoice(c: MembershipChoice,): void {
    try { localStorage.setItem(KEY, JSON.stringify({ ...c, at: Date.now(), },),); } catch { /* private mode */ }
}

/** The remembered choice (and forget it) — null when none or expired. */
export function takeChoice(): MembershipChoice | null {
    try {
        const raw = localStorage.getItem(KEY,);
        localStorage.removeItem(KEY,);
        if (!raw) return null;
        const c = JSON.parse(raw,) as MembershipChoice & { at?: number; };
        if (!c.tier || !c.at || Date.now() - c.at > TTL_MS) return null;
        return { tier: c.tier, price: c.price ?? null, apply: !!c.apply, };
    } catch {
        return null;
    }
}
