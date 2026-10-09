/**
 * Shared bulk action helper for admin list endpoints.
 * Supports bulk delete (soft via status='deleted') and bulk status change.
 */
import { z, } from 'zod';
import { query, } from '../db';
import { ValidationError, } from '../middleware/error';

export const bulkActionSchema = z.object({
    ids: z.array(z.string(),).min(1,).max(500,),
    action: z.enum(['delete', 'status',],),
    value: z.string().optional(),
},);

export interface BulkActionConfig {
    table: string;
    /** Allowed status values when action='status' */
    allowedStatuses?: string[];
    /** If true, delete action sets status='deleted' instead of DELETE */
    softDelete?: boolean;
    /** Cache invalidator called on success */
    onInvalidate?: () => Promise<void> | void;
    /**
     * Trash semantics: with soft delete, ids that are ALREADY `deleted` (the
     * trash view) are deleted PERMANENTLY through this callback — the
     * module's own single-item remove, so related data (blocks, media,
     * revisions) goes with them. Without it, deleting from the trash would
     * just re-trash the row.
     */
    purgeTrashed?: (ids: string[],) => Promise<void>;
}

export interface BulkActionResult {
    updated: number;
    action: 'delete' | 'status';
}

/** Validate + run a bulk action. Throws (ZodError / ValidationError) on
 *  bad input — callers in the route framework let the central error
 *  middleware shape the response. */
export async function performBulkAction(
    body: unknown,
    config: BulkActionConfig,
): Promise<BulkActionResult> {
    const { ids, action, value, } = bulkActionSchema.parse(body,);

    if (action === 'status') {
        if (!value) throw new ValidationError('status value is required',);
        if (config.allowedStatuses && !config.allowedStatuses.includes(value,)) {
            throw new ValidationError(`invalid status: ${value}`,);
        }
        await query(
            `UPDATE ${config.table} SET status = $1, updated_at = NOW() WHERE id = ANY($2::uuid[])`,
            [value, ids,],
        );
    } else if (action === 'delete') {
        if (config.softDelete !== false) {
            let toTrash = ids;
            if (config.purgeTrashed) {
                const trashed = await query<{ id: string; }>(
                    `SELECT id FROM ${config.table} WHERE id = ANY($1::uuid[]) AND status = 'deleted'`,
                    [ids,],
                );
                const purge = trashed.rows.map((r,) => r.id);
                if (purge.length) await config.purgeTrashed(purge,);
                toTrash = ids.filter((id,) => !purge.includes(id,));
            }
            if (toTrash.length) {
                await query(
                    `UPDATE ${config.table} SET status = 'deleted', updated_at = NOW() WHERE id = ANY($1::uuid[])`,
                    [toTrash,],
                );
            }
        } else {
            await query(
                `DELETE FROM ${config.table} WHERE id = ANY($1::uuid[])`,
                [ids,],
            );
        }
    }

    if (config.onInvalidate) await config.onInvalidate();
    return { updated: ids.length, action, };
}

