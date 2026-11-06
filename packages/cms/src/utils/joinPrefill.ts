/**
 * Hand-off of a visitor's contact details to the sign-up form.
 *
 * A signed-out visitor who applies for a membership level / program has just
 * typed their name, email and phone into the application. "Create my account"
 * then opens /join — which used to be empty. The application stores the
 * details here (read by the shared `formContactValues` rule) and /join (or the
 * paid sign-up's account step) takes them ONCE.
 *
 * sessionStorage, not the URL: these are personal details, and a query string
 * lands in server logs, analytics and the browser history. Same tab only,
 * dropped after 30 minutes.
 */
const KEY = 'sitesurge.join.prefill';
const TTL_MS = 30 * 60_000;

export interface JoinPrefill {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
}

export function saveJoinPrefill(p: JoinPrefill,): void {
    if (!p.name && !p.email && !p.phone) {
        // Nothing to hand over: drop an older hand-off so it can't fill /join later.
        try { sessionStorage.removeItem(KEY,); } catch { /* storage off */ }
        return;
    }
    try {
        sessionStorage.setItem(KEY, JSON.stringify({ ...p, at: Date.now(), },),);
    } catch { /* private mode / storage off */ }
}

/** The saved details (once — they are cleared), or null. */
export function takeJoinPrefill(): JoinPrefill | null {
    try {
        const raw = sessionStorage.getItem(KEY,);
        if (!raw) return null;
        sessionStorage.removeItem(KEY,);
        const v = JSON.parse(raw,) as Record<string, unknown> | null;
        if (!v || typeof v !== 'object' || typeof v.at !== 'number' || Date.now() - v.at > TTL_MS) return null;
        // Strings only (the value came from storage; anything else is ignored).
        const str = (x: unknown,): string | null => (typeof x === 'string' && x.trim() ? x.trim().slice(0, 300,) : null);
        const out = { name: str(v.name,), email: str(v.email,), phone: str(v.phone,), };
        return out.name || out.email || out.phone ? out : null;
    } catch {
        return null;
    }
}
