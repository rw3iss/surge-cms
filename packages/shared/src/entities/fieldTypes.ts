/**
 * Field-type vocabulary for the generic entity system + the canonical
 * field-type → SQL-column mapping used by the runtime table generator.
 *
 * Lives in `@sitesurge/types` so the backend (table generator, validation),
 * the admin schema editor, the SDK, and the MCP server all agree on ONE set
 * of field types and their column definitions.
 */

/** The set of field types an entity property can declare. */
export type EntityFieldType =
    | 'text' // VARCHAR(255)
    | 'longtext' // TEXT
    | 'richtext' // TEXT (rendered through {{ }} + sanitizer)
    | 'markdown' // TEXT
    | 'number' // NUMERIC
    | 'integer' // INTEGER
    | 'boolean' // BOOLEAN
    | 'date' // DATE
    | 'datetime' // TIMESTAMPTZ
    | 'enum' // VARCHAR + CHECK (options.values)
    | 'json' // JSONB
    | 'media' // UUID (media id)
    | 'relation' // UUID (target entity id); options.relationType = target key
    | 'slug' // VARCHAR(255)
    | 'blocks'; // NO column — body stored in the shared block store (Phase 8)

/** Field types that map to a real SQL column (everything except `blocks`). */
export type ColumnFieldType = Exclude<EntityFieldType, 'blocks'>;

/**
 * Canonical column DDL fragment per column-backed field type. The table
 * generator appends NOT NULL / UNIQUE / DEFAULT / CHECK from the field's
 * flags + options — this map only fixes the base column TYPE.
 */
export const FIELD_COLUMN_SQL: Record<ColumnFieldType, string> = {
    text: 'VARCHAR(255)',
    longtext: 'TEXT',
    richtext: 'TEXT',
    markdown: 'TEXT',
    number: 'NUMERIC',
    integer: 'INTEGER',
    boolean: 'BOOLEAN',
    date: 'DATE',
    datetime: 'TIMESTAMPTZ',
    enum: 'VARCHAR(255)',
    json: 'JSONB',
    media: 'UUID',
    relation: 'UUID',
    slug: 'VARCHAR(255)',
};

/** True when a field type is backed by a real column (not `blocks`). */
export function isColumnField(type: EntityFieldType,): type is ColumnFieldType {
    return type !== 'blocks';
}
