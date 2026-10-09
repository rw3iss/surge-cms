/**
 * Generic entity data access — one implementation parameterized by an
 * `EntityTypeDef` (its `tableName` + field schema). Powers list/get/create/
 * update/delete for EVERY entity type (custom + core-adopted), reusing the
 * `base.repo` helpers. Field keys are snake_case columns (enforced by the
 * schema editor); records expose those keys verbatim plus camel standard
 * columns (id/slug/status/createdAt/updatedAt/createdBy).
 */
import {
    type EntityQuery,
    type EntityRecord,
    type EntityTypeDef,
    isColumnField,
} from '@sitesurge/types';
import { query, } from '../db';
import { assertSafeIdentifier, columnFor, snakeCase, } from '../entities/columnMap';

/** Column-backed fields (excludes `blocks`). */
function columnFields(typeDef: EntityTypeDef,) {
    return typeDef.fields.filter((f,) => isColumnField(f.type,));
}

/** Map a DB row → EntityRecord (standard cols camel; field cols verbatim). */
function mapEntityRow(typeDef: EntityTypeDef, row: Record<string, unknown>,): EntityRecord {
    const rec: EntityRecord = { id: row.id as string, };
    if (typeDef.hasSlug) rec.slug = row.slug as string;
    if (typeDef.hasStatus) rec.status = row.status as string;
    rec.createdAt = row.created_at as string;
    rec.updatedAt = row.updated_at as string;
    if ('created_by' in row) rec.createdBy = row.created_by as string;
    // Field keys are API-facing (may be camelCase); the DB column is snake_case.
    for (const f of columnFields(typeDef,)) rec[f.key] = row[columnFor(f,)];
    return rec;
}

/** Allowlist of sortable columns: standard + column-backed fields. */
function sortAllowlist(typeDef: EntityTypeDef,): Record<string, string> {
    const allow: Record<string, string> = {
        createdAt: 'created_at', updatedAt: 'updated_at', id: 'id',
    };
    if (typeDef.hasSlug) allow.slug = 'slug';
    if (typeDef.hasStatus) allow.status = 'status';
    for (const f of columnFields(typeDef,)) allow[f.key] = `"${columnFor(f,)}"`;
    return allow;
}

/**
 * `ORDER BY` for a generic entity, normalised so ANY field type sorts sensibly.
 *
 * `buildSortClause` (the shared helper) emits a bare `ORDER BY col DIR`, which
 * is wrong for entity data in three ways an operator would notice:
 *
 *  1. **NULLs.** Postgres puts NULLs FIRST for DESC. "Newest posts by
 *     publishedAt, newest first" therefore led with every UNPUBLISHED post —
 *     the rows with no date at all. An empty value must never outrank a real
 *     one, so NULLS LAST is forced in BOTH directions.
 *  2. **Case.** Text sorts by byte value under most collations, so `Zebra`
 *     comes before `apple`. Sorting a title A–Z has to be case-insensitive to
 *     mean what the operator expects.
 *  3. **Ties.** Equal values in an unstable order make pagination repeat or
 *     skip rows between pages. `id` is appended as a deterministic tiebreak.
 *
 * Numbers and dates are compared on the column directly — they are already
 * ordered types, and lowering them would sort them as strings ("10" < "9").
 */
const TEXTUAL_FIELD_TYPES = new Set(['text', 'longtext', 'richtext', 'slug', 'email', 'url', 'enum',],);

export function buildEntitySortClause(typeDef: EntityTypeDef, q: EntityQuery,): string {
    const allow = sortAllowlist(typeDef,);
    const column = (q.sortBy && allow[q.sortBy]) || allow.createdAt || 'created_at';
    const direction = q.sortOrder === 'asc' ? 'ASC' : 'DESC';

    const field = typeDef.fields.find((f,) => f.key === q.sortBy);
    // Standard columns (slug/status) are textual too; id/timestamps are not.
    const textual = field
        ? TEXTUAL_FIELD_TYPES.has(field.type,)
        : (q.sortBy === 'slug' || q.sortBy === 'status');

    const expr = textual ? `LOWER(${column}::text)` : column;
    return `ORDER BY ${expr} ${direction} NULLS LAST, id ${direction}`;
}

