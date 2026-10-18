/** Binding → records, the one resolver for entity blocks and template slots. */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const entityGet = vi.fn();
const entityList = vi.fn();
vi.mock('./entities', () => ({
    get: (...a: unknown[]) => entityGet(...a,),
    list: (...a: unknown[]) => entityList(...a,),
}),);
vi.mock('../utils/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), }, }),);

import { recordIds, resolveBindingRecords, resolveSlotRecords, } from './templateSlots';

beforeEach(() => {
    entityGet.mockReset();
    entityList.mockReset();
},);

describe('resolveBindingRecords', () => {
    it('single → get by id/slug', async () => {
        entityGet.mockResolvedValue({ id: 'a', },);
        expect(await resolveBindingRecords('post', { mode: 'single', ref: 'slug-a', },),).toEqual([{ id: 'a', },],);
        expect(entityGet,).toHaveBeenCalledWith('post', 'slug-a',);
    },);
    it('list → each ref in order, missing ones dropped, capped', async () => {
        entityGet.mockImplementation((_t: string, r: string,) => (r === 'x' ? Promise.reject(new Error('404',),) : Promise.resolve({ id: r, },)));
        expect(recordIds(await resolveBindingRecords('post', { mode: 'list', refs: ['c', 'x', 'a', 'b',], }, 2,),),).toEqual(['c',],);
        expect(recordIds(await resolveBindingRecords('post', { mode: 'list', refs: ['c', 'x', 'a',], },),),).toEqual(['c', 'a',],);
    },);
    it('query → list with the limit capped at max', async () => {
        entityList.mockResolvedValue({ items: [{ id: '1', }, { id: '2', }, { id: '3', },], total: 3, },);
        const recs = await resolveBindingRecords('gallery_item', { mode: 'query', query: { limit: 50, search: 'x', }, }, 2,);
        expect(entityList,).toHaveBeenCalledWith('gallery_item', { limit: 2, search: 'x', }, {},);
        expect(recs.length,).toBe(2,);
    },);
    it('passes the audience hint to the entity read', async () => {
        entityList.mockResolvedValue({ items: [], total: 0, },);
        await resolveBindingRecords('gallery_item', { mode: 'query', query: {}, }, 5, { audience: 'email', },);
        expect(entityList.mock.calls.at(-1,)?.[2],).toEqual({ audience: 'email', },);
    },);
    it('never throws', async () => {
        entityList.mockRejectedValue(new Error('boom',),);
        expect(await resolveBindingRecords('post', { mode: 'query', query: {}, },),).toEqual([],);
    },);
},);

describe('resolveSlotRecords', () => {
    const ctx = {
        slots: [{ id: 'one', entityType: 'post', array: false, }, { id: 'many', entityType: 'post', array: true, },],
        bindings: {
            one: { mode: 'list' as const, refs: ['a', 'b',], },
            many: { mode: 'list' as const, refs: ['a', 'b',], },
        },
    };
    beforeEach(() => entityGet.mockImplementation((_t: string, r: string,) => Promise.resolve({ id: r, },)));
    it('non-array slot → at most one record', async () => {
        expect(recordIds(await resolveSlotRecords(ctx, 'one', 'post',),),).toEqual(['a',],);
    },);
    it('array slot → every record', async () => {
        expect(recordIds(await resolveSlotRecords(ctx, 'many', 'post',),),).toEqual(['a', 'b',],);
    },);
    it('missing / incompatible / unfilled → nothing, no reads', async () => {
        expect(await resolveSlotRecords(ctx, 'nope', 'post',),).toEqual([],);
        expect(await resolveSlotRecords(ctx, 'many', 'gallery_item',),).toEqual([],);
        expect(await resolveSlotRecords({ slots: ctx.slots, bindings: {}, }, 'many', 'post',),).toEqual([],);
        expect(entityGet,).not.toHaveBeenCalled();
    },);
},);
