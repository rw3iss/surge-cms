/** Block style `order` in email: siblings sorted by it (base value), then position. */
import { describe, expect, it, } from 'vitest';
import { styleOrder, } from './blocks/_util';
import { renderMailHtml, } from './renderer';

const html = (id: string, position: number, text: string, order?: string,) => ({
    id, parentBlockId: null, blockType: 'html', position, settings: { content: `<p>${text}</p>`, }, style: order ? { order, } : {},
});

describe('style order in email', () => {
    it('styleOrder reads integers only', () => {
        expect(styleOrder({ order: '-2', },),).toBe(-2,);
        expect(styleOrder({ order: '3', },),).toBe(3,);
        expect(styleOrder({ order: 'abc', },),).toBe(0,);
        expect(styleOrder(undefined,),).toBe(0,);
    },);
    it('a block with a lower order renders first', () => {
        const out = renderMailHtml({
            subject: 's', siteName: 'S', siteUrl: 'https://s.test', palette: {},
            blocks: [html('a', 0, 'FIRST',), html('b', 1, 'SECOND', '-1',),],
        },).html;
        expect(out.indexOf('SECOND',),).toBeLessThan(out.indexOf('FIRST',),);
    },);
},);
