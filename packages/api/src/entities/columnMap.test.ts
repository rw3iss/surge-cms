import { describe, expect, it, } from 'vitest';
import type { EntityFieldDef, } from '@sitesurge/types';
import {
    assertSafeIdentifier,
    mapFieldColumnDdl,
    standardColumnsDdl,
    validateRecord,
} from './columnMap';

function field(partial: Partial<EntityFieldDef> & { key: string; type: EntityFieldDef['type']; },): EntityFieldDef {
    return {
        id: 'f', label: partial.key, core: false, required: false, unique: false,
        indexed: false, searchable: false, position: 0, ...partial,
    } as EntityFieldDef;
}

describe('mapFieldColumnDdl', () => {
    it('maps base types to columns', () => {
        expect(mapFieldColumnDdl(field({ key: 'title', type: 'text', },))).toBe('"title" VARCHAR(255)',);
        expect(mapFieldColumnDdl(field({ key: 'body', type: 'longtext', },))).toBe('"body" TEXT',);
        expect(mapFieldColumnDdl(field({ key: 'qty', type: 'integer', },))).toBe('"qty" INTEGER',);
        expect(mapFieldColumnDdl(field({ key: 'live', type: 'boolean', },))).toBe('"live" BOOLEAN',);
        expect(mapFieldColumnDdl(field({ key: 'data', type: 'json', },))).toBe('"data" JSONB',);
        expect(mapFieldColumnDdl(field({ key: 'author', type: 'relation', },))).toBe('"author" UUID',);
    });

    it('returns null for a blocks field (no column)', () => {
        expect(mapFieldColumnDdl(field({ key: 'body', type: 'blocks', },))).toBeNull();
    });

    it('appends NOT NULL / UNIQUE / DEFAULT', () => {
        expect(mapFieldColumnDdl(field({ key: 'slug', type: 'slug', required: true, unique: true, },)))
            .toBe('"slug" VARCHAR(255) NOT NULL UNIQUE',);
        expect(mapFieldColumnDdl(field({ key: 'live', type: 'boolean', defaultValue: true, },)))
            .toBe('"live" BOOLEAN DEFAULT true',);
        expect(mapFieldColumnDdl(field({ key: 'qty', type: 'integer', defaultValue: 5, },)))
            .toBe('"qty" INTEGER DEFAULT 5',);
    });

    it('emits a CHECK for enum fields', () => {
        expect(mapFieldColumnDdl(field({ key: 'size', type: 'enum', options: { values: ['S', 'M', "L'x",], }, },)))
            .toBe(`"size" VARCHAR(255) CHECK ("size" IN ('S', 'M', 'L''x'))`,);
    });

    it('rejects unsafe identifiers (injection guard)', () => {
        expect(() => assertSafeIdentifier('a; DROP TABLE x',)).toThrow();
        expect(() => assertSafeIdentifier('1bad',)).toThrow();
        expect(() => mapFieldColumnDdl(field({ key: 'ok_key', type: 'text', },))).not.toThrow();
    });
});

describe('standardColumnsDdl', () => {
    it('includes slug/status/search_vector only when enabled', () => {
        const min = standardColumnsDdl({ hasSlug: false, hasStatus: false, searchable: false, },);
        expect(min.join(' ',)).not.toContain('slug',);
        expect(min.join(' ',)).not.toContain('search_vector',);
        const full = standardColumnsDdl({ hasSlug: true, hasStatus: true, searchable: true, },).join(' ',);
        expect(full,).toContain('"slug"',);
        expect(full,).toContain('"status"',);
        expect(full,).toContain('"search_vector" tsvector',);
        expect(full,).toContain('"id" UUID PRIMARY KEY',);
    });
});

describe('validateRecord', () => {
    const fields = [
        field({ key: 'title', type: 'text', required: true, },),
        field({ key: 'size', type: 'enum', options: { values: ['S', 'M',], }, },),
        field({ key: 'qty', type: 'integer', options: { min: 0, max: 10, }, },),
        field({ key: 'live', type: 'boolean', },),
    ];

    it('throws when a required field is missing', () => {
        expect(() => validateRecord(fields, { size: 'S', },)).toThrow(/required/,);
    });
    it('skips required checks in partial mode', () => {
        expect(() => validateRecord(fields, { size: 'S', }, { partial: true, },)).not.toThrow();
    });
    it('rejects an out-of-set enum value', () => {
        expect(() => validateRecord(fields, { title: 'x', size: 'XL', },)).toThrow(/one of/,);
    });
    it('enforces number min/max and coerces booleans', () => {
        expect(() => validateRecord(fields, { title: 'x', qty: 99, },)).toThrow(/≤ 10/,);
        const out = validateRecord(fields, { title: 'x', qty: '3', live: 'true', },);
        expect(out.qty,).toBe(3,);
        expect(out.live,).toBe(true,);
    });
});
