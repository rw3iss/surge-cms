/**
 * Block stores — ONE description of where each block-bearing entity keeps its
 * content blocks, shared by everything that handles a block tree as a whole:
 *
 *   - versioning  (`services/revisions.ts` — snapshot / restore)
 *   - cloning     (`entities/recordCopy.ts`, mail template copy — `cloneBlockTree`)
 *
 * The tables do NOT share a shape, which is the whole reason this exists:
 * `blocks` orders by `"order"` and nests via `parent_block_id`;
 * `post_content_blocks` orders by `sort_order` and does not nest;
 * `mail_template_blocks` orders by `position` and nests. Code that assumed one
 * shape kept breaking on the others.
 *
 * Every operation here copies/serialises ALL columns by name (read from
 * `information_schema`), not a hand-written list — settings, style (with its
 * per-breakpoint bags + custom CSS), content, visibility, and any column a
 * later migration adds. A hand-written list silently drops the new column.
 *
 * Adding a block-bearing entity: add an entry here (and to `RevisionEntityType`
 * in `@sitesurge/types` if it should be versioned).
 */
import { randomUUID, } from 'crypto';
import type { PoolClient, } from 'pg';
import { logger, } from '../utils/logger';

export interface BlockStore {
    /** The entity's own table. */
    entityTable: string;
    /** Its blocks table. */
    table: string;
    /** Column on `table` pointing at the entity. */
    fk: string;
    /** ORDER BY expression for siblings (quoted when it is a keyword). */
    orderCol: string;
    /** Self-nesting column, or null when the table is flat. */
    parentCol: string | null;
}

export const BLOCK_STORES = {
    page: { entityTable: 'pages', table: 'blocks', fk: 'page_id', orderCol: '"order"', parentCol: 'parent_block_id', },
    post: { entityTable: 'posts', table: 'post_content_blocks', fk: 'post_id', orderCol: 'sort_order', parentCol: null, },
    mail_template: {
        entityTable: 'mail_templates',
        table: 'mail_template_blocks',
        fk: 'template_id',
        orderCol: 'position',
        parentCol: 'parent_block_id',
    },
} as const satisfies Record<string, BlockStore>;

export type BlockStoreKey = keyof typeof BLOCK_STORES;

export interface ColumnMeta {
    name: string;
    /** GENERATED ALWAYS column — cannot be inserted into. */
    generated: boolean;
}

/** Columns of a table, in ordinal order, flagging generated columns. */
export async function tableColumns(client: PoolClient, table: string,): Promise<ColumnMeta[]> {
    const r = await client.query(
        `SELECT column_name, is_generated
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1
         ORDER BY ordinal_position`,
        [table,],
    );
    return r.rows.map((row,) => ({ name: row.column_name as string, generated: row.is_generated === 'ALWAYS', }));
}

/**
 * Copy every block of `oldParentId` in `table` to `newParentId`, all columns,
 * with fresh ids — re-linking nested children (`parent_block_id`) through an
 * old→new id map so the tree keeps its shape. Runs inside the caller's
 * transaction.
 */
export async function cloneBlockTree(
    client: PoolClient,
    table: string,
    fk: string,
    oldParentId: string,
    newParentId: string,
): Promise<number> {
    const cols = (await tableColumns(client, table,)).filter((c,) => !c.generated,);
    const names = cols.map((c,) => c.name,);
    const hasParent = names.includes('parent_block_id',);

    const src = await client.query(
        `SELECT id, ${hasParent ? 'parent_block_id' : 'NULL::uuid AS parent_block_id'}
         FROM "${table}" WHERE "${fk}" = $1`,
        [oldParentId,],
    );
    if (src.rows.length === 0) return 0;

    const idMap = new Map<string, string>();
    for (const r of src.rows) idMap.set(r.id as string, randomUUID(),);

    // Columns copied verbatim (all except id / fk / parent — overridden — and
    // created_at / updated_at, which default fresh).
    const OVERRIDE = new Set(['id', fk, 'created_at', 'updated_at',],);
    if (hasParent) OVERRIDE.add('parent_block_id',);
    const copyCols = names.filter((c,) => !OVERRIDE.has(c,));

    // Pass 1 — insert every clone with a NULL parent (order-independent).
    for (const r of src.rows) {
        const insertCols = ['"id"', `"${fk}"`,];
        const selectExprs = ['$2', '$3',];
        const params: unknown[] = [r.id, idMap.get(r.id as string), newParentId,];
        if (hasParent) {
            insertCols.push('"parent_block_id"',);
            selectExprs.push('NULL::uuid',);
        }
        for (const c of copyCols) {
            insertCols.push(`"${c}"`,);
            selectExprs.push(`"${c}"`,);
        }
        await client.query(
            `INSERT INTO "${table}" (${insertCols.join(', ',)})
             SELECT ${selectExprs.join(', ',)} FROM "${table}" WHERE id = $1`,
            params,
        );
    }

    // Pass 2 — re-link cloned children to their cloned parents.
    if (hasParent) {
        for (const r of src.rows) {
            const oldParent = r.parent_block_id as string | null;
            if (!oldParent) continue;
            const newParent = idMap.get(oldParent,);
            if (!newParent) continue; // parent outside this record's set (defensive)
            await client.query(
                `UPDATE "${table}" SET parent_block_id = $1 WHERE id = $2`,
                [newParent, idMap.get(r.id as string),],
            );
        }
    }
    logger.debug(`blockStores: cloned ${src.rows.length} row(s) of ${table} → ${newParentId}`,);
    return src.rows.length;
}
