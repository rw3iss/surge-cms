const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pass UUIDs through; synthetic actors ('system', 'api-key:<name>')
 *  and anything else non-UUID become NULL — safe for UUID FK columns. */
export function uuidOrNull(value: string | null | undefined,): string | null {
    return value && UUID_RE.test(value,) ? value : null;
}
