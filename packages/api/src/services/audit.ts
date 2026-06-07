import { query, } from '../db';
import { logger, } from '../utils/logger';
import { uuidOrNull, } from '../utils/uuid';
import type { ListResult, } from './types';

export interface AuditListFilters {
    entityType?: string;
    action?: string;
    userId?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
}

/** Paginated audit-log listing with optional entity/action/user/date
 *  filters. Joins the acting user for display name + email. */
export async function list(filters: AuditListFilters = {},): Promise<ListResult<Record<string, unknown>>> {
    const pageNum = Math.max(1, Number(filters.page ?? 1,),);
    const limitNum = Math.min(100, Math.max(1, Number(filters.limit ?? 50,),),);
    const offset = (pageNum - 1) * limitNum;

    let whereClause = 'WHERE 1=1';
    const params: unknown[] = [];

    if (filters.entityType) {
        params.push(filters.entityType,);
        whereClause += ` AND al.entity_type = $${params.length}`;
    }

    if (filters.action) {
        params.push(filters.action,);
        whereClause += ` AND al.action = $${params.length}`;
    }

    if (filters.userId) {
        params.push(filters.userId,);
        whereClause += ` AND al.user_id = $${params.length}`;
    }

    if (filters.startDate) {
        params.push(filters.startDate,);
        whereClause += ` AND al.created_at >= $${params.length}`;
    }

    if (filters.endDate) {
        params.push(filters.endDate,);
        whereClause += ` AND al.created_at <= $${params.length}`;
    }

    const countResult = await query(
        `SELECT COUNT(*) FROM audit_log al ${whereClause}`,
        params,
    );
    const total = parseInt(countResult.rows[0].count, 10,);

    params.push(limitNum, offset,);
    const result = await query(
        `SELECT al.id, al.user_id, al.action, al.entity_type, al.entity_id,
              al.old_values, al.new_values, al.ip_address, al.user_agent, al.created_at,
              u.display_name as user_display_name, u.email as user_email
       FROM audit_log al
       LEFT JOIN users u ON al.user_id = u.id
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
    );

    const data = result.rows.map((row,) => ({
        id: row.id,
        userId: row.user_id,
        userDisplayName: row.user_display_name,
        userEmail: row.user_email,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        oldValues: row.old_values,
        newValues: row.new_values,
        ipAddress: row.ip_address,
        userAgent: row.user_agent,
        createdAt: row.created_at,
    }));

    return {
        data,
        meta: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum,),
        },
    };
}

interface AuditLogEntry {
    userId: string;
    action: string; // 'create' | 'update' | 'delete' | 'ban' | 'unban' etc.
    entityType: string; // 'page' | 'post' | 'campaign' | 'form' | 'user' | 'media' | 'settings'
    /**
     * Entity primary key (UUID), OR a settings-row key like
     * 'site_branding' / 'features'. Non-UUID strings are stored in
     * `new_values.entityKey` rather than the `entity_id` column,
     * since `audit_log.entity_id` is UUID-typed.
     */
    entityId?: string;
    oldValues?: Record<string, unknown>;
    newValues?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function logAudit(entry: AuditLogEntry,): Promise<void> {
    try {
        // audit_log.entity_id is UUID-typed. Non-UUID entityIds (the
        // settings keys like 'features', 'site_branding') get null'd
        // out for the column and folded into newValues so the
        // information is preserved.
        const isUuidId = entry.entityId && UUID_RE.test(entry.entityId,);
        const entityIdForDb = isUuidId ? entry.entityId! : null;
        const newValues = !isUuidId && entry.entityId
            ? { ...(entry.newValues ?? {}), entityKey: entry.entityId, }
            : entry.newValues;

        // user_id is a UUID FK. Synthetic actors ('system',
        // 'api-key:<name>') get NULL in the column and are preserved
        // in new_values.actor — same pattern as non-UUID entityIds.
        const userIdForDb = uuidOrNull(entry.userId,);
        const isUuidUser = userIdForDb !== null;
        const valuesWithActor = !isUuidUser
            ? { ...(newValues ?? {}), actor: entry.userId, }
            : newValues;

        await query(
            `INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
                userIdForDb,
                entry.action,
                entry.entityType,
                entityIdForDb,
                entry.oldValues ? JSON.stringify(entry.oldValues,) : null,
                valuesWithActor ? JSON.stringify(valuesWithActor,) : null,
                entry.ipAddress || null,
                entry.userAgent || null,
            ],
        );
    } catch (error) {
        // Log but don't throw - audit failures shouldn't break the main operation
        logger.error('Failed to write audit log', { error, entry, },);
    }
}
