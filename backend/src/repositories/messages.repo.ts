import type { ContactMessage, MessageStatus, } from '@rw/shared';
import { query, } from '../db';
import { NotFoundError, } from '../middleware/error';
import { mapRow, mapRows, } from '../utils/mapRow';
import { uuidOrNull, } from '../utils/uuid';
import { deleteById, PaginatedResult, PaginationOptions, } from './base.repo';

// ─── Messages ───

export interface MessageFilters {
    status?: string;
    search?: string;
}

export async function findMessages(
    filters: MessageFilters,
    pagination: PaginationOptions,
): Promise<PaginatedResult<ContactMessage> & { unreadCount: number; }> {
    const offset = (pagination.page - 1) * pagination.limit;

    let whereClause = 'WHERE 1=1';
    const params: unknown[] = [];

    if (filters.status) {
        params.push(filters.status,);
        whereClause += ` AND status = $${params.length}`;
    }

    if (filters.search) {
        params.push(`%${filters.search}%`,);
        whereClause +=
            ` AND (name ILIKE $${params.length} OR email ILIKE $${params.length} OR subject ILIKE $${params.length} OR message ILIKE $${params.length})`;
    }

    const countResult = await query(`SELECT COUNT(*) FROM contact_messages ${whereClause}`, params,);
    const total = parseInt(countResult.rows[0].count, 10,);

    params.push(pagination.limit, offset,);
    const result = await query(
        `SELECT * FROM contact_messages ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
    );

    const unreadResult = await query(
        `SELECT COUNT(*) FROM contact_messages WHERE status = 'unread'`,
    );
    const unreadCount = parseInt(unreadResult.rows[0].count, 10,);

    return {
        data: mapRows<ContactMessage>(result.rows,),
        total,
        unreadCount,
    };
}

export async function findMessageById(id: string,): Promise<ContactMessage> {
    const result = await query('SELECT * FROM contact_messages WHERE id = $1', [id,],);

    if (result.rows.length === 0) {
        throw new NotFoundError('Message',);
    }

    // Mark as read if unread
    if (result.rows[0].status === 'unread') {
        await query(
            `UPDATE contact_messages SET status = 'read' WHERE id = $1`,
            [id,],
        );
        result.rows[0].status = 'read';
    }

    return mapRow<ContactMessage>(result.rows[0],);
}

export async function createMessage(
    data: { name: string; email: string; subject?: string; message: string; },
    userId: string | null,
    ipAddress: string,
    userAgent: string | undefined,
): Promise<ContactMessage> {
    const result = await query(
        `INSERT INTO contact_messages (name, email, subject, message, user_id, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
        // user_id is a UUID FK; an API-key/synthetic submitter becomes NULL.
        [data.name, data.email, data.subject, data.message, uuidOrNull(userId,), ipAddress, userAgent,],
    );
    return mapRow<ContactMessage>(result.rows[0],);
}

export async function updateMessageStatus(
    id: string,
    status: MessageStatus,
    userId?: string,
): Promise<ContactMessage> {
    const updates: string[] = [`status = $1`,];
    const values: unknown[] = [status,];

    if (status === 'replied') {
        values.push(new Date().toISOString(),);
        updates.push(`replied_at = $${values.length}`,);
        // replied_by is a UUID FK; synthetic actors become NULL.
        values.push(uuidOrNull(userId,),);
        updates.push(`replied_by = $${values.length}`,);
    }

    values.push(id,);
    const result = await query(
        `UPDATE contact_messages SET ${updates.join(', ',)} WHERE id = $${values.length} RETURNING *`,
        values,
    );

    if (result.rows.length === 0) {
        throw new NotFoundError('Message',);
    }

    return mapRow<ContactMessage>(result.rows[0],);
}

export async function deleteMessage(id: string,): Promise<void> {
    return deleteById('contact_messages', id, 'Message',);
}

export async function bulkUpdateStatus(messageIds: string[], status: MessageStatus,): Promise<void> {
    await query(
        `UPDATE contact_messages SET status = $1 WHERE id = ANY($2)`,
        [status, messageIds,],
    );
}

export async function bulkDelete(messageIds: string[],): Promise<void> {
    await query(
        `DELETE FROM contact_messages WHERE id = ANY($1)`,
        [messageIds,],
    );
}
