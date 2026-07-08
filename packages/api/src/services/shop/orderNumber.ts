/**
 * Human-readable, collision-safe order-number generator: `SS-<ts><rand>`
 * where `<ts>` is the current epoch millis in base36 and `<rand>` is 4
 * random base36 chars. The `shop_orders.order_number` UNIQUE constraint is
 * the ultimate backstop; the timestamp+random scheme makes a clash
 * astronomically unlikely in practice.
 */
import { randomBytes, } from 'crypto';

export function generateOrderNumber(): string {
    const ts = Date.now().toString(36,).toUpperCase();
    const rand = randomBytes(3,).toString('hex',).slice(0, 4,).toUpperCase();
    return `SS-${ts}${rand}`;
}
