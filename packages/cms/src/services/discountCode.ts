/**
 * The shop discount code the visitor arrived with or entered: `?code=XYZ` on
 * any shop URL (an affiliate's share link) is remembered for 30 days and
 * pre-filled at checkout. One code per order.
 */
const KEY = 'sitesurge.shop.discountCode';
const TTL_MS = 30 * 86_400_000;

export function storedDiscountCode(): string {
    try {
        const raw = localStorage.getItem(KEY,);
        if (!raw) return '';
        const v = JSON.parse(raw,) as { code?: string; exp?: number; };
        if (!v.code || !v.exp || v.exp < Date.now()) {
            localStorage.removeItem(KEY,);
            return '';
        }
        return v.code;
    } catch {
        return '';
    }
}

export function rememberDiscountCode(code: string,): void {
    try {
        const c = code.trim();
        if (!c) localStorage.removeItem(KEY,);
        else localStorage.setItem(KEY, JSON.stringify({ code: c, exp: Date.now() + TTL_MS, },),);
    } catch { /* private mode */ }
}

export function forgetDiscountCode(): void {
    try { localStorage.removeItem(KEY,); } catch { /* ignore */ }
}

/** Remember `?code=` from the current URL (shop pages call this on mount). */
export function captureDiscountCodeFromUrl(): void {
    if (typeof window === 'undefined') return;
    const code = new URLSearchParams(window.location.search,).get('code',);
    if (code && /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(code,)) rememberDiscountCode(code,);
}
