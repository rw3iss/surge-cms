/**
 * Base repository with shared pagination and query building logic.
 */
import { query, } from '../db';
import { NotFoundError, } from '../middleware/error';
import { buildUpdateSet, mapRow, mapRows, } from '../utils/mapRow';

export interface PaginationOptions {
    page: number;
    limit: number;
}

export interface PaginatedResult<T,> {
    data: T[];
    total: number;
}

/**
 * Build a safe `ORDER BY` clause. `sortBy` is looked up in
 * `allowedColumns` (a fixed allowlist mapping user-facing keys → trusted
 * column expressions) so untrusted input can never reach the SQL; an
 * unknown / missing key falls back to `defaultColumn` (or the first
 * allowlist entry). Direction is `ASC` only for an explicit `'asc'`,
 * otherwise `DESC`.
 */
export function buildSortClause(
    sortBy: string | undefined,
    sortOrder: string | undefined,
    allowedColumns: Record<string, string>,
    defaultColumn?: string,
): string {
    const fallback = (defaultColumn && allowedColumns[defaultColumn])
        || Object.values(allowedColumns,)[0]
        || 'created_at';
    const column = (sortBy && allowedColumns[sortBy]) || fallback;
    const direction = sortOrder === 'asc' ? 'ASC' : 'DESC';
    return `ORDER BY ${column} ${direction}`;
}

/**
 * Append `LIMIT`/`OFFSET` placeholders to an existing param array and return
 * the SQL fragment referencing them. For bespoke paginated queries that can't
 * use `paginatedQuery` (custom per-row shaping, computed `ORDER BY`, etc.).
 * Mutates `params` (pushes `limit` then `offset`). Call it AFTER all `WHERE`
 * params are pushed so the placeholder numbers line up.
 */
export function buildLimitOffset(params: unknown[], limit: number, offset: number,): string {
    params.push(limit, offset,);
    return `LIMIT $${params.length - 1} OFFSET $${params.length}`;
}

/**
 * Executes a paginated query with count.
 */
export async function paginatedQuery<T,>(
    baseQuery: string,
    countQuery: string,
    params: unknown[],
    pagination: PaginationOptions,
): Promise<PaginatedResult<T>> {
    const offset = (pagination.page - 1) * pagination.limit;

    const countResult = await query(countQuery, params,);
    const total = parseInt(countResult.rows[0].count, 10,);

    const fullParams = [...params, pagination.limit, offset,];
    const paramLen = fullParams.length;
    const result = await query(
        `${baseQuery} LIMIT $${paramLen - 1} OFFSET $${paramLen}`,
        fullParams,
    );

    return {
        data: mapRows<T>(result.rows,),
        total,
    };
}

/**
 * Finds a single record by ID. Throws NotFoundError if not found.
 */
export async function findByIdOrThrow<T,>(
    table: string,
    id: string,
    entityName: string,
): Promise<T> {
    const result = await query(`SELECT * FROM ${table} WHERE id = $1`, [id,],);
    if (result.rows.length === 0) {
        throw new NotFoundError(entityName,);
    }
    return mapRow<T>(result.rows[0],);
}

/**
 * Updates a record by ID with the given camelCase data object.
 * Returns the updated record. Throws NotFoundError if not found.
 */
export async function updateById<T,>(
    table: string,
    id: string,
    data: Record<string, unknown>,
    entityName: string,
): Promise<T> {
    const { setClause, values, nextIndex, } = buildUpdateSet(data,);
    if (!setClause) {
        return findByIdOrThrow<T>(table, id, entityName,);
    }

    values.push(id,);
    const result = await query(
        `UPDATE ${table} SET ${setClause}, updated_at = NOW() WHERE id = $${nextIndex} RETURNING *`,
        values,
    );

    if (result.rows.length === 0) {
        throw new NotFoundError(entityName,);
    }

    return mapRow<T>(result.rows[0],);
}

/**
 * Deletes a record by ID. Throws NotFoundError if not found.
 */
export async function deleteById(
    table: string,
    id: string,
    entityName: string,
): Promise<void> {
    const result = await query(
        `DELETE FROM ${table} WHERE id = $1 RETURNING id`,
        [id,],
    );
    if (result.rows.length === 0) {
        throw new NotFoundError(entityName,);
    }
}
