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
 * Columns that must NEVER reach an API response, stripped for every table.
 *
 * `mapRow` is the single funnel every DB row passes through on its way to a
 * client, which makes it the one place a deny-list can't be forgotten. This
 * exists because `SELECT *` (via `findByIdOrThrow`/`updateById`) and the login
 * query both mapped the whole `users` row, so `passwordHash` — and the
 * single-use `verificationToken`, which would let a caller verify someone
 * else's email — were being serialised into auth responses.
 *
 * Server code that legitimately needs these reads the RAW row before mapping
 * (e.g. `bcrypt.compare(password, dbUser.password_hash)` in services/auth),
 * so stripping them here costs nothing.
 *
 * Guarded by `utils/mapRow.test.ts` — add a column here, never a new exception.
 */
export const SENSITIVE_COLUMNS: ReadonlySet<string> = new Set([
    'password_hash',
    'verification_token',
    'stripe_customer_id',
],);

/**
 * Maps a database row with snake_case keys to a camelCase typed object.
 * Handles Date conversions for fields ending in _at, and drops any
 * `SENSITIVE_COLUMNS` outright.
 */
export function mapRow<T,>(row: Record<string, unknown>,): T {
    if (!row) return row as T;

    const mapped: Record<string, unknown> = {};

    for (const [key, value,] of Object.entries(row,)) {
        if (SENSITIVE_COLUMNS.has(key,)) continue;
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
