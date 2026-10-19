/** Group block in email: row / column / grid tables (`groupLayoutOf`). */
import { TYPOGRAPHY_DEFAULTS, } from '@sitesurge/types';
import { describe, expect, it, } from 'vitest';
import { type EmailBlockNode, type EmailRenderCtx, } from './index';
import { groupEmailGap, renderGroup, } from './group';

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
