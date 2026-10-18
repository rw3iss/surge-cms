/**
 * Public reads through the generic entity service must apply the same rules as
 * the bespoke public endpoints: no drafts for non-staff callers, and posts go
 * through the subscription gate (audit 2026-10-18 S1 / S3).
 */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const repoList = vi.fn();
const repoGetById = vi.fn();
const repoGetBySlug = vi.fn();
const dbQuery = vi.fn();

vi.mock('../db/client', () => ({ transaction: vi.fn(), }),);
vi.mock('../db', () => ({ query: (...a: unknown[]) => dbQuery(...a,), }),);
vi.mock('./cache', () => ({
    cache: { get: vi.fn(async () => null,), set: vi.fn(), },
    CACHE_KEYS: { entityList: () => 'k', entityRecord: () => 'k', },
}),);
vi.mock('./mediaRefs', () => ({ attachFeaturedMedia: vi.fn(), withFeaturedMedia: vi.fn(), }),);
vi.mock('../repositories/genericEntity.repo', () => ({
    list: (...a: unknown[]) => repoList(...a,),
    getById: (...a: unknown[]) => repoGetById(...a,),
    getBySlug: (...a: unknown[]) => repoGetBySlug(...a,),
}),);
vi.mock('../entities/dataProviders', () => ({ getEntityDataProvider: () => undefined, }),);
vi.mock('../entities/entityManager', () => ({
    ready: vi.fn(),
    requireType: (key: string,) => ({
        key, label: key, hasStatus: true, hasSlug: true, fields: [],
        caching: { indexEnabled: false, recordEnabled: false, },
    }),
}),);
vi.mock('./postGate', async () => {
    const real = await vi.importActual<typeof import('./postGate')>('./postGate',);
    return {
        ...real,
        viewerRank: vi.fn(async () => null,),
        tiersById: vi.fn(async () => new Map([['sub', { id: 'sub', name: 'Subscriber', slug: 'subscriber', sortOrder: 10, },],],),),
    };
},);

import * as entities from './entities';

const gateRow = (extra: Record<string, unknown> = {},) => ({
    id: 'p1', required_tier_id: 'sub', gate_hidden: false, gate_show_sample: false, gate_sample_percent: 25,
    content: '<p>secret body</p>', post_type: 'article', ...extra,
});

beforeEach(() => {
    repoList.mockReset();
    repoGetById.mockReset();
    repoGetBySlug.mockReset();
    dbQuery.mockReset();
},);

describe('entities.get (non-admin)', () => {
    it('404s a draft', async () => {
        repoGetBySlug.mockResolvedValue({ id: 'c1', slug: 'x', status: 'draft', },);
        await expect(entities.get('recipe', 'x',),).rejects.toThrow();
    },);

    it('returns a draft to staff', async () => {
        repoGetBySlug.mockResolvedValue({ id: 'c1', slug: 'x', status: 'draft', },);
        await expect(entities.get('recipe', 'x', { admin: true, },),).resolves.toMatchObject({ status: 'draft', },);
    },);

    it('strips the body of a locked post for an anonymous caller', async () => {
        repoGetBySlug.mockResolvedValue({ id: 'p1', slug: 'x', status: 'published', content: '<p>secret body</p>', },);
        dbQuery.mockResolvedValue({ rows: [gateRow(),], },);
        const rec = await entities.get('post', 'x',);
        expect(rec.content,).toBe('',);
        expect((rec as { gate?: { state: string; }; }).gate?.state,).toBe('locked',);
    },);

    it('404s a gate-hidden post', async () => {
        repoGetBySlug.mockResolvedValue({ id: 'p1', slug: 'x', status: 'published', content: 'b', },);
        dbQuery.mockResolvedValue({ rows: [gateRow({ gate_hidden: true, },),], },);
        await expect(entities.get('post', 'x',),).rejects.toThrow();
    },);
},);

describe('entities.list (non-admin)', () => {
    it('adds the visible-status and hidden-post SQL conditions', async () => {
        repoList.mockResolvedValue({ items: [], total: 0, },);
        await entities.list('post', { limit: 5, },);
        const opts = repoList.mock.calls[0][2] as { extraWhere: Array<(p: unknown[],) => string>; };
        const params: unknown[] = [];
        const sql = opts.extraWhere.map((c,) => c(params,)).join(' AND ',);
        expect(sql,).toContain('"status"',);
        expect(sql,).toContain('required_tier_id',);
        expect(params[0],).toEqual(['draft', 'archived',],);
    },);

    it('returns nothing for an explicit draft request', async () => {
        const res = await entities.list('post', { status: 'draft', },);
        expect(res,).toEqual({ items: [], total: 0, },);
        expect(repoList,).not.toHaveBeenCalled();
    },);

    it('staff lists carry no public conditions', async () => {
        repoList.mockResolvedValue({ items: [], total: 0, },);
        await entities.list('post', {}, { admin: true, },);
        expect((repoList.mock.calls[0][2] as { extraWhere: unknown[]; }).extraWhere,).toEqual([],);
    },);
},);

describe('page access_level (non-admin)', () => {
    it('drops a member-only page for an anonymous lister, keeps it for a member', async () => {
        const rows = [
            { id: 'a', slug: 'a', status: 'published', accessLevel: 'public', },
            { id: 'b', slug: 'b', status: 'published', accessLevel: 'member', },
            { id: 'c', slug: 'c', status: 'published', accessLevel: 'public', isPrivate: true, },
        ];
        repoList.mockResolvedValue({ items: rows.map((r,) => ({ ...r, }),), total: 3, },);
        const anon = await entities.list('page', {},);
        expect(anon.items.map((r,) => r.id),).toEqual(['a',],);

        repoList.mockResolvedValue({ items: rows.map((r,) => ({ ...r, }),), total: 3, },);
        const member = await entities.list('page', {}, { viewer: { id: 'u1', role: 'member', }, },);
        expect(member.items.map((r,) => r.id),).toEqual(['a', 'b', 'c',],);
    },);

    it('404s a member-only page for an anonymous reader', async () => {
        repoGetBySlug.mockResolvedValue({ id: 'b', slug: 'b', status: 'published', accessLevel: 'member', },);
        await expect(entities.get('page', 'b',),).rejects.toThrow();
    },);

    it('lets staff read a patron page', async () => {
        repoGetBySlug.mockResolvedValue({ id: 'p', slug: 'p', status: 'published', accessLevel: 'patron', },);
        const rec = await entities.get('page', 'p', { viewer: { id: 'e1', role: 'editor', }, },);
        expect(rec.id,).toBe('p',);
    },);
},);
