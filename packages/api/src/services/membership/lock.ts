/**
 * One membership change per member at a time, across every process.
 *
 * A double click on "Pay" / "Upgrade" (or two tabs) used to run `change` twice
 * side by side: both passed `settleOpenAttempts` before either had a row, and
 * each created its own Stripe subscription. A session-level advisory lock on a
 * dedicated client serialises them; the second call answers 409 at once
 * instead of waiting (same pattern as services/printify/syncLock.ts).
 */
import { ConflictError, } from '../../core/errors';
import { getClient, } from '../../db';
import { logger, } from '../../utils/logger';

export const MEMBERSHIP_BUSY_MESSAGE = 'A membership change is already in progress. Please wait a moment and try again.';

/** Run `fn` holding the member's lock; throws ConflictError when another change holds it. */
export async function withMembershipLock<T,>(userId: string, fn: () => Promise<T>,): Promise<T> {
    const key = `membership:${userId}`;
    const client = await getClient();
    let locked = false;
    try {
        const r = await client.query<{ ok: boolean; }>(`SELECT pg_try_advisory_lock(hashtext($1)) AS ok`, [key,],);
        locked = r.rows[0]?.ok === true;
        if (!locked) throw new ConflictError(MEMBERSHIP_BUSY_MESSAGE,);
        return await fn();
    } finally {
        if (locked) {
            await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [key,],).catch((e,) =>
                logger.warn(`membership lock release failed: ${(e as Error).message}`,)
            );
        }
        client.release();
    }
}
