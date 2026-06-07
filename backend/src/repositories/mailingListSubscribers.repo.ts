/**
 * Data access for `mailing_list_subscribers`. Subscribers can be
 * registered users (user_id set) or email-only entries (user_id null).
 * `email` is stored lowercased + denormalized so send-time queries
 * never join through `users` and lists survive user deletion.
 *
 * The unsubscribe HMAC token is generated at insert time and stored on
 * the row (`unsubscribe_token`) so links in old emails always remain
 * valid; rotating `MAIL_UNSUBSCRIBE_SECRET` is the only way to
 * invalidate them.
 */
import type { MailingListSubscriber, SubscriberStatus, } from '@rw/cms-shared';
import { query, } from '../db';
import { generateUnsubscribeToken, } from '../services/mail/unsubscribe';

interface DbRow {
    id: string;
    list_id: string;
    user_id: string | null;
    email: string;
    name: string | null;
    phone: string | null;
    status: SubscriberStatus;
    confirmation_token: string | null;
    unsubscribe_token: string;
    custom_fields: Record<string, unknown> | null;
    subscribed_at: Date;
    confirmed_at: Date | null;
    unsubscribed_at: Date | null;
    last_send_at: Date | null;
}

function map(row: DbRow,): MailingListSubscriber {
    const out: MailingListSubscriber = {
        id: row.id,
        listId: row.list_id,
        userId: row.user_id,
        email: row.email,
        status: row.status,
        customFields: row.custom_fields ?? {},
        subscribedAt: row.subscribed_at.toISOString(),
    };
    if (row.name) out.name = row.name;
    if (row.phone) out.phone = row.phone;
    if (row.confirmed_at) out.confirmedAt = row.confirmed_at.toISOString();
    if (row.unsubscribed_at) out.unsubscribedAt = row.unsubscribed_at.toISOString();
    if (row.last_send_at) out.lastSendAt = row.last_send_at.toISOString();
    return out;
}

export interface ListSubscribersOpts {
    listId: string;
    search?: string;
    status?: SubscriberStatus;
    limit?: number;
    offset?: number;
}

export interface ListSubscribersResult { items: MailingListSubscriber[]; total: number; }

