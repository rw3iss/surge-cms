/**
 * The entity-binding resolver (audit 2026-10-18 P1, P2, F3, A10).
 */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const list = vi.fn();
const getOne = vi.fn();
const tplGetOne = vi.fn();
vi.mock('./cmsClient', () => ({
    cms: {
        entities: { list: (...a: unknown[]) => list(...a,), getOne: (...a: unknown[]) => getOne(...a,), },
        contentBlockTemplates: { getOne: (...a: unknown[]) => tplGetOne(...a,), },
    },
}),);

import { bindingQueryLimit, entityVars, resolveEntityTemplate, resolveRecords, } from './entityBinding';

beforeEach(() => {
    list.mockReset();
    getOne.mockReset();
    tplGetOne.mockReset();
},);

describe('bindingQueryLimit', () => {
    it('a query limit below the template cap wins', () => expect(bindingQueryLimit(10, 3,),).toBe(3,),);
    it('never exceeds the template cap', () => expect(bindingQueryLimit(4, 50,),).toBe(4,),);
    it('falls back to the cap, then 20', () => {
        expect(bindingQueryLimit(6, undefined,),).toBe(6,);
        expect(bindingQueryLimit(null, undefined,),).toBe(20,);
        expect(bindingQueryLimit(null, 7,),).toBe(7,);
    },);
},);

describe('resolveRecords', () => {
    it('list: one request, refs order kept, capped before the fetch', async () => {
        list.mockResolvedValue({ data: [{ id: 'b', }, { id: 'a', },], },);
        const recs = await resolveRecords('post', { mode: 'list', refs: ['a', 'b', 'c',], }, 2, undefined,);
        expect(recs.map((r,) => r.id),).toEqual(['a', 'b',],);
        expect(list,).toHaveBeenCalledTimes(1,);
        expect((list.mock.calls[0][1] as { filter: unknown; }).filter,).toEqual({ id: { op: 'in', value: ['a', 'b',], }, },);
        expect(getOne,).not.toHaveBeenCalled();
    },);

    it('list: a ref the list did not return falls back to a single read', async () => {
        list.mockResolvedValue({ data: [{ id: 'a', },], },);
        getOne.mockResolvedValue({ id: 'my-slug', },);
        const recs = await resolveRecords('post', { mode: 'list', refs: ['a', 'my-slug',], }, null, undefined,);
        expect(recs.map((r,) => r.id),).toEqual(['a', 'my-slug',],);
    },);

    it("query: the query's own limit is honoured under a larger cap", async () => {
        list.mockResolvedValue({ data: [], },);
        await resolveRecords('post', { mode: 'query', query: { limit: 3, }, }, 10, undefined,);
        expect((list.mock.calls[0][1] as { limit: number; }).limit,).toBe(3,);
    },);

    it('context: reads the route entity under the type variable, else renders once empty', async () => {
        const ctx = { article: { kind: 'post', data: { id: 'p1', }, }, };
        expect(await resolveRecords('post', { mode: 'context', }, null, ctx, { singular: 'article', plural: 'articles', },),).toEqual([{ id: 'p1', },],);
        expect(await resolveRecords('post', { mode: 'context', }, null, undefined,),).toEqual([{},],);
    },);
},);

describe('resolveEntityTemplate', () => {
    it("binds the type's real variable names", async () => {
        tplGetOne.mockResolvedValue({ id: 't', blocks: [], mode: 'single', singularVar: 'category', pluralVar: 'categories', },);
        getOne.mockResolvedValue({ id: 'x', },);
        const r = await resolveEntityTemplate({ entityType: 'cat', templateId: 't', binding: { mode: 'single', ref: 'x', }, }, undefined,);
        expect(r.found,).toBe(true,);
        expect(r.vars,).toEqual({ singular: 'category', plural: 'categories', },);
        expect(r.groups,).toEqual([[{ id: 'x', },],],);
    },);

    it('reports a missing template', async () => {
        tplGetOne.mockRejectedValue(new Error('404',),);
        const r = await resolveEntityTemplate({ entityType: 'cat', templateId: 'gone', }, undefined,);
        expect(r.found,).toBe(false,);
        expect(r.vars,).toEqual(entityVars('cat',),);
    },);
},);
