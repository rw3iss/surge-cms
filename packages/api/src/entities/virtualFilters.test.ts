import { describe, expect, it, vi, } from 'vitest';

vi.mock('../db', () => ({
    query: vi.fn(async () => ({
        rows: [
            { id: 't-free', slug: 'free', name: 'Free', sort_order: 0, is_free: true, },
            { id: 't-sub', slug: 'subscriber', name: 'Subscriber', sort_order: 1, is_free: false, },
            { id: 't-pro', slug: 'pro', name: 'Pro', sort_order: 2, is_free: false, },
        ],
    })),
}),);

const { getVirtualFilter, virtualFilterDefs, PUBLIC_RANK, } = await import('./virtualFilters');

async function sql(key: string, op: string, value: unknown,) {
    const params: unknown[] = [];
    const cond = await getVirtualFilter('post', key,)!.resolve(op, value,);
    return { sql: cond(params,), params, };
}

describe('post virtual filters', () => {
    it('are advertised on the post type', () => {
        expect(virtualFilterDefs('post',).map((d,) => d.key),).toEqual(['subscription', 'type',],);
        expect(virtualFilterDefs('page',),).toEqual([],);
    },);

    it('subscription: a slug compares by rank', async () => {
        const r = await sql('subscription', 'gt', 'free',);
        expect(r.sql,).toMatch(/> \$1::int$/,);
        expect(r.params,).toEqual([0,],);
    },);

    it('subscription: public is below free; numbers pass through', async () => {
        expect((await sql('subscription', 'eq', 'public',)).params,).toEqual([PUBLIC_RANK,],);
        expect((await sql('subscription', 'lte', '2',)).params,).toEqual([2,],);
    },);

    it('subscription: is any of', async () => {
        const r = await sql('subscription', 'in', 'public, subscriber',);
        expect(r.sql,).toMatch(/= ANY\(\$1::int\[\]\)/,);
        expect(r.params,).toEqual([[PUBLIC_RANK, 1,],],);
    },);

    it('subscription: an unknown level matches nothing', async () => {
        expect((await sql('subscription', 'eq', 'gold',)).sql,).toBe('FALSE',);
    },);

    it('type: equality, not-equal and any-of', async () => {
        expect(await sql('type', 'eq', 'Short',),).toEqual({ sql: '"post_type" = $1', params: ['short',], },);
        expect((await sql('type', 'ne', 'video',)).sql,).toBe('"post_type" <> $1',);
        expect((await sql('type', 'in', ['video', 'short',],)).params,).toEqual([['video', 'short',],],);
    },);

    it('options list every level with its rank', async () => {
        const opts = await getVirtualFilter('post', 'subscription',)!.options();
        expect(opts.map((o,) => o.value),).toEqual(['public', 'free', 'subscriber', 'pro',],);
        expect(opts[2].label,).toBe('Subscriber (1)',);
    },);
},);
