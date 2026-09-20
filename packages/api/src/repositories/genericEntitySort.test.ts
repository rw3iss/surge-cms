/**
 * Entity sorting has three failure modes that all look like "the block is
 * showing the wrong records" rather than like a bug:
 *
 *   - NULLs first on DESC: "newest posts" led with every UNPUBLISHED post
 *   - byte-order text: `Zebra` before `apple` when sorting a title A–Z
 *   - unstable ties: pagination repeats or skips rows between pages
 */
import { describe, expect, it, } from 'vitest';
import { buildEntitySortClause, } from './genericEntity.repo';
import type { EntityTypeDef, } from '@sitesurge/types';

const postType = {
    key: 'post', tableName: 'posts', hasSlug: true, hasStatus: true,
    fields: [
        { key: 'title', type: 'text', },
        { key: 'publishedAt', type: 'datetime', },
        { key: 'rank', type: 'number', },
        { key: 'status', type: 'enum', },
    ],
} as unknown as EntityTypeDef;

describe('buildEntitySortClause', () => {
    it('puts NULLs LAST when sorting newest-first', () => {
        // THE BUG. Postgres defaults to NULLS FIRST for DESC, so "most recent
        // by publishedAt" opened with every post that has no publish date.
        const sql = buildEntitySortClause(postType, { sortBy: 'publishedAt', sortOrder: 'desc', },);
        expect(sql,).toContain('DESC NULLS LAST',);
    },);

    it('puts NULLs LAST ascending too', () => {
        // An empty value must never outrank a real one in EITHER direction.
        const sql = buildEntitySortClause(postType, { sortBy: 'publishedAt', sortOrder: 'asc', },);
        expect(sql,).toContain('ASC NULLS LAST',);
    },);

    it('compares text case-insensitively', () => {
        // Byte order puts every capitalised title before every lowercase one,
        // which is not what "sort by title A–Z" means to anyone.
        const sql = buildEntitySortClause(postType, { sortBy: 'title', sortOrder: 'asc', },);
        expect(sql,).toContain('LOWER(',);
    },);

    it('does NOT lower numbers or dates', () => {
        // Lowering casts to text, and "10" sorts before "9" as a string.
        for (const key of ['publishedAt', 'rank',]) {
            expect(buildEntitySortClause(postType, { sortBy: key, },), key,).not.toContain('LOWER(',);
        }
    },);

    it('treats the standard slug/status columns as text', () => {
        expect(buildEntitySortClause(postType, { sortBy: 'slug', },),).toContain('LOWER(',);
        expect(buildEntitySortClause(postType, { sortBy: 'status', },),).toContain('LOWER(',);
    },);

    it('appends a deterministic tiebreak', () => {
        // Without it, equal values order arbitrarily and page 2 can repeat a
        // row from page 1.
        expect(buildEntitySortClause(postType, { sortBy: 'title', },),).toMatch(/,\s*id (ASC|DESC)/,);
    },);

    it('ignores a field that is not sortable, rather than injecting it', () => {
        // The allowlist is the injection guard: an unknown key must fall back,
        // never reach the SQL.
        const sql = buildEntitySortClause(postType, { sortBy: 'title; DROP TABLE posts--', },);
        expect(sql,).not.toContain('DROP',);
        expect(sql,).toContain('created_at',);
    },);

    it('defaults to newest-created when no sort is given', () => {
        const sql = buildEntitySortClause(postType, {},);
        expect(sql,).toContain('created_at',);
        expect(sql,).toContain('DESC',);
    },);
},);
