/**
 * Admin transaction / subscription listers.
 *
 * Split out of `services/payments.ts` (SRP). `payments.ts` re-exports these
 * so the public import surface (`import * as payments`) is unchanged.
 */
import { query, } from '../db';
import { paginate, type Paginated, } from './payment/pagination';

export async function adminListSubscriptions(status: string | undefined, page: number, limit: number,): Promise<Paginated<unknown>> {
    const offset = (page - 1) * limit;
    let whereClause = 'WHERE 1=1';
    const params: unknown[] = [];

    if (status) {
        params.push(status,);
        whereClause += ` AND s.status = $${params.length}`;
    }

    const countResult = await query(`SELECT COUNT(*) FROM subscriptions s ${whereClause}`, params,);
    const total = parseInt(countResult.rows[0].count, 10,);

    params.push(limit, offset,);
    const result = await query(
        `SELECT s.*, sp.name as plan_name, sp.price_cents as plan_price_cents,
                u.email as user_email, u.display_name as user_name
         FROM subscriptions s
         JOIN subscription_plans sp ON s.plan_id = sp.id
         JOIN users u ON s.user_id = u.id
         ${whereClause}
         ORDER BY s.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
    );

    const subscriptions = result.rows.map((row,) => ({
        id: row.id,
        userId: row.user_id,
        userEmail: row.user_email,
        userName: row.user_name,
        planName: row.plan_name,
        planPriceCents: row.plan_price_cents,
        status: row.status,
        currentPeriodEnd: row.current_period_end,
        cancelAtPeriodEnd: row.cancel_at_period_end,
        createdAt: row.created_at,
    }));

    return paginate(subscriptions, page, limit, total,);
}

export async function adminListTransactions(
    filters: { type?: string; status?: string; },
    page: number,
    limit: number,
): Promise<Paginated<unknown>> {
    const offset = (page - 1) * limit;
    let whereClause = 'WHERE 1=1';
    const params: unknown[] = [];

    if (filters.type) {
        params.push(filters.type,);
        whereClause += ` AND t.type = $${params.length}`;
    }
    if (filters.status) {
        params.push(filters.status,);
        whereClause += ` AND t.status = $${params.length}`;
    }

    const countResult = await query(`SELECT COUNT(*) FROM transactions t ${whereClause}`, params,);
    const total = parseInt(countResult.rows[0].count, 10,);

    params.push(limit, offset,);
    const result = await query(
        `SELECT t.*, u.email as user_email, u.display_name as user_name, c.title as campaign_title
         FROM transactions t
         LEFT JOIN users u ON t.user_id = u.id
         LEFT JOIN campaigns c ON t.campaign_id = c.id
         ${whereClause}
         ORDER BY t.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
    );

    const transactions = result.rows.map((row,) => ({
        id: row.id,
        userId: row.user_id,
        userEmail: row.user_email,
        userName: row.user_name,
        type: row.type,
        amountCents: row.amount_cents,
        currency: row.currency,
        status: row.status,
        description: row.description,
        campaignTitle: row.campaign_title,
        createdAt: row.created_at,
    }));

    return paginate(transactions, page, limit, total,);
}

export async function adminListUserTransactions(userId: string, page: number, limit: number,): Promise<Paginated<unknown>> {
    const offset = (page - 1) * limit;

    const countResult = await query('SELECT COUNT(*) FROM transactions WHERE user_id = $1', [userId,],);
    const total = parseInt(countResult.rows[0].count, 10,);

    const result = await query(
        `SELECT t.*, c.title as campaign_title
         FROM transactions t
         LEFT JOIN campaigns c ON t.campaign_id = c.id
         WHERE t.user_id = $1
         ORDER BY t.created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset,],
    );

    const transactions = result.rows.map((row,) => ({
        id: row.id,
        type: row.type,
        amountCents: row.amount_cents,
        currency: row.currency,
        status: row.status,
        description: row.description,
        campaignTitle: row.campaign_title,
        createdAt: row.created_at,
    }));

    return paginate(transactions, page, limit, total,);
}
