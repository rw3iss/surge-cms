/**
 * The shop discount code the visitor arrived with or entered: `?code=XYZ` on
 * any shop URL (an affiliate's share link) is remembered for 30 days and
 * pre-filled at checkout. One code per order. A code the checkout accepts
 * renews its 30 days.
 */
const KEY = 'sitesurge.shop.discountCode';
export const DISCOUNT_CODE_TTL_MS = 30 * 86_400_000;
/** Same rule as the server (services/shop/discounts.ts CODE_RE). */
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;

/** A stored entry → its code, or '' when missing, malformed, invalid or expired. Pure. */
export function readStoredCode(raw: string | null, now: number,): string {
    if (!raw) return '';
    try {
        const v = JSON.parse(raw,) as { code?: unknown; exp?: unknown; } | null;
        if (!v || typeof v !== 'object' || typeof v.code !== 'string' || typeof v.exp !== 'number') return '';
        if (v.exp < now || !CODE_RE.test(v.code,)) return '';
        return v.code;
    } catch {
        return '';
    }
}

export function storedDiscountCode(): string {
    try {
        const raw = localStorage.getItem(KEY,);
        const code = readStoredCode(raw, Date.now(),);
        if (raw && !code) localStorage.removeItem(KEY,); // expired / damaged: drop it
        return code;
    } catch {
        return '';
    }
}

export function rememberDiscountCode(code: string,): void {
    try {
        const c = code.trim();
        if (!c || !CODE_RE.test(c,)) localStorage.removeItem(KEY,);
        else localStorage.setItem(KEY, JSON.stringify({ code: c, exp: Date.now() + DISCOUNT_CODE_TTL_MS, },),);
    } catch { /* private mode */ }
}

export function forgetDiscountCode(): void {
    try { localStorage.removeItem(KEY,); } catch { /* ignore */ }
}

/** `?code=` from a query string, when it is a valid code ('' otherwise). Pure. */
export function codeFromSearch(search: string,): string {
    const code = new URLSearchParams(search,).get('code',)?.trim() ?? '';
    return CODE_RE.test(code,) ? code : '';
}

/** Remember `?code=` from the current URL (shop pages call this on mount). */
export function captureDiscountCodeFromUrl(): void {
    if (typeof window === 'undefined') return;
    const code = codeFromSearch(window.location.search,);
    if (code) rememberDiscountCode(code,);
}
