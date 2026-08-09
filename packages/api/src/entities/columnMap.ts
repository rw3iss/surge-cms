/**
 * Pure mapping between an entity type's field schema and its SQL columns, plus
 * record validation. No DB access — every function here is deterministic and
 * unit-tested (`columnMap.test.ts`). The table generator (`tableGenerator.ts`)
 * composes these into DDL; the generic service uses `validateRecord` on writes.
 */
import {
    type EntityFieldDef,
    FIELD_COLUMN_SQL,
    isColumnField,
    type EntityTypeDef,
} from '@sitesurge/types';
import { ValidationError, } from '../middleware/error';

/** Postgres identifier safety: field keys + table names become SQL identifiers,
 *  so they must be a strict `[a-z][a-z0-9_]*`. Admin input flows here, so this
 *  is a hard injection guard, not cosmetics. */
const IDENT_RE = /^[a-z][a-z0-9_]*$/;

export function assertSafeIdentifier(name: string, what = 'identifier',): string {
    if (!IDENT_RE.test(name,)) {
        throw new ValidationError(`Invalid ${what}: "${name}" (must match ${IDENT_RE})`,);
    }
    return name;
}

/** Escape a string literal for inline SQL (enum CHECK values). */
function sqlLiteral(v: string,): string {
    return `'${v.replace(/'/g, "''",)}'`;
}

/**
 * DDL column fragment for one field, or `null` for `blocks` (no column — the
 * body lives in the shared block store). Composes the base type from
 * `FIELD_COLUMN_SQL` and appends NOT NULL / UNIQUE / DEFAULT / CHECK.
 */
export function mapFieldColumnDdl(field: EntityFieldDef,): string | null {
    if (!isColumnField(field.type,)) return null;
    const col = assertSafeIdentifier(field.key, 'field key',);
    const parts = [`"${col}"`, FIELD_COLUMN_SQL[field.type],];

    if (field.type === 'enum' && field.options?.values?.length) {
        const list = field.options.values.map(sqlLiteral,).join(', ',);
        parts.push(`CHECK ("${col}" IN (${list}))`,);
    }
    if (field.required) parts.push('NOT NULL',);
    if (field.unique) parts.push('UNIQUE',);
    if (field.defaultValue !== undefined && field.defaultValue !== null) {
        parts.push(`DEFAULT ${defaultLiteral(field, field.defaultValue,)}`,);
    }
    return parts.join(' ',);
}

/** Literalize a default value for a field's column type. */
function defaultLiteral(field: EntityFieldDef, value: unknown,): string {
    switch (field.type) {
        case 'boolean':
            return value ? 'true' : 'false';
        case 'number':
        case 'integer':
            return String(Number(value,),);
        case 'json':
            return `${sqlLiteral(JSON.stringify(value,),)}::jsonb`;
        default:
            return sqlLiteral(String(value,),);
    }
}

/**
 * The standard, always-present columns for a generated entity table, in order.
 * Slug / status / search_vector are conditional on the type's behaviors.
 */
export function standardColumnsDdl(typeDef: Pick<EntityTypeDef, 'hasSlug' | 'hasStatus' | 'searchable'>,): string[] {
    const cols = ['"id" UUID PRIMARY KEY DEFAULT gen_random_uuid()',];
    if (typeDef.hasSlug) cols.push('"slug" VARCHAR(255)',);
    if (typeDef.hasStatus) cols.push("\"status\" VARCHAR(32) NOT NULL DEFAULT 'draft'",);
    cols.push('"created_by" UUID REFERENCES users(id) ON DELETE SET NULL',);
    cols.push('"created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()',);
    cols.push('"updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()',);
    if (typeDef.searchable) cols.push('"search_vector" tsvector',);
    return cols;
}

/**
 * Validate a record against a field schema. Throws `ValidationError` on the
 * first problem. `partial` skips required checks for fields absent from `data`
 * (PATCH semantics). Returns a normalized/coerced copy.
 */
export function validateRecord(
    fields: EntityFieldDef[],
    data: Record<string, unknown>,
    opts: { partial?: boolean; } = {},
): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const field of fields) {
        if (!isColumnField(field.type,)) continue; // blocks handled separately
        const present = Object.prototype.hasOwnProperty.call(data, field.key,);
        const raw = data[field.key];

        if (!present || raw === undefined || raw === null || raw === '') {
            if (field.required && !opts.partial && field.defaultValue === undefined) {
                throw new ValidationError(`Field "${field.key}" is required`,);
            }
            if (present) out[field.key] = raw === '' ? null : raw;
            continue;
        }

        out[field.key] = coerceAndCheck(field, raw,);
    }
    return out;
}

function coerceAndCheck(field: EntityFieldDef, raw: unknown,): unknown {
    switch (field.type) {
        case 'number':
        case 'integer': {
            const n = Number(raw,);
            if (Number.isNaN(n,)) throw new ValidationError(`Field "${field.key}" must be a number`,);
            const val = field.type === 'integer' ? Math.trunc(n,) : n;
            if (field.options?.min !== undefined && val < field.options.min) {
                throw new ValidationError(`Field "${field.key}" must be ≥ ${field.options.min}`,);
            }
            if (field.options?.max !== undefined && val > field.options.max) {
                throw new ValidationError(`Field "${field.key}" must be ≤ ${field.options.max}`,);
            }
            return val;
        }
        case 'boolean':
            return raw === true || raw === 'true' || raw === 1 || raw === '1';
        case 'enum':
            if (field.options?.values && !field.options.values.includes(String(raw,),)) {
                throw new ValidationError(
                    `Field "${field.key}" must be one of: ${field.options.values.join(', ',)}`,
                );
            }
            return String(raw,);
        case 'text':
        case 'longtext':
        case 'richtext':
        case 'markdown':
        case 'slug': {
            const s = String(raw,);
            if (field.options?.pattern && !new RegExp(field.options.pattern,).test(s,)) {
                throw new ValidationError(`Field "${field.key}" has an invalid format`,);
            }
            return s;
        }
        default:
            return raw; // json / media / relation / date pass through (DB casts)
    }
}
