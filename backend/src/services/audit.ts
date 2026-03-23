import { query, } from '../db';
import { logger, } from '../utils/logger';

interface AuditLogEntry {
    userId: string;
    action: string; // 'create' | 'update' | 'delete' | 'ban' | 'unban' etc.
    entityType: string; // 'page' | 'post' | 'campaign' | 'form' | 'user' | 'media' | 'settings'
    entityId?: string;
    oldValues?: Record<string, unknown>;
    newValues?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
}

export async function logAudit(entry: AuditLogEntry,): Promise<void> {
    try {
        await query(
            `INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
                entry.userId,
                entry.action,
                entry.entityType,
                entry.entityId || null,
                entry.oldValues ? JSON.stringify(entry.oldValues,) : null,
                entry.newValues ? JSON.stringify(entry.newValues,) : null,
                entry.ipAddress || null,
                entry.userAgent || null,
            ],
        );
    } catch (error) {
        // Log but don't throw - audit failures shouldn't break the main operation
        logger.error('Failed to write audit log', { error, entry, },);
    }
}
