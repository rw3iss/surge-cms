/**
 * Shared shop-address mapping helpers.
 *
 * A shop address (`ShopAddress`) is projected into three different shapes:
 *   - Stripe Tax `customer_details.address` (`toStripeAddress`).
 *   - Printify `address_to` (`toPrintifyAddress`).
 *   - A human-readable multi-line block for order emails (`formatAddressLines`).
 *
 * These were duplicated across `checkout.ts`, `printify/fulfillment.ts`, and
 * `shop/orderEmails.ts`; the provider field mappings (`address1`/`region`/`zip`
 * for Printify, `postal_code` for Stripe) live here now, once.
 */

/** Loose address shape accepted by all mappers (nullable string fields, so both
 *  `ShopAddress` and DB-row-derived addresses fit). */
export interface AddressLike {
    name?: string | null;
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
    country?: string | null;
    phone?: string | null;
}

/** Stripe address param (`customer_details.address`). Empty fields → undefined;
 *  country defaults to `US`. */
export function toStripeAddress(addr: AddressLike,): {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country: string;
} {
    return {
        line1: addr.line1 ?? undefined,
        line2: addr.line2 ?? undefined,
        city: addr.city ?? undefined,
        state: addr.state ?? undefined,
        postal_code: addr.postalCode ?? undefined,
        country: addr.country ?? 'US',
    };
}

/** Printify `address_to`. Splits the full name into first/last, uppercases the
 *  country (default `US`), and maps to Printify's `address1`/`region`/`zip`
 *  field names. `fallbackName` is used when the address has no name. */
export function toPrintifyAddress(
    addr: AddressLike | null,
    email: string,
    fallbackName?: string | null,
): Record<string, unknown> {
    const full = (addr?.name || fallbackName || '').trim();
    const sp = full.indexOf(' ',);
    const first = sp > 0 ? full.slice(0, sp,) : (full || 'Customer');
    const last = sp > 0 ? full.slice(sp + 1,) : '';
    return {
        first_name: first,
        last_name: last || '.',
        email,
        phone: addr?.phone || '',
        country: (addr?.country || 'US').toUpperCase(),
        region: addr?.state || '',
        address1: addr?.line1 || '',
        address2: addr?.line2 || '',
        city: addr?.city || '',
        zip: addr?.postalCode || '',
    };
}

/** Compose a human-readable address into non-empty display lines:
 *  name / line1 / line2 / "city, state postal" / country / phone. */
export function formatAddressLines(addr: AddressLike,): string[] {
    const cityLine = [
        addr.city,
        [addr.state, addr.postalCode,].filter(Boolean,).join(' ',),
    ].filter(Boolean,).join(', ',);

    return [
        addr.name,
        addr.line1,
        addr.line2,
        cityLine,
        addr.country,
        addr.phone,
    ].filter((l,): l is string => Boolean(l && l.trim(),));
}
