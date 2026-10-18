/**
 * Human-readable, collision-safe order-number generator: `SS-<ts><rand>`
 * where `<ts>` is the current epoch millis in base36 and `<rand>` is 8
 * Crockford base32 chars (40 random bits — it was 16). The
 * `shop_orders.order_number` UNIQUE constraint is the ultimate backstop.
 *
 * The number is NOT a credential (it is in subjects, receipts, screenshots):
 * what it unlocks anonymously is limited, and the buyer's identity + digital
 * downloads need the order's {@link generateOrderAccessKey access key}.
 */
import { randomBytes, timingSafeEqual, } from 'crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 5 random bytes → 8 base32 characters. */
function base32(bytes: Buffer,): string {
    let bits = 0;
    let value = 0;
    let out = '';
    for (const b of bytes) {
        value = (value << 8) | b;
        bits += 8;
        while (bits >= 5) {
            out += CROCKFORD[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
    return out;
}

export function generateOrderNumber(): string {
    const ts = Date.now().toString(36,).toUpperCase();
    return `SS-${ts}${base32(randomBytes(5,),)}`;
}

/** The order's confirmation secret (`?k=` on the confirmation link). */
export function generateOrderAccessKey(): string {
    return randomBytes(16,).toString('hex',);
}

/** Constant-time compare of a presented key against the stored one. */
export function accessKeyMatches(stored: string | null | undefined, presented: string | null | undefined,): boolean {
    if (!stored || !presented) return false;
    const a = Buffer.from(stored,);
    const b = Buffer.from(presented,);
    return a.length === b.length && timingSafeEqual(a, b,);
}
