import { query, } from '../db';
import { logger, } from '../utils/logger';
import { uuidOrNull, } from '../utils/uuid';

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