/** Build a parameterized WHERE from filter/search/status. */
function buildWhere(typeDef: EntityTypeDef, q: EntityQuery, params: unknown[], extra: Array<(params: unknown[],) => string> = [],): string {
    const clauses: string[] = [];
    // Virtual-filter conditions (pre-resolved, parameterized) — entities/virtualFilters.ts.
    for (const cond of extra) clauses.push(`(${cond(params,)})`,);
    const fieldKeys = new Set(columnFields(typeDef,).map((f,) => f.key,));

    if (typeDef.hasStatus && q.status) {
        params.push(q.status,);
        clauses.push(`"status" = $${params.length}`,);
    }

    // Standard columns that can be filtered directly (present on every table;
    // slug/status only when the type declares them).
    const standardCols = new Set<string>(['id', 'createdAt', 'updatedAt',],);
    if (typeDef.hasSlug) standardCols.add('slug',);
    if (typeDef.hasStatus) standardCols.add('status',);

    for (const [key, raw,] of Object.entries(q.filter ?? {},)) {
        if (!fieldKeys.has(key,) && !standardCols.has(key,)) continue; // ignore unknown fields
        const col = `"${assertSafeIdentifier(snakeCase(key,),)}"`;
        if (raw !== null && typeof raw === 'object' && 'op' in raw) {
            const { op, value, } = raw as { op: string; value: unknown; };
            const OPS: Record<string, string> = {
                eq: '=', ne: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'ILIKE',
            };
            if (op === 'in' && Array.isArray(value,)) {
                params.push(value,);
                clauses.push(`${col} = ANY($${params.length})`,);
            } else if ((op === 'eq' || op === 'ne') && typeof value === 'string') {
                // String equality is case-insensitive (`firstName = beth` matches
                // "Beth"). LOWER on both sides + a text cast so it works on any
                // column type; avoids ILIKE's wildcard interpretation of % / _.
                params.push(value,);
                clauses.push(`LOWER(${col}::text) ${op === 'eq' ? '=' : '<>'} LOWER($${params.length})`,);
            } else if (OPS[op]) {
                params.push(op === 'like' ? `%${value}%` : value,);
                clauses.push(`${col} ${OPS[op]} $${params.length}`,);
            }
        } else if (typeof raw === 'string') {
            // Bare-value equality (filter dropdowns) — also case-insensitive.
            params.push(raw,);
            clauses.push(`LOWER(${col}::text) = LOWER($${params.length})`,);
        } else {
            params.push(raw,);
            clauses.push(`${col} = $${params.length}`,);
        }
    }

    if (q.search) {
        if (typeDef.searchable) {
            params.push(q.search,);
            clauses.push(`"search_vector" @@ plainto_tsquery('english', $${params.length})`,);
        } else {
            const textCols = columnFields(typeDef,)
                .filter((f,) => f.searchable && ['text', 'longtext', 'richtext', 'markdown', 'slug',].includes(f.type,))
                .map((f,) => `"${columnFor(f,)}"`);
            if (textCols.length > 0) {
                params.push(`%${q.search}%`,);
                clauses.push(`(${textCols.map((c,) => `${c} ILIKE $${params.length}`).join(' OR ',)})`,);
            }
        }
    }

    return clauses.length ? `WHERE ${clauses.join(' AND ',)}` : '';
}

export interface GenericListOptions {
    /** Pre-resolved, parameterized conditions from virtual filters (entities/virtualFilters.ts). */
    extraWhere?: Array<(params: unknown[],) => string>;
    /**
     * Raw `ORDER BY …` used when the caller asked for NO explicit sort.
     *
     * For a type whose own admin screen has a meaningful order — products are
     * hand-sorted by `position` — "newest first" is the wrong answer, and it is
     * the order a carousel or entity block gets by default. Server-authored SQL,
     * never user input, so it bypasses the sort allowlist deliberately: an
     * allowlist entry is a single column and cannot express `position ASC NULLS
     * LAST, updated_at DESC`.
     */
    defaultOrderBy?: string;
}

export async function list(
    typeDef: EntityTypeDef,
    q: EntityQuery = {},
    opts: GenericListOptions = {},
): Promise<{ items: EntityRecord[]; total: number; }> {
    const table = `"${assertSafeIdentifier(typeDef.tableName, 'table name',)}"`;
    const params: unknown[] = [];
    const where = buildWhere(typeDef, q, params, opts.extraWhere,);
    // An explicit sort always wins — the default only fills the gap. A bare
    // `sortOrder` counts as explicit: it means "the default FIELD, in this
    // direction" (oldest-first), which a caller can now ask for from the
    // picker's direction toggle without choosing a field. Testing `sortBy`
    // alone would silently ignore that and keep the default order.
    const order = (!q.sortBy && !q.sortOrder && opts.defaultOrderBy)
        ? opts.defaultOrderBy
        : buildEntitySortClause(typeDef, q,);
    const page = Math.max(1, q.page ?? 1,);
    const limit = Math.min(200, Math.max(1, q.limit ?? 20,),);
    const offset = (page - 1) * limit;

    const countRes = await query<{ count: string; }>(`SELECT COUNT(*)::int AS count FROM ${table} ${where}`, params,);
    const total = Number(countRes.rows[0]?.count ?? 0,);
    const rowsRes = await query<Record<string, unknown>>(
        `SELECT * FROM ${table} ${where} ${order} LIMIT ${limit} OFFSET ${offset}`,
        params,
    );
    return { items: rowsRes.rows.map((r,) => mapEntityRow(typeDef, r,),), total, };
}

