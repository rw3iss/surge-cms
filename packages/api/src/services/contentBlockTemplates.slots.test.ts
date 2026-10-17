/** Server validation of a template's `slots` (create/update). */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const repoCreate = vi.fn();
const repoUpdate = vi.fn();
vi.mock('../repositories/contentBlockTemplates.repo', () => ({
    create: (...a: unknown[]) => repoCreate(...a,),
    update: (...a: unknown[]) => repoUpdate(...a,),
}),);
vi.mock('../entities/entityManager', () => ({
    getType: (k: string,) => (['post', 'gallery_item',].includes(k,) ? { key: k, } : undefined),
}),);
vi.mock('./cache', () => ({
    cache: { invalidateContentBlockTemplatesCache: vi.fn(), invalidateContentBlockTemplatesGlobalCache: vi.fn(), },
    CACHE_KEYS: {},
}),);

import { create, update, validateSlots, } from './contentBlockTemplates';

beforeEach(() => {
    repoCreate.mockReset().mockResolvedValue({ id: 't', entityTypeKey: null, },);
    repoUpdate.mockReset().mockResolvedValue({ id: 't', entityTypeKey: 'post', },);
},);

describe('validateSlots', () => {
    it('accepts + normalises valid slots', () => {
        expect(validateSlots([
            { id: 'photos', entityType: 'gallery_item', array: true, label: '  Photos ', },
            { id: 'lead', entityType: 'post', array: false, previewBinding: { mode: 'list', refs: ['a', 'b',], }, },
        ],),).toEqual([
            { id: 'photos', entityType: 'gallery_item', array: true, label: 'Photos', },
            { id: 'lead', entityType: 'post', array: false, previewBinding: { mode: 'list', refs: ['a',], }, },
        ],);
    },);
    it('rejects a bad id, a duplicate id, an unknown type, too many slots', () => {
        expect(() => validateSlots([{ id: '1bad', entityType: 'post', array: false, },],),).toThrow(/id must start/,);
        expect(() => validateSlots([{ id: 'a', entityType: 'post', array: false, }, { id: 'A', entityType: 'post', array: true, },],),).toThrow(/duplicate/,);
        expect(() => validateSlots([{ id: 'a', entityType: 'recipe', array: false, },],),).toThrow(/unknown entity type/,);
        expect(() => validateSlots(Array.from({ length: 21, }, (_, i,) => ({ id: `s${i}`, entityType: 'post', array: true, }),),),).toThrow(/at most 20/,);
    },);
},);

describe('create / update', () => {
    it('stores validated slots', async () => {
        await create({ name: 'x', slots: [{ id: 'p', entityType: 'post', array: true, label: '', },], },);
        expect(repoCreate.mock.calls[0][0].slots,).toEqual([{ id: 'p', entityType: 'post', array: true, },],);
    },);
    it('refuses invalid slots before writing', async () => {
        await expect(update('t', { slots: [{ id: 'p', entityType: 'nope', array: true, },], },),).rejects.toThrow();
        expect(repoUpdate,).not.toHaveBeenCalled();
    },);
    it('leaves slots alone when the patch has none', async () => {
        await update('t', { name: 'y', },);
        expect(repoUpdate.mock.calls[0][1],).toEqual({ name: 'y', },);
    },);
},);
