/** Group block in email: row / column / grid tables (`groupLayoutOf`). */
import { TYPOGRAPHY_DEFAULTS, } from '@sitesurge/types';
import { describe, expect, it, } from 'vitest';
import { type EmailBlockNode, type EmailRenderCtx, } from './index';
import { groupEmailColumnWidths, groupEmailGap, renderGroup, } from './group';

const CTX: EmailRenderCtx = {
    siteName: 'Test', siteUrl: 'https://test.example', palette: {}, fontFamily: 'Arial',
    textColor: '#111', bgColor: '#fff', linkColor: '#00e', typography: TYPOGRAPHY_DEFAULTS,
};
const item = (i: number,): EmailBlockNode => ({ id: `i${i}`, blockType: 'group_item', settings: {}, style: {}, children: [], });
const group = (settings: Record<string, unknown>, n: number,): EmailBlockNode => ({
    id: 'g', blockType: 'group', settings, style: {}, children: Array.from({ length: n, }, (_, i,) => item(i,),),
});
const rows = (html: string,) => (html.match(/<tr>/g,) ?? []).length;

describe('renderGroup', () => {
    it('row: one row of cells', () => {
        const html = renderGroup(group({ direction: 'horizontal', columns: 3, }, 3,), CTX,) as string;
        expect(rows(html,),).toBe(1,);
    },);
    it('grid: columns × rows cells, equal widths', () => {
        const html = renderGroup(group({ direction: 'grid', columns: 3, rows: 2, }, 6,), CTX,) as string;
        expect(rows(html,),).toBe(2,);
        expect((html.match(/width="33.33%"/g,) ?? []).length,).toBe(6,);
    },);
    it('grid: a short last row is padded to full width', () => {
        const html = renderGroup(group({ direction: 'grid', columns: 2, rows: 2, }, 3,), CTX,) as string;
        expect(rows(html,),).toBe(2,);
        expect((html.match(/width="50%"/g,) ?? []).length,).toBe(4,);
    },);
},);

describe('group gap in email', () => {
    it('reads the style gap (row column), else the retired setting', () => {
        expect(groupEmailGap({ style: { gap: '90px 30px', }, settings: {}, },),).toEqual({ row: 90, col: 30, },);
        expect(groupEmailGap({ style: {}, settings: { gap: '16px', }, },),).toEqual({ row: 16, col: 16, },);
        expect(groupEmailGap({ settings: {}, },),).toEqual({ row: 0, col: 0, },);
    },);
    it('spaces grid columns and rows', () => {
        const g = group({ direction: 'grid', columns: 2, rows: 2, }, 4,);
        g.style = { gap: '10px 20px', };
        const html = renderGroup(g, CTX,) as string;
        expect((html.match(/padding-left:20px/g,) ?? []).length,).toBe(2,);
        expect(html,).toContain('height:10px',);
    },);
},);

describe('group column widths in email (same tracks as the web)', () => {
    const sized = (settings: Record<string, unknown>, widths: Array<string | undefined>,): EmailBlockNode => ({
        id: 'g', blockType: 'group', settings, style: {},
        children: widths.map((w, i,) => ({ id: `i${i}`, blockType: 'group_item', settings: w ? { width: w, } : {}, style: {}, children: [], })),
    });
    it('row without widths → equal columns', () => {
        const html = renderGroup(sized({ direction: 'horizontal', columns: 2, }, [undefined, undefined,],), CTX,) as string;
        expect((html.match(/width="50%"/g,) ?? []).length,).toBe(2,);
        expect(html,).toContain('table-layout:fixed',);
    },);
    it('row 80% / 20% → 80% / 20% cells; the slot width is not applied twice', () => {
        const html = renderGroup(sized({ direction: 'horizontal', columns: 2, }, ['80%', '20%',],), CTX,) as string;
        expect(html,).toContain('width="80%"',);
        expect(html,).toContain('width="20%"',);
    },);
    it('grid: the first row sizes every row', () => {
        const html = renderGroup(sized({ direction: 'grid', columns: 2, rows: 2, }, ['25%', undefined, '90%', undefined,],), CTX,) as string;
        expect((html.match(/width="25%"/g,) ?? []).length,).toBe(2,);
        expect((html.match(/width="75%"/g,) ?? []).length,).toBe(2,);
        expect(html,).not.toContain('90%',);
    },);
    it('a fixed column keeps its length; shares get none', () => {
        expect(groupEmailColumnWidths([{ settings: { width: '200px', }, }, { settings: {}, },], 2,),).toEqual(['200px', undefined,],);
    },);
},);
