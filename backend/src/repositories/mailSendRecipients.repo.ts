/**
 * Per-(job, subscriber) delivery tracking. One row per recipient
 * created at job time, status flips from pending → sent | failed as
 * the worker walks through them.
 */
import type { MailRecipientStatus, MailSendRecipient, } from '@rw/cms-shared';
import { query, getPool, } from '../db';

interface DbRow {
    id: string;
    job_id: string;
    subscriber_id: string | null;
    email: string;
    status: MailRecipientStatus;
    error: string | null;
    sent_at: Date | null;
    attempt_count: number;
}

function map(row: DbRow,): MailSendRecipient {
    const out: MailSendRecipient = {
        id: row.id,
        jobId: row.job_id,
        subscriberId: row.subscriber_id,
        email: row.email,
        status: row.status,
        attemptCount: row.attempt_count,
    };
    if (row.error) out.error = row.error;
    if (row.sent_at) out.sentAt = row.sent_at.toISOString();
    return out;
}

export interface BulkInsertItem { subscriberId: string | null; email: string; }

export async function bulkInsert(jobId: string, items: BulkInsertItem[],): Promise<void> {
    if (items.length === 0) return;
    const pool = getPool();
    const client = await pool.connect();
    try {
        await client.query('BEGIN',);
        // Multi-row INSERT to avoid N round-trips on large lists. Param
        // count stays under the 64k limit even for 10k recipients (3 per row).
        const CHUNK = 500;
        for (let i = 0; i < items.length; i += CHUNK) {
            const slice = items.slice(i, i + CHUNK,);
            const placeholders = slice.map((_, k,) => {
                const base = k * 3;
                return `($${base + 1}, $${base + 2}, $${base + 3})`;
            },).join(', ',);
            const values: unknown[] = [];
            for (const it of slice) values.push(jobId, it.subscriberId, it.email,);
            await client.query(
                `INSERT INTO mail_send_recipients (job_id, subscriber_id, email) VALUES ${placeholders}`,
                values,
            );
        }
        await client.query('COMMIT',);
    } catch (err) {
        await client.query('ROLLBACK',);
        throw err;
    } finally {
        client.release();
    }
}

export async function findPending(jobId: string, limit: number,): Promise<MailSendRecipient[]> {
    const r = await query<DbRow>(
        `SELECT * FROM mail_send_recipients
         WHERE job_id = $1 AND status = 'pending'
         ORDER BY id
         LIMIT $2`,
        [jobId, limit,],
    );
    return r.rows.map(map,);
}

export async function setStatus(
    id: string,
    status: MailRecipientStatus,
    error?: string,
): Promise<void> {
    if (status === 'sent') {
        await query(
            `UPDATE mail_send_recipients
             SET status = $1, sent_at = NOW(), attempt_count = attempt_count + 1
             WHERE id = $2`,
            [status, id,],
        );
    } else {
        await query(
            `UPDATE mail_send_recipients
             SET status = $1, error = $2, attempt_count = attempt_count + 1
             WHERE id = $3`,
            [status, error ?? null, id,],
        );
    }
}

export async function resetFailedToPending(jobId: string,): Promise<number> {
    const r = await query(
        `UPDATE mail_send_recipients SET status = 'pending', error = NULL
         WHERE job_id = $1 AND status = 'failed'`,
        [jobId,],
    );
    return r.rowCount ?? 0;
}

export interface ListOpts { jobId: string; status?: MailRecipientStatus; limit?: number; offset?: number; }
export interface ListResult { items: MailSendRecipient[]; total: number; }

export async function list(opts: ListOpts,): Promise<ListResult> {
    const where: string[] = ['job_id = $1',];
    const values: unknown[] = [opts.jobId,];
    if (opts.status) { values.push(opts.status,); where.push(`status = $${values.length}`,); }
    const limit = Math.min(500, opts.limit ?? 100,);
    const offset = opts.offset ?? 0;

    const countRes = await query<{ n: number; }>(
        `SELECT COUNT(*)::int AS n FROM mail_send_recipients WHERE ${where.join(' AND ',)}`,
        values,
    );
    values.push(limit, offset,);
    const dataRes = await query<DbRow>(
        `SELECT * FROM mail_send_recipients WHERE ${where.join(' AND ',)}
         ORDER BY id LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
    );
    return { items: dataRes.rows.map(map,), total: countRes.rows[0].n, };
}
