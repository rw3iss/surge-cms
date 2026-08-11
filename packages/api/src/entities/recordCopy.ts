/**
 * Generic entity record duplication ("copy"/"duplicate").
 *
 * Deep-clones one entity record of any registered type:
 *   1. The BASE row is cloned via `INSERT … SELECT` (so JSONB / array / every
 *      column is copied faithfully in-SQL, no serialization round-trip), letting
 *      the table's own defaults mint a fresh `id` + timestamps.
 *   2. UNIQUE columns are given a fresh value so the clone can't collide. The set
 *      of unique columns is derived from the LIVE DB (single-column unique
 *      indexes/constraints) UNIONed with the type's `unique`-flagged fields — so
 *      it's correct even when a table has a unique column the schema doesn't
 *      model (e.g. `users.email`, `campaigns.slug`). String values get an
 *      incrementing `-N` suffix probed until free; a boolean singleton flag
 *      (e.g. the partial-unique `pages.is_homepage`) resets to `false`.
 *   3. RELATED child rows are cloned for the handful of types that own a child
 *      block table (`page` → `blocks`, `post` → `post_content_blocks`),
 *      re-pointed at the new parent and, when the child table self-nests
 *      (`parent_block_id`), internally re-linked via an old→new id map.
 *
 * All of this runs inside ONE transaction (the caller wraps it), so a failure
 * rolls the whole clone back.
 */
import { randomUUID, } from 'crypto';
import type { PoolClient, } from 'pg';
import type { EntityTypeDef, } from '@sitesurge/types';
import { assertSafeIdentifier, columnFor, } from './columnMap';
import { NotFoundError, } from '../middleware/error';
import { logger, } from '../utils/logger';

/**
 * Child tables owned by a core type whose rows must be cloned alongside the
 * base record. Keyed by entity type key. Each descriptor names the child table
 * and the FK column pointing back at the parent record. A self-nesting column
 * (`parent_block_id`) is detected automatically and re-linked.
 *
 * Extend this map to teach a new entity type to deep-copy its related rows.
 */
const CHILD_TABLES: Record<string, { table: string; fk: string; }[]> = {
    page: [{ table: 'blocks', fk: 'page_id', },],
    post: [{ table: 'post_content_blocks', fk: 'post_id', },],
};

interface ColumnMeta {
    name: string;
    /** GENERATED ALWAYS column — cannot be inserted into. */
    generated: boolean;
}

/** Columns of a table, in ordinal order, flagging generated columns. */
async function tableColumns(client: PoolClient, table: string,): Promise<ColumnMeta[]> {
    const r = await client.query(
        `SELECT column_name, is_generated
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1
         ORDER BY ordinal_position`,
        [table,],
    );
    return r.rows.map((row,) => ({ name: row.column_name as string, generated: row.is_generated === 'ALWAYS', }));
}

/** Single-column UNIQUE indexes/constraints on a table (excluding the `id` PK). */
async function uniqueColumns(client: PoolClient, table: string,): Promise<Set<string>> {
    const r = await client.query(
        `SELECT a.attname AS col
         FROM pg_index i
         JOIN pg_class t ON t.oid = i.indrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = i.indkey[0]
         WHERE i.indisunique AND i.indnatts = 1
           AND t.relname = $1 AND n.nspname = 'public'`,
        [table,],
    );
    const set = new Set<string>();
    for (const row of r.rows) {
        if (row.col && row.col !== 'id') set.add(row.col as string,);
    }
    return set;
}

/** Probe `${base}-1`, `${base}-2`, … against a column until one is free. */
async function uniqueSuffixed(
    client: PoolClient,
    table: string,
    col: string,
    base: string,
): Promise<string> {
    for (let n = 1; n <= 1000; n++) {
        const candidate = `${base}-${n}`;
        const r = await client.query(
            `SELECT 1 FROM "${table}" WHERE "${col}" = $1 LIMIT 1`,
            [candidate,],
        );
        if (r.rows.length === 0) return candidate;
    }
    // Extremely unlikely fallback — a random suffix is effectively collision-free.
    return `${base}-${randomUUID().slice(0, 8,)}`;
}

