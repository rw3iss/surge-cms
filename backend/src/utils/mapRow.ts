/**
 * Generic utility for mapping database rows (snake_case) to camelCase objects.
 * Eliminates repetitive toEntity() functions scattered across route files.
 */

/** Convert a snake_case string to camelCase */
function snakeToCamel(str: string,): string {
    return str.replace(/_([a-z])/g, (_, letter,) => letter.toUpperCase(),);
}

/** Convert a camelCase string to snake_case */
export function camelToSnake(str: string,): string {
    return str.replace(/([A-Z])/g, '_$1',).toLowerCase();
}

/**
 * Maps a database row with snake_case keys to a camelCase typed object.
 * Handles Date conversions for fields ending in _at.
 */
export function mapRow<T,>(row: Record<string, unknown>,): T {
    if (!row) return row as T;

    const mapped: Record<string, unknown> = {};

    for (const [key, value,] of Object.entries(row,)) {
        const camelKey = snakeToCamel(key,);

        // Convert timestamp strings to Date objects for _at fields
        if (key.endsWith('_at',) && value !== null && value !== undefined) {
            mapped[camelKey] = new Date(value as string,);
        } else {
            mapped[camelKey] = value;
        }
    }

    return mapped as T;
}

/**
 * Maps an array of database rows to camelCase typed objects.
 */
export function mapRows<T,>(rows: Record<string, unknown>[],): T[] {
    return rows.map(row => mapRow<T>(row,));
}

/**
 * Builds a parameterized UPDATE SET clause from a camelCase data object.
 * Returns the SET clause string and the parameter values array.
 * Skips undefined values. Converts keys to snake_case for the DB.
 */
export function buildUpdateSet(
    data: Record<string, unknown>,
    startIndex = 1,
): { setClause: string; values: unknown[]; nextIndex: number; } {
    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = startIndex;

    for (const [key, value,] of Object.entries(data,)) {
        if (value === undefined) continue;
        const dbKey = camelToSnake(key,);
        values.push(value,);
        updates.push(`${dbKey} = $${idx}`,);
        idx++;
    }

    return {
        setClause: updates.join(', ',),
        values,
        nextIndex: idx,
    };
}

/**
 * Builds a parameterized WHERE clause with dynamic filters.
 */
export function buildWhereClause(
    filters: Record<string, { value: unknown; operator?: string; column?: string; }>,
    startIndex = 1,
): { whereClause: string; values: unknown[]; nextIndex: number; } {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = startIndex;

    for (const [key, filter,] of Object.entries(filters,)) {
        if (filter.value === undefined || filter.value === null) continue;

        const column = filter.column || camelToSnake(key,);
        const operator = filter.operator || '=';

        if (operator === 'ILIKE') {
            values.push(`%${filter.value}%`,);
        } else if (operator === 'ANY') {
            values.push(filter.value,);
        } else {
            values.push(filter.value,);
        }

        if (operator === 'ILIKE') {
            conditions.push(`${column} ILIKE $${idx}`,);
        } else if (operator === 'ANY') {
            conditions.push(`$${idx} = ANY(${column})`,);
        } else if (operator === 'IN') {
            conditions.push(`${column} IN ($${idx})`,);
        } else if (operator === 'IS NULL') {
            conditions.push(`${column} IS NULL`,);
            values.pop(); // no param needed
            idx--;
        } else {
            conditions.push(`${column} ${operator} $${idx}`,);
        }
        idx++;
    }

    const whereClause = conditions.length > 0 ?
        `WHERE ${conditions.join(' AND ',)}` :
        '';

    return { whereClause, values, nextIndex: idx, };
}
