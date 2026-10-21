/**
 * Component collections — folders for components on /admin/components.
 *
 * Organisation only: rendering never reads them. "[None]" is not a row; it is
 * `content_block_templates.collection_id IS NULL` (and only components — rows
 * with no entity type — are counted or filed).
 */
import type { ComponentCollection, ComponentCollectionsListResponse, } from '@sitesurge/types';
import { NotFoundError, ValidationError, } from '../core/errors';
import { query, transaction, } from '../db';
import { cache, } from './cache';
import * as templates from './contentBlockTemplates';

interface Row {
    id: string;
    name: string;
    description: string | null;
    count: number | string;
    created_at: Date;
    updated_at: Date;
}

const toCollection = (r: Row,): ComponentCollection => ({
    id: r.id,
    name: r.name,
    description: r.description,
    count: Number(r.count ?? 0,),
    createdAt: new Date(r.created_at,).toISOString(),
    updatedAt: new Date(r.updated_at,).toISOString(),
});

const COUNT_SQL = `(SELECT COUNT(*) FROM content_block_templates t
                     WHERE t.collection_id = c.id AND t.entity_type_key IS NULL)`;

export async function list(): Promise<ComponentCollectionsListResponse> {
    const [rows, none,] = await Promise.all([
        query<Row>(`SELECT c.*, ${COUNT_SQL} AS count FROM component_collections c ORDER BY lower(c.name), c.created_at`,),
        query<{ n: number; }>(
            `SELECT COUNT(*)::int AS n FROM content_block_templates WHERE entity_type_key IS NULL AND collection_id IS NULL`,
        ),
    ],);
    return { collections: rows.rows.map(toCollection,), noneCount: Number(none.rows[0]?.n ?? 0,), };
}

async function get(id: string,): Promise<ComponentCollection> {
    const r = await query<Row>(`SELECT c.*, ${COUNT_SQL} AS count FROM component_collections c WHERE c.id = $1`, [id,],);
    if (!r.rows[0]) throw new NotFoundError('Collection',);
    return toCollection(r.rows[0],);
}

function clean(body: { name: string; description?: string | null; },) {
    const name = body.name?.trim();
    if (!name) throw new ValidationError('A collection needs a name.',);
    return { name: name.slice(0, 200,), description: body.description?.trim() || null, };
}

export async function create(body: { name: string; description?: string | null; },): Promise<ComponentCollection> {
    const b = clean(body,);
    const r = await query<{ id: string; }>(
        `INSERT INTO component_collections (name, description) VALUES ($1, $2) RETURNING id`,
        [b.name, b.description,],
    );
    return get(r.rows[0].id,);
}

export async function update(id: string, body: { name: string; description?: string | null; },): Promise<ComponentCollection> {
    const b = clean(body,);
    const r = await query(
        `UPDATE component_collections SET name = $2, description = $3, updated_at = NOW() WHERE id = $1`,
        [id, b.name, b.description,],
    );
    if (!r.rowCount) throw new NotFoundError('Collection',);
    return get(id,);
}

/**
 * Delete a collection. Its components go to [None] (`detach`) or are deleted
 * (`delete`, in the same transaction; pending revisions are cancelled and the
 * caches cleared after). Returns how many components were affected.
 */
export async function remove(id: string, components: 'detach' | 'delete' = 'detach',): Promise<number> {
    await get(id,);
    const members = await query<{ id: string; }>(
        `SELECT id FROM content_block_templates WHERE collection_id = $1 AND entity_type_key IS NULL`,
        [id,],
    );
    // ONE transaction: the components (their blocks cascade) and the
    // collection go together, or nothing does. detach = the FK's ON DELETE SET NULL.
    await transaction(async (client,) => {
        if (components === 'delete') {
            await client.query(`DELETE FROM content_block_templates WHERE collection_id = $1 AND entity_type_key IS NULL`, [id,],);
        }
        await client.query(`DELETE FROM component_collections WHERE id = $1`, [id,],);
    },);
    if (components === 'delete') for (const m of members.rows) templates.cancelPendingRevision(m.id,);
    await cache.invalidateContentBlockTemplatesGlobalCache();
    return members.rowCount ?? members.rows.length;
}
