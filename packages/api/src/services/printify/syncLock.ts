/**
 * One Printify sync at a time, across every process.
 *
 * The manual "Sync from Printify" button and the 15-minute cron used to run
 * side by side, writing the same rows — and, with retries in both, could race
 * a supplier submit. A session-level advisory lock on a dedicated client
 * serialises them: the cron skips a tick, the button answers 409.
 */
import { getClient, } from '../../db';
import { logger, } from '../../utils/logger';

const LOCK_KEY = 'printify:sync';

/** Run `fn` holding the lock; resolves `{ ran: false }` when someone else holds it. */
export async function withPrintifySyncLock<T,>(fn: () => Promise<T>,): Promise<{ ran: true; value: T; } | { ran: false; }> {
    const client = await getClient();
    let locked = false;
    try {
        const r = await client.query<{ ok: boolean; }>(`SELECT pg_try_advisory_lock(hashtext($1)) AS ok`, [LOCK_KEY,],);
        locked = r.rows[0]?.ok === true;
        if (!locked) return { ran: false, };
        return { ran: true, value: await fn(), };
    } finally {
        if (locked) {
            await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [LOCK_KEY,],).catch((e,) =>
                logger.warn(`printify sync lock release failed: ${(e as Error).message}`,)
            );
        }
        client.release();
    }
}