export async function list(opts: ListSubscribersOpts,): Promise<ListSubscribersResult> {
    const where: string[] = ['list_id = $1',];
    const values: unknown[] = [opts.listId,];
    if (opts.search) {
        values.push(`%${opts.search.toLowerCase()}%`,);
        where.push(`(lower(email) LIKE $${values.length} OR lower(coalesce(name,'')) LIKE $${values.length})`,);
    }
    if (opts.status) {
        values.push(opts.status,);
        where.push(`status = $${values.length}`,);
    }
    const limit = Math.min(200, opts.limit ?? 50,);
    const offset = opts.offset ?? 0;

    const countRes = await query<{ n: number; }>(
        `SELECT COUNT(*)::int AS n FROM mailing_list_subscribers WHERE ${where.join(' AND ',)}`,
        values,
    );
    values.push(limit, offset,);
    const dataRes = await query<DbRow>(
        `SELECT * FROM mailing_list_subscribers WHERE ${where.join(' AND ',)}
         ORDER BY subscribed_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
    );
    return { items: dataRes.rows.map(map,), total: countRes.rows[0].n, };
}

export async function findById(id: string,): Promise<MailingListSubscriber | null> {
    const r = await query<DbRow>(`SELECT * FROM mailing_list_subscribers WHERE id = $1`, [id,],);
    return r.rows[0] ? map(r.rows[0],) : null;
}

export async function findByEmail(listId: string, email: string,): Promise<MailingListSubscriber | null> {
    const r = await query<DbRow>(
        `SELECT * FROM mailing_list_subscribers WHERE list_id = $1 AND lower(email) = lower($2)`,
        [listId, email,],
    );
    return r.rows[0] ? map(r.rows[0],) : null;
}

export interface CreateInput {
    listId: string;
    email: string;
    name?: string;
    phone?: string;
    userId?: string | null;
    status?: SubscriberStatus;
    customFields?: Record<string, unknown>;
    confirmationToken?: string | null;
}

export async function create(input: CreateInput,): Promise<MailingListSubscriber> {
    const idRes = await query<{ id: string; }>(`SELECT gen_random_uuid()::text AS id`,);
    const id = idRes.rows[0].id;
    const token = generateUnsubscribeToken(id, input.listId,);
    const r = await query<DbRow>(`
        INSERT INTO mailing_list_subscribers
            (id, list_id, user_id, email, name, phone, status, confirmation_token, unsubscribe_token, custom_fields)
        VALUES ($1, $2, $3, lower($4), $5, $6, COALESCE($7, 'subscribed'), $8, $9, COALESCE($10::jsonb, '{}'::jsonb))
        RETURNING *
    `, [
        id,
        input.listId,
        input.userId ?? null,
        input.email,
        input.name ?? null,
        input.phone ?? null,
        input.status ?? null,
        input.confirmationToken ?? null,
        token,
        input.customFields ? JSON.stringify(input.customFields,) : null,
    ],);
    return map(r.rows[0],);
}

export async function setStatus(id: string, status: SubscriberStatus,): Promise<void> {
    // Status changes also stamp a timestamp column so we can see when
    // a subscriber confirmed / unsubscribed / bounced.
    let stampCol: string;
    switch (status) {
        case 'subscribed': stampCol = 'confirmed_at'; break;
        case 'pending_confirmation': stampCol = 'subscribed_at'; break;
        case 'unsubscribed':
        case 'bounced':
        case 'complained': stampCol = 'unsubscribed_at'; break;
    }
    await query(
        `UPDATE mailing_list_subscribers SET status = $1, ${stampCol} = NOW() WHERE id = $2`,
        [status, id,],
    );
}

export interface UpdateInput {
    name?: string;
    phone?: string;
    email?: string;
    customFields?: Record<string, unknown>;
}

export async function update(id: string, patch: UpdateInput,): Promise<MailingListSubscriber | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (patch.name !== undefined) { values.push(patch.name,); fields.push(`name = $${values.length}`,); }
    if (patch.phone !== undefined) { values.push(patch.phone,); fields.push(`phone = $${values.length}`,); }
    if (patch.email !== undefined) { values.push(patch.email.toLowerCase(),); fields.push(`email = $${values.length}`,); }
    if (patch.customFields !== undefined) {
        values.push(JSON.stringify(patch.customFields,),);
        fields.push(`custom_fields = $${values.length}::jsonb`,);
    }
    if (fields.length === 0) return findById(id,);
    values.push(id,);
    const r = await query<DbRow>(
        `UPDATE mailing_list_subscribers SET ${fields.join(', ',)} WHERE id = $${values.length} RETURNING *`,
        values,
    );
    return r.rows[0] ? map(r.rows[0],) : null;
}

export async function remove(id: string,): Promise<void> {
    await query(`DELETE FROM mailing_list_subscribers WHERE id = $1`, [id,],);
}

export async function bulkRemove(ids: string[],): Promise<void> {
    if (ids.length === 0) return;
    await query(`DELETE FROM mailing_list_subscribers WHERE id = ANY($1::uuid[])`, [ids,],);
}

export async function findByConfirmationToken(listId: string, token: string,): Promise<MailingListSubscriber | null> {
    const r = await query<DbRow>(
        `SELECT * FROM mailing_list_subscribers WHERE list_id = $1 AND confirmation_token = $2`,
        [listId, token,],
    );
    return r.rows[0] ? map(r.rows[0],) : null;
}

export async function clearConfirmationToken(id: string,): Promise<void> {
    await query(`UPDATE mailing_list_subscribers SET confirmation_token = NULL WHERE id = $1`, [id,],);
}

/** Subscribers ready to receive a send. */
export async function listSubscribedForSend(listId: string,): Promise<Array<{ id: string; email: string; }>> {
    const r = await query<{ id: string; email: string; }>(
        `SELECT id, email FROM mailing_list_subscribers WHERE list_id = $1 AND status = 'subscribed'`,
        [listId,],
    );
    return r.rows;
}