/**
 * Clone the base row of `sourceId` in `typeDef`'s table, returning the new id.
 * Excludes `id` / `created_at` / `updated_at` (defaults mint fresh values) and
 * any GENERATED column; overrides unique columns with fresh values.
 */
async function cloneBaseRow(client: PoolClient, typeDef: EntityTypeDef, sourceId: string,): Promise<string> {
    const table = assertSafeIdentifier(typeDef.tableName, 'table name',);
    const cols = await tableColumns(client, table,);
    if (cols.length === 0) throw new NotFoundError(`Table "${table}"`,);

    const src = await client.query(`SELECT * FROM "${table}" WHERE id = $1`, [sourceId,],);
    if (src.rows.length === 0) throw new NotFoundError(`${typeDef.label} "${sourceId}"`,);
    const row = src.rows[0] as Record<string, unknown>;

    // Unique columns: live DB constraints ∪ schema `unique` fields.
    const unique = await uniqueColumns(client, table,);
    for (const f of typeDef.fields) {
        if (f.unique) {
            try {
                unique.add(columnFor(f,),);
            } catch { /* non-column field (e.g. blocks) — ignore */ }
        }
    }

    const EXCLUDE = new Set(['id', 'created_at', 'updated_at',],);
    const insertCols: string[] = [];
    const selectExprs: string[] = [];
    const params: unknown[] = [sourceId]; // $1 = source id (WHERE)

    for (const c of cols) {
        if (c.generated || EXCLUDE.has(c.name,)) continue;
        insertCols.push(`"${c.name}"`,);

        if (unique.has(c.name,)) {
            const val = row[c.name];
            if (typeof val === 'string' && val !== '') {
                const fresh = await uniqueSuffixed(client, table, c.name, val,);
                params.push(fresh,);
                selectExprs.push(`$${params.length}`,);
                continue;
            }
            if (typeof val === 'boolean') {
                // A boolean singleton flag (partial-unique on `true`, e.g.
                // `pages.is_homepage`) — a copy must not inherit it.
                params.push(false,);
                selectExprs.push(`$${params.length}`,);
                continue;
            }
            // null / non-suffixable unique value → copy as-is (null never
            // collides; other rare cases fall through to the source value).
        }
        selectExprs.push(`"${c.name}"`,);
    }

    const ins = await client.query(
        `INSERT INTO "${table}" (${insertCols.join(', ',)})
         SELECT ${selectExprs.join(', ',)} FROM "${table}" WHERE id = $1
         RETURNING id`,
        params,
    );
    return ins.rows[0].id as string;
}

/**
 * Clone every row of a child table pointing at `oldParentId` so they point at
 * `newParentId`. When the child table self-nests via `parent_block_id`, the
 * cloned subtree is re-linked through an old→new id map in a SECOND pass:
 * every clone is first inserted with a NULL `parent_block_id` (so the self-FK
 * can't be violated by intra-batch insert order — a grandchild is never
 * inserted before its parent), then each child is UPDATEd to its cloned parent.
 * This is correct for arbitrary nesting depth (groups within groups).
 */
async function cloneChildTable(
    client: PoolClient,
    table: string,
    fk: string,
    oldParentId: string,
    newParentId: string,
): Promise<void> {
    const cols = (await tableColumns(client, table,)).filter((c,) => !c.generated,);
    const names = cols.map((c,) => c.name,);
    const hasParent = names.includes('parent_block_id',);

    const src = await client.query(
        `SELECT id, ${hasParent ? 'parent_block_id' : 'NULL::uuid AS parent_block_id'}
         FROM "${table}" WHERE "${fk}" = $1`,
        [oldParentId,],
    );
    if (src.rows.length === 0) return;

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
    logger.debug(`recordCopy: cloned ${src.rows.length} row(s) of ${table} → ${newParentId}`,);
}

/**
 * Deep-copy one record of `typeDef` (base row + registered child tables),
 * returning the new record's id. MUST run inside a transaction (`client`).
 */
export async function copyRecord(client: PoolClient, typeDef: EntityTypeDef, sourceId: string,): Promise<string> {
    const newId = await cloneBaseRow(client, typeDef, sourceId,);
    for (const child of CHILD_TABLES[typeDef.key] ?? []) {
        await cloneChildTable(client, child.table, child.fk, sourceId, newId,);
    }
    return newId;
}
