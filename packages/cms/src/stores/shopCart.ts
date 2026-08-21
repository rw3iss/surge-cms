import { createSignal, } from 'solid-js';

/**
 * Storefront cart store — localStorage-backed shopping cart.
 *
 * The cart is app state (not server state), so it lives in a dedicated
 * signal rather than the cms-client SWR cache. Each line snapshots the
 * display fields (title / price / image) at add-time so the cart + mini
 * cart render without another network round-trip; the authoritative price
 * is always recomputed server-side at checkout (preview/create take only
 * `{ variantId, qty }`).
 *
 * Persists to `localStorage['sitesurge.shop.cart']` on every mutation and
 * hydrates on first load. All localStorage access is guarded (SSR-safe)
 * like the admin shell does.
 */

const STORAGE_KEY = 'sitesurge.shop.cart';

export interface CartItem {
    /**
     * Unique line key. For a real product this is the shop variant id; for an
     * event ticket it is a synthetic `event:<eventId>:<date>:<tierId>` key, so
     * the SAME tier on two different dates is two separate lines.
     */
    variantId: string;
    productId: string;
    slug: string;
    title: string;
    variantTitle?: string | null;
    priceCents: number;
    image?: string | null;
    qty: number;
    /**
     * Discriminates a VIRTUAL event-ticket line from a real catalogue product.
     * Tickets deliberately aren't shop_products rows — a product per event/tier
     * would pollute the catalogue, sitemap, search and the Printify sync — so
     * the cart carries enough to re-resolve them at checkout, where price and
     * remaining inventory are re-read from the server.
     */
    kind?: 'product' | 'event_ticket';
    eventId?: string;
    occurrenceDate?: string;
    tierId?: string;
}

/** Stable cart key for an event-ticket line. */
export function ticketLineKey(
    eventId: string, occurrenceDate: string, tierId: string,
): string {
    return `event:${eventId}:${occurrenceDate}:${tierId}`;
}

function hydrate(): CartItem[] {
    if (typeof localStorage === 'undefined') return [];
    try {
        const raw = localStorage.getItem(STORAGE_KEY,);
        if (!raw) return [];
        const parsed = JSON.parse(raw,);
        if (!Array.isArray(parsed,)) return [];
        return parsed.filter((i,): i is CartItem =>
            i && typeof i.variantId === 'string' && typeof i.qty === 'number',
        );
    } catch {
        return [];
    }
}

const [cartItems, setCartItems,] = createSignal<CartItem[]>(hydrate(),);

function persist(items: CartItem[],) {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(items,),);
    } catch {
        /* ignore quota / private-mode failures */
    }
}

/** Current cart lines (reactive). */
export { cartItems, };

/** Add a line. If the variant is already in the cart, its qty is summed. */
export function addToCart(item: CartItem,) {
    const qty = Math.max(1, Math.floor(item.qty,) || 1,);
    setCartItems((prev,) => {
        const existing = prev.find((l,) => l.variantId === item.variantId,);
        let next: CartItem[];
        if (existing) {
            next = prev.map((l,) =>
                l.variantId === item.variantId ? { ...l, ...item, qty: l.qty + qty, } : l,
            );
        } else {
            next = [...prev, { ...item, qty, },];
        }
        persist(next,);
        return next;
    },);
}

/** Set an exact qty for a line. A qty <= 0 removes the line. */
export function updateQty(variantId: string, qty: number,) {
    const q = Math.floor(qty,);
    setCartItems((prev,) => {
        const next = q <= 0
            ? prev.filter((l,) => l.variantId !== variantId,)
            : prev.map((l,) => l.variantId === variantId ? { ...l, qty: q, } : l,);
        persist(next,);
        return next;
    },);
}

/** Remove a line entirely. */
export function removeFromCart(variantId: string,) {
    setCartItems((prev,) => {
        const next = prev.filter((l,) => l.variantId !== variantId,);
        persist(next,);
        return next;
    },);
}

/** Empty the cart (called after a successful checkout). */
export function clearCart() {
    setCartItems([],);
    persist([],);
}

/** Total number of units across all lines. */
export function cartCount(): number {
    return cartItems().reduce((sum, l,) => sum + l.qty, 0,);
}

/** Sum of price * qty across all lines, in cents (display snapshot). */
export function cartSubtotal(): number {
    return cartItems().reduce((sum, l,) => sum + l.priceCents * l.qty, 0,);
}
