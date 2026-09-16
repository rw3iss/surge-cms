/**
 * Copy overrides: the caller names the duplicate, the database still decides
 * whether that name is free.
 *
 * The interesting case is the overlap between those two. Asking for
 * "home-copy" must GET "home-copy" when it is available — an override that
 * always came back as "home-copy-1" would make the feature pointless — while a
 * second clone of the same page must not fail on the unique constraint. So the
 * override is a REQUEST, not an assertion, and these pin both halves.
 */
import { describe, expect, it, vi, } from 'vitest';

vi.mock('../db', () => ({ query: vi.fn(), transaction: vi.fn(), }),);

const { copyRecord, } = await import('./recordCopy');

/** Minimal type def: one table, `slug` unique, `title` not. */
const typeDef = {
    key: 'page',
    label: 'Page',
    tableName: 'pages',
    fields: [
        { key: 'title', type: 'text', },
        { key: 'slug', type: 'text', unique: true, },
    ],
} as never;

/**
 * A fake client that answers the three shapes copyRecord issues: column
 * introspection, unique-index introspection, the free/taken probe, and the
 * INSERT (whose parameters are what we actually assert on).
 */
function fakeClient(takenSlugs: string[],) {
    const insertParams: unknown[][] = [];
    const insertSql: string[] = [];
    return {
        insertParams, insertSql,
        query: vi.fn(async (sql: string, params?: unknown[],) => {
            if (sql.includes('information_schema.columns',)) {
                // Real column shape: tableColumns() reads column_name /
                // is_generated, not name / generated.
                return { rows: [
                    { column_name: 'id', is_generated: 'NEVER', },
                    { column_name: 'title', is_generated: 'NEVER', },
                    { column_name: 'slug', is_generated: 'NEVER', },
                    { column_name: 'created_at', is_generated: 'NEVER', },
                    { column_name: 'updated_at', is_generated: 'NEVER', },
                ], };
            }
            if (sql.includes('pg_index',) || sql.includes('indisunique',)) {
                return { rows: [{ col: 'slug', },], };
            }
            // Free/taken probe.
            if (sql.startsWith('SELECT 1 FROM',)) {
                const wanted = String((params ?? [])[0],);
                return { rows: takenSlugs.includes(wanted,) ? [{ '?column?': 1, },] : [], };
            }
            if (sql.includes('SELECT * FROM',)) {
                return { rows: [{ id: 'src', title: 'Home', slug: 'home', },], };
            }
            if (sql.trim().startsWith('INSERT',)) {
                insertSql.push(sql,);
                insertParams.push(params ?? [],);
                return { rows: [{ id: 'new-id', },], };
            }
            return { rows: [], };
        },),
    };
}

describe('copyRecord overrides', () => {
    it('uses the requested slug verbatim when it is free', async () => {
        const c = fakeClient([],);
        const id = await copyRecord(c as never, typeDef, 'src', { title: 'Home (Copy)', slug: 'home-copy', },);
        expect(id,).toBe('new-id',);
        const params = c.insertParams[0]!;
        expect(params,).toContain('Home (Copy)',);
        expect(params,).toContain('home-copy',);
        // NOT suffixed — the whole point of asking.
        expect(params.some(p => String(p,).startsWith('home-copy-',)),).toBe(false,);
    },);

    it('suffixes a requested slug that is already taken', async () => {
        const c = fakeClient(['home-copy',],);
        await copyRecord(c as never, typeDef, 'src', { title: 'Home (Copy)', slug: 'home-copy', },);
        const params = c.insertParams[0]!;
        expect(params,).toContain('home-copy-1',);
        expect(params,).not.toContain('home-copy',);
    },);

    it('walks past several taken suffixes', async () => {
        const c = fakeClient(['home-copy', 'home-copy-1', 'home-copy-2',],);
        await copyRecord(c as never, typeDef, 'src', { slug: 'home-copy', },);
        expect(c.insertParams[0]!,).toContain('home-copy-3',);
    },);

    it('without overrides, still starts at -1 (the source value IS taken)', async () => {
        const c = fakeClient(['home',],);
        await copyRecord(c as never, typeDef, 'src',);
        const params = c.insertParams[0]!;
        // The source row's own slug must never be reused verbatim.
        expect(params,).not.toContain('home',);
        expect(params,).toContain('home-1',);
    },);

    it('overrides a non-unique column without any probing', async () => {
        const c = fakeClient([],);
        await copyRecord(c as never, typeDef, 'src', { title: 'Renamed', },);
        expect(c.insertParams[0]!,).toContain('Renamed',);
    },);
},);