/** Distinct non-null values of one column-backed field, for a filter dropdown.
 *  Capped so a high-cardinality column can't produce an unbounded list. */
export async function distinctValues(
    typeDef: EntityTypeDef,
    field: { key: string; },
    limit = 500,
): Promise<string[]> {
    const table = `"${assertSafeIdentifier(typeDef.tableName, 'table name',)}"`;
    const col = `"${columnFor(field,)}"`;
    const r = await query<{ v: unknown; }>(
        `SELECT DISTINCT ${col} AS v FROM ${table} WHERE ${col} IS NOT NULL ORDER BY 1 LIMIT ${Math.max(1, Math.min(2000, limit,),)}`,
    );
    return r.rows.map((row,) => String(row.v,));
}

export async function getById(typeDef: EntityTypeDef, id: string,): Promise<EntityRecord | null> {
    const table = `"${assertSafeIdentifier(typeDef.tableName, 'table name',)}"`;
    const r = await query<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id = $1`, [id,],);
    return r.rows[0] ? mapEntityRow(typeDef, r.rows[0],) : null;
}

export async function getBySlug(typeDef: EntityTypeDef, slug: string,): Promise<EntityRecord | null> {
    if (!typeDef.hasSlug) return null;
    const table = `"${assertSafeIdentifier(typeDef.tableName, 'table name',)}"`;
    const r = await query<Record<string, unknown>>(`SELECT * FROM ${table} WHERE slug = $1`, [slug,],);
    return r.rows[0] ? mapEntityRow(typeDef, r.rows[0],) : null;
}

/** INSERT from a validated data bag (field columns) + standard columns. */
export async function create(
    typeDef: EntityTypeDef,
    data: Record<string, unknown>,
    ctx: { userId?: string; slug?: string; status?: string; },
): Promise<EntityRecord> {
    const table = `"${assertSafeIdentifier(typeDef.tableName, 'table name',)}"`;
    const cols: string[] = [];
    const vals: unknown[] = [];
    const placeholders: string[] = [];
    const push = (col: string, val: unknown,) => {
        cols.push(`"${assertSafeIdentifier(col,)}"`,);
        vals.push(val,);
        placeholders.push(`$${vals.length}`,);
    };
    if (typeDef.hasSlug && ctx.slug) push('slug', ctx.slug,);
    if (typeDef.hasStatus) push('status', ctx.status ?? 'draft',);
    if (ctx.userId) push('created_by', ctx.userId,);
    for (const f of columnFields(typeDef,)) {
        if (Object.prototype.hasOwnProperty.call(data, f.key,)) push(columnFor(f,), data[f.key],);
    }
    const r = await query<Record<string, unknown>>(
        `INSERT INTO ${table} (${cols.join(', ',)}) VALUES (${placeholders.join(', ',)}) RETURNING *`,
        vals,
    );
    return mapEntityRow(typeDef, r.rows[0],);
}

export async function update(
    typeDef: EntityTypeDef,
    id: string,
    data: Record<string, unknown>,
    ctx: { slug?: string; status?: string; },
): Promise<EntityRecord | null> {
    const table = `"${assertSafeIdentifier(typeDef.tableName, 'table name',)}"`;
    const sets: string[] = [];
    const vals: unknown[] = [];
    const set = (col: string, val: unknown,) => {
        vals.push(val,);
        sets.push(`"${assertSafeIdentifier(col,)}" = $${vals.length}`,);
    };
    if (typeDef.hasSlug && ctx.slug !== undefined) set('slug', ctx.slug,);
    if (typeDef.hasStatus && ctx.status !== undefined) set('status', ctx.status,);
    for (const f of columnFields(typeDef,)) {
        if (Object.prototype.hasOwnProperty.call(data, f.key,)) set(columnFor(f,), data[f.key],);
    }
    if (sets.length === 0) return getById(typeDef, id,);
    vals.push(id,);
    const r = await query<Record<string, unknown>>(
        `UPDATE ${table} SET ${sets.join(', ',)}, updated_at = NOW() WHERE id = $${vals.length} RETURNING *`,
        vals,
    );
    return r.rows[0] ? mapEntityRow(typeDef, r.rows[0],) : null;
}

export async function remove(typeDef: EntityTypeDef, id: string,): Promise<boolean> {
    const table = `"${assertSafeIdentifier(typeDef.tableName, 'table name',)}"`;
    const r = await query<{ id: string; }>(`DELETE FROM ${table} WHERE id = $1 RETURNING id`, [id,],);
    return r.rows.length > 0;
}
