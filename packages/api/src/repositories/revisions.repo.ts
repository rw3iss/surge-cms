/**
 * Revisions repository — snapshot history for content entities.
 */
import type { Revision as SharedRevision, RevisionEntityType, } from '@rw/cms-shared';
import { query, } from '../db';
import { NotFoundError, } from '../middleware/error';
import { mapRow, mapRows, } from '../utils/mapRow';
import { uuidOrNull, } from '../utils/uuid';

export type { RevisionEntityType, };

// Backend rows use a Date for createdAt; the shared type uses string (wire format).
export type Revision = Omit<SharedRevision, 'createdAt'> & { createdAt: Date; };

/** Creates a new revision for the given entity. Auto-increments version. */
export async function createRevision(
    entityType: RevisionEntityType,
    entityId: string,
    snapshot: Record<string, unknown>,
    authorId: string | null,
    summary?: string,
): Promise<Revision> {
    const versionResult = await query(
        `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
         FROM revisions WHERE entity_type = $1 AND entity_id = $2`,
        [entityType, entityId,],
    );
    const nextVersion = versionResult.rows[0].next_version as number;

    // author_id is a UUID FK; synthetic actors (api-key:<name>, system) become NULL.
    const authorForDb = uuidOrNull(authorId,);

    const result = await query(
        `INSERT INTO revisions (entity_type, entity_id, version, snapshot, author_id, summary)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [entityType, entityId, nextVersion, JSON.stringify(snapshot,), authorForDb, summary || null,],
    );
    return mapRow<Revision>(result.rows[0],);
}

/** Lists revisions for an entity, newest first. Does not include snapshot data. */
export async function listRevisions(
    entityType: RevisionEntityType,
    entityId: string,
    limit = 50,
): Promise<Revision[]> {
    const result = await query(
        `SELECT r.id, r.entity_type, r.entity_id, r.version, r.author_id, r.summary, r.created_at,
                u.display_name AS author_name
         FROM revisions r
         LEFT JOIN users u ON r.author_id = u.id
         WHERE r.entity_type = $1 AND r.entity_id = $2
         ORDER BY r.version DESC
         LIMIT $3`,
        [entityType, entityId, limit,],
    );
    return mapRows<Revision>(result.rows,);
}

/** Gets a single revision with snapshot. */
export async function getRevision(
    entityType: RevisionEntityType,
    entityId: string,
    version: number,
): Promise<Revision> {
    const result = await query(
        `SELECT r.*, u.display_name AS author_name
         FROM revisions r
         LEFT JOIN users u ON r.author_id = u.id
         WHERE r.entity_type = $1 AND r.entity_id = $2 AND r.version = $3`,
        [entityType, entityId, version,],
    );
    if (result.rows.length === 0) throw new NotFoundError('Revision',);
    return mapRow<Revision>(result.rows[0],);
}

/** Prunes old revisions, keeping at most `keep` per entity. */
export async function pruneRevisions(
    entityType: RevisionEntityType,
    entityId: string,
    keep = 50,
): Promise<void> {
    await query(
        `DELETE FROM revisions
         WHERE entity_type = $1 AND entity_id = $2
         AND version <= (
            SELECT COALESCE(MAX(version), 0) - $3
            FROM revisions WHERE entity_type = $1 AND entity_id = $2
         )`,
        [entityType, entityId, keep,],
    );
}
