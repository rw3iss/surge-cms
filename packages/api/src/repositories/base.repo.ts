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
