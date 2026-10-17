import { describe, expect, it, } from 'vitest';
import {
    rendersOnce, templateDataFor, templateDataIds, templateDataOf, templateDataPlaceholderText, templateListRenderOf, templateRenderGroups,
} from './templateData';

describe('templateListRenderOf', () => {
    it('defaults anything but once to each', () => {
        expect(templateListRenderOf('once',),).toBe('once',);
        expect(templateListRenderOf(undefined,),).toBe('each',);
        expect(templateListRenderOf('bogus',),).toBe('each',);
    },);
},);

describe('templateRenderGroups', () => {
    const recs = [{ id: 'a', }, { id: 'b', }, { id: 'c', },];
    it('each (default) renders once per record', () => {
        expect(templateRenderGroups(recs, { mode: 'list', },),).toEqual([[recs[0],], [recs[1],], [recs[2],],],);
        expect(templateRenderGroups(recs, { mode: 'list', listRender: 'each', },),).toHaveLength(3,);
    },);
    it('once renders one time with every record (list mode only)', () => {
        expect(templateRenderGroups(recs, { mode: 'list', listRender: 'once', },),).toEqual([recs,],);
        expect(rendersOnce({ mode: 'single', listRender: 'once', },),).toBe(false,);
        expect(templateRenderGroups(recs, { mode: 'single', listRender: 'once', },),).toHaveLength(3,);
    },);
    it('no records → no render', () => {
        expect(templateRenderGroups([], { mode: 'list', listRender: 'once', },),).toEqual([],);
    },);
},);

describe('templateDataFor', () => {
    it('returns the records for the expected type, in order', () => {
        const ctx = templateDataOf('gallery_item', [{ id: '2', }, { id: '1', },],);
        const r = templateDataFor(ctx, 'gallery_item',);
        expect(r.ok,).toBe(true,);
        if (r.ok) expect(templateDataIds(r.records,),).toEqual(['2', '1',],);
    },);
    it('incompatible type names both types', () => {
        const r = templateDataFor(templateDataOf('post', [{ id: 'p', },],), 'gallery_item',);
        expect(r,).toEqual({ ok: false, reason: 'incompatible', expected: 'gallery_item', actual: 'post', },);
        if (!r.ok) expect(templateDataPlaceholderText('Gallery', r,),).toBe('Gallery expects gallery_item template data (this template binds post)',);
    },);
    it('no context, or only id-less stub records → none', () => {
        expect(templateDataFor(null, 'gallery_item',).ok,).toBe(false,);
        expect(templateDataFor(templateDataOf('gallery_item', [{},],), 'gallery_item',),).toMatchObject({ ok: false, reason: 'none', },);
        expect(templateDataOf(null, [{ id: 'x', },],),).toBeNull();
    },);
},);
