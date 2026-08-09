import { describe, expect, it, } from 'vitest';
import type { EntityFieldDef, EntityTypeDef, } from '@sitesurge/types';
import {
    applyLedgered,
    buildAddColumnDdl,
    buildCreateTableDdl,
    buildDropColumnDdl,
    buildIndexDdls,
    buildTriggerDdls,
    type DdlClient,
    ensureTable,
} from './tableGenerator';

function fld(p: Partial<EntityFieldDef> & { key: string; type: EntityFieldDef['type']; },): EntityFieldDef {
    return {
        id: 'f', label: p.key, core: false, required: false, unique: false,
        indexed: false, searchable: false, position: 0, ...p,
    } as EntityFieldDef;
}

function type(p: Partial<EntityTypeDef> & { key: string; tableName: string; },): EntityTypeDef {
    return {
        id: 't', label: p.key, labelPlural: p.key, singularVar: p.key, pluralVar: p.key,
        origin: 'custom', internal: false, hasSlug: true, hasStatus: false, searchable: false,
        revisioned: false, routing: {} as never, caching: {} as never, fields: [],
        createdAt: '', updatedAt: '', ...p,
    } as EntityTypeDef;
}

/** Fake client that models the entity_migrations ledger by hash. */
function fakeClient() {
    const applied = new Set<string>(); // statement hashes
    const ran: string[] = []; // non-ledger DDL executed
    const client: DdlClient = {
        async query(sql: string, params?: unknown[],) {
            if (sql.startsWith('SELECT 1 FROM entity_migrations',)) {
                const hash = params?.[1] as string;
                return { rows: applied.has(hash,) ? [1,] : [], };
            }
            if (sql.startsWith('INSERT INTO entity_migrations',)) {
                applied.add(params?.[1] as string,);
                return { rows: [], };
            }
            if (sql.includes('pg_advisory_xact_lock',)) return { rows: [], };
            ran.push(sql,);
            return { rows: [], };
        },
    };
    return { client, ran, };
}

describe('DDL builders', () => {
    it('builds a CREATE TABLE with standard + field columns', () => {
        const ddl = buildCreateTableDdl(type({
            key: 'recipe', tableName: 'ce_recipe', hasStatus: true,
            fields: [fld({ key: 'title', type: 'text', required: true, }), fld({ key: 'servings', type: 'integer', }),],
        }),);
        expect(ddl,).toContain('CREATE TABLE IF NOT EXISTS "ce_recipe"',);
        expect(ddl,).toContain('"id" UUID PRIMARY KEY',);
        expect(ddl,).toContain('"slug" VARCHAR(255)',);
        expect(ddl,).toContain('"status" VARCHAR(32)',);
        expect(ddl,).toContain('"title" VARCHAR(255) NOT NULL',);
        expect(ddl,).toContain('"servings" INTEGER',);
    });

    it('builds add/drop column DDL', () => {
        expect(buildAddColumnDdl('ce_recipe', fld({ key: 'notes', type: 'longtext', },)))
            .toBe('ALTER TABLE "ce_recipe" ADD COLUMN IF NOT EXISTS "notes" TEXT',);
        expect(buildDropColumnDdl('ce_recipe', 'notes',))
            .toBe('ALTER TABLE "ce_recipe" DROP COLUMN IF EXISTS "notes"',);
    });

    it('builds slug/status/field/search indexes', () => {
        const idx = buildIndexDdls(type({
            key: 'recipe', tableName: 'ce_recipe', hasStatus: true, searchable: true,
            fields: [fld({ key: 'author', type: 'text', indexed: true, }),],
        }),);
        expect(idx.some((s,) => s.includes('"ce_recipe_slug_uniq"'),)).toBe(true,);
        expect(idx.some((s,) => s.includes('"ce_recipe_status_idx"'),)).toBe(true,);
        expect(idx.some((s,) => s.includes('"ce_recipe_author_idx"'),)).toBe(true,);
        expect(idx.some((s,) => s.includes('USING GIN'),)).toBe(true,);
    });

    it('builds updated_at trigger always; search trigger only when searchable', () => {
        const noSearch = buildTriggerDdls(type({ key: 'r', tableName: 'ce_r', },));
        expect(noSearch.some((s,) => s.includes('trg_ce_r_updated_at'),)).toBe(true,);
        expect(noSearch.some((s,) => s.includes('search_vector'),)).toBe(false,);
        const withSearch = buildTriggerDdls(type({
            key: 'r', tableName: 'ce_r', searchable: true,
            fields: [fld({ key: 'title', type: 'text', searchable: true, }),],
        }),);
        expect(withSearch.some((s,) => s.includes('to_tsvector'),)).toBe(true,);
        expect(withSearch.join('',)).toContain('coalesce(NEW."title", \'\')',);
    });
});

describe('applyLedgered / ensureTable idempotency', () => {
    it('runs a statement once and skips it on re-apply', async () => {
        const { client, ran, } = fakeClient();
        expect(await applyLedgered(client, 'recipe', 'CREATE TABLE x',)).toBe(true,);
        expect(await applyLedgered(client, 'recipe', 'CREATE TABLE x',)).toBe(false,);
        expect(ran.filter((s,) => s === 'CREATE TABLE x',),).toHaveLength(1,);
    });

    it('ensureTable applies create+index+trigger once; re-run is a no-op', async () => {
        const { client, ran, } = fakeClient();
        const def = type({
            key: 'recipe', tableName: 'ce_recipe',
            fields: [fld({ key: 'title', type: 'text', }),],
        });
        const first = await ensureTable(def, client,);
        expect(first.length,).toBeGreaterThan(0,);
        const before = ran.length;
        const second = await ensureTable(def, client,);
        expect(second,).toHaveLength(0,); // nothing new ran
        expect(ran.length,).toBe(before,);
    });
});
