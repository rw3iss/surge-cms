/** Canonical v4-shaped UUID matcher (the one source of truth — do not re-declare
 *  this literal elsewhere; import it). */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `value` is a UUID string. */
export function isUuid(value: string | null | undefined,): value is string {
    return typeof value === 'string' && UUID_RE.test(value,);
}

/** Pass UUIDs through; synthetic actors ('system', 'api-key:<name>')
 *  and anything else non-UUID become NULL — safe for UUID FK columns. */
export function uuidOrNull(value: string | null | undefined,): string | null {
    return isUuid(value,) ? value : null;
}
