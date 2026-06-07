import type { PatreonMembership, User, } from '@rw/cms-shared';
import bcrypt from 'bcryptjs';
import { query, transaction, } from '../db';
import { NotFoundError, } from '../middleware/error';
import { mapRow, } from '../utils/mapRow';
import { uuidOrNull, } from '../utils/uuid';
import { findByIdOrThrow, PaginatedResult, PaginationOptions, updateById, } from './base.repo';

export interface UserFilters {
    search?: string;
    role?: string;
    status?: string; // 'active' | 'banned' | 'inactive'
    sortBy?: string;
    sortOrder?: string;
}

const USER_SORT_COLUMNS: Record<string, string> = {
    email: 'u.email',
    display_name: 'u.display_name',
    role: 'u.role',
    created_at: 'u.created_at',
    updated_at: 'u.updated_at',
};

export interface UserWithSubscription extends User {
    subscription?: {
        planName: string;
        status: string;
        currentPeriodEnd: Date;
    } | null;
}

export async function findUsers(
    filters: UserFilters,
    pagination: PaginationOptions,
): Promise<PaginatedResult<UserWithSubscription>> {
    let whereClause = 'WHERE 1=1';
    const params: unknown[] = [];

    if (filters.search) {
        params.push(`%${filters.search}%`,);
        whereClause += ` AND (u.email ILIKE $${params.length} OR u.display_name ILIKE $${params.length})`;
    }
    if (filters.role) {
        params.push(filters.role,);
        whereClause += ` AND u.role = $${params.length}`;
    }
    if (filters.status === 'active') {
        whereClause += ` AND u.is_active = true AND u.is_banned = false`;
    } else if (filters.status === 'banned') {
        whereClause += ` AND u.is_banned = true`;
    } else if (filters.status === 'inactive') {
        whereClause += ` AND u.is_active = false`;
    }

    const countResult = await query(`SELECT COUNT(*) FROM users u ${whereClause}`, params,);
    const total = parseInt(countResult.rows[0].count, 10,);

    const offset = (pagination.page - 1) * pagination.limit;
    params.push(pagination.limit, offset,);
    const result = await query(
        `SELECT u.*,
            s.status as subscription_status,
            sp.name as subscription_plan_name,
            s.current_period_end as subscription_period_end
     FROM users u
     LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status IN ('active', 'past_due')
     LEFT JOIN subscription_plans sp ON s.plan_id = sp.id
     ${whereClause}
     ORDER BY ${USER_SORT_COLUMNS[filters.sortBy || 'created_at'] || 'u.created_at'} ${filters.sortOrder === 'asc' ? 'ASC' : 'DESC'}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
    );

    const data = result.rows.map((row,) => {
        const user = mapRow<UserWithSubscription>(row,);
        user.subscription = row.subscription_status ?
            {
                planName: row.subscription_plan_name,
                status: row.subscription_status,
                currentPeriodEnd: new Date(row.subscription_period_end,),
            } :
            null;
        return user;
    },);

    return { data, total, };
}

export async function findUserById(id: string,): Promise<User> {
    return findByIdOrThrow<User>('users', id, 'User',);
}

export async function findUserWithMembership(
    id: string,
): Promise<{ user: User; membership: PatreonMembership | null; }> {
    const user = await findUserById(id,);
    let membership: PatreonMembership | null = null;

    if (user.patreonId) {
        const result = await query(
            'SELECT * FROM patreon_memberships WHERE user_id = $1',
            [user.id,],
        );
        if (result.rows.length > 0) {
            membership = mapRow<PatreonMembership>(result.rows[0],);
        }
    }

    return { user, membership, };
}

export async function createUser(data: {
    email: string;
    password: string;
    displayName: string;
    role?: string;
},): Promise<User> {
    const passwordHash = await bcrypt.hash(data.password, 12,);

    const result = await query(
        `INSERT INTO users (email, password_hash, display_name, role, auth_provider)
     VALUES ($1, $2, $3, $4, 'email')
     RETURNING *`,
        [data.email, passwordHash, data.displayName, data.role || 'member',],
    );

    return mapRow<User>(result.rows[0],);
}

export async function updateUser(id: string, data: Record<string, unknown>,): Promise<User> {
    return updateById<User>('users', id, data, 'User',);
}

export async function banUser(
    userId: string,
    bannedBy: string,
    reason?: string,
    expiresAt?: string,
): Promise<void> {
    const userResult = await query('SELECT email FROM users WHERE id = $1', [userId,],);
    if (userResult.rows.length === 0) throw new NotFoundError('User',);

    const email = userResult.rows[0].email;

    await query('UPDATE users SET is_banned = true, updated_at = NOW() WHERE id = $1', [userId,],);
    await query(
        `INSERT INTO users_banned (email, reason, banned_by, expires_at) VALUES ($1, $2, $3, $4)`,
        // banned_by is a UUID FK; synthetic actors (api-key:<name>) become NULL.
        [email, reason, uuidOrNull(bannedBy,), expiresAt,],
    );
    await query('DELETE FROM user_sessions WHERE user_id = $1', [userId,],);
}

export async function unbanUser(userId: string,): Promise<void> {
    const userResult = await query('SELECT email FROM users WHERE id = $1', [userId,],);
    if (userResult.rows.length === 0) throw new NotFoundError('User',);

    await query('UPDATE users SET is_banned = false, updated_at = NOW() WHERE id = $1', [userId,],);
    await query('DELETE FROM users_banned WHERE email = $1', [userResult.rows[0].email,],);
}

export async function banIp(
    ipAddress: string,
    bannedBy: string,
    reason?: string,
    expiresAt?: string,
): Promise<void> {
    await query(
        `INSERT INTO users_banned (ip_address, reason, banned_by, expires_at) VALUES ($1, $2, $3, $4)`,
        // banned_by is a UUID FK; synthetic actors (api-key:<name>) become NULL.
        [ipAddress, reason, uuidOrNull(bannedBy,), expiresAt,],
    );
}

export async function findBans(pagination: PaginationOptions,): Promise<PaginatedResult<Record<string, unknown>>> {
    const countResult = await query('SELECT COUNT(*) FROM users_banned',);
    const total = parseInt(countResult.rows[0].count, 10,);

    const offset = (pagination.page - 1) * pagination.limit;
    const result = await query(
        `SELECT ub.*, u.display_name as banned_by_name
     FROM users_banned ub
     LEFT JOIN users u ON ub.banned_by = u.id
     ORDER BY ub.created_at DESC
     LIMIT $1 OFFSET $2`,
        [pagination.limit, offset,],
    );

    const data = result.rows.map((row,) => ({
        id: row.id,
        email: row.email,
        ipAddress: row.ip_address,
        reason: row.reason,
        bannedBy: row.banned_by,
        bannedByName: row.banned_by_name,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
    }));

    return { data, total, };
}

export async function removeBan(banId: string,): Promise<void> {
    const result = await query(
        'DELETE FROM users_banned WHERE id = $1 RETURNING email',
        [banId,],
    );
    if (result.rows.length === 0) throw new NotFoundError('Ban',);

    if (result.rows[0].email) {
        await query('UPDATE users SET is_banned = false WHERE email = $1', [result.rows[0].email,],);
    }
}

/**
 * Permanently delete a user row.
 *
 * Several tables reference `users(id)` WITHOUT an `ON DELETE` clause (so
 * they default to RESTRICT and would block a raw delete). These hold the
 * user's authorship/actor footprint (created/authored/uploaded/banned-by/
 * connected-by/replied-by/updated-by). We orphan those references to NULL
 * first — matching the intent of the columns that already declare
 * `ON DELETE SET NULL` — so authored content survives the deletion. The
 * remaining FKs (sessions, memberships, subscriptions, etc.) are already
 * ON DELETE CASCADE / SET NULL and resolve themselves on the final DELETE.
 * All of this runs in one transaction so the row is never half-deleted.
 */
export async function deleteUser(id: string,): Promise<void> {
    await transaction(async (client,) => {
        // Null the RESTRICT-bound actor columns (no ON DELETE clause in schema).
        const nullouts: Array<[string, string,]> = [
            ['users_banned', 'banned_by',],
            ['pages', 'created_by',],
            ['posts', 'author_id',],
            ['social_connections', 'connected_by',],
            ['media', 'uploaded_by',],
            ['campaigns', 'created_by',],
            ['forms', 'created_by',],
            ['contact_messages', 'replied_by',],
            ['site_settings', 'updated_by',],
        ];
        for (const [table, column,] of nullouts) {
            await client.query(
                `UPDATE ${table} SET ${column} = NULL WHERE ${column} = $1`,
                [id,],
            );
        }

        const result = await client.query(
            'DELETE FROM users WHERE id = $1 RETURNING id',
            [id,],
        );
        if (result.rows.length === 0) throw new NotFoundError('User',);
    },);
}
