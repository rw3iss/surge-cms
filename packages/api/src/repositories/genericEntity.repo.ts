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
import { buildSortClause, } from './base.repo';
import { assertSafeIdentifier, } from '../entities/columnMap';

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
    for (const f of columnFields(typeDef,)) rec[f.key] = row[f.key];
    return rec;
}

/** Allowlist of sortable columns: standard + column-backed fields. */
function sortAllowlist(typeDef: EntityTypeDef,): Record<string, string> {
    const allow: Record<string, string> = {
        createdAt: 'created_at', updatedAt: 'updated_at', id: 'id',
    };
    if (typeDef.hasSlug) allow.slug = 'slug';
    if (typeDef.hasStatus) allow.status = 'status';
    for (const f of columnFields(typeDef,)) allow[f.key] = `"${assertSafeIdentifier(f.key,)}"`;
    return allow;
}

/** Build a parameterized WHERE from filter/search/status. */
function buildWhere(typeDef: EntityTypeDef, q: EntityQuery, params: unknown[],): string {
    const clauses: string[] = [];
    const fieldKeys = new Set(columnFields(typeDef,).map((f,) => f.key,));

    if (typeDef.hasStatus && q.status) {
        params.push(q.status,);
        clauses.push(`"status" = $${params.length}`,);
    }

    for (const [key, raw,] of Object.entries(q.filter ?? {},)) {
        if (!fieldKeys.has(key,) && key !== 'slug') continue; // ignore unknown fields
        const col = `"${assertSafeIdentifier(key,)}"`;
        if (raw !== null && typeof raw === 'object' && 'op' in raw) {
            const { op, value, } = raw as { op: string; value: unknown; };
            const OPS: Record<string, string> = {
                eq: '=', ne: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'ILIKE',
            };
            if (op === 'in' && Array.isArray(value,)) {
                params.push(value,);
                clauses.push(`${col} = ANY($${params.length})`,);
            } else if (OPS[op]) {
                params.push(op === 'like' ? `%${value}%` : value,);
                clauses.push(`${col} ${OPS[op]} $${params.length}`,);
            }
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
                .map((f,) => `"${assertSafeIdentifier(f.key,)}"`);
            if (textCols.length > 0) {
                params.push(`%${q.search}%`,);
                clauses.push(`(${textCols.map((c,) => `${c} ILIKE $${params.length}`).join(' OR ',)})`,);
            }
        }
    }

    return clauses.length ? `WHERE ${clauses.join(' AND ',)}` : '';
}

export async function list(
    typeDef: EntityTypeDef,
    q: EntityQuery = {},
): Promise<{ items: EntityRecord[]; total: number; }> {
    const table = `"${assertSafeIdentifier(typeDef.tableName, 'table name',)}"`;
    const params: unknown[] = [];
    const where = buildWhere(typeDef, q, params,);
    const order = buildSortClause(q.sortBy, q.sortOrder, sortAllowlist(typeDef,), 'createdAt',);
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
        if (Object.prototype.hasOwnProperty.call(data, f.key,)) push(f.key, data[f.key],);
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
        if (Object.prototype.hasOwnProperty.call(data, f.key,)) set(f.key, data[f.key],);
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
