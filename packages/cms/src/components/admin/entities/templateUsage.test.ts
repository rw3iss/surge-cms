/** The type-to-confirm rule shared by the template editor and the Components list. */
import { describe, expect, it, } from 'vitest';
import { templateDeleteAllowed, usageHref, } from './templateUsage';

const use = { kind: 'page' as const, id: 'p1', title: 'Home', blocks: 1, };

describe('templateDeleteAllowed', () => {
    it('allows an unused (or unchecked) template without typing', () => {
        expect(templateDeleteAllowed([], '', 'Card',),).toBe(true,);
        expect(templateDeleteAllowed(null, '', 'Card',),).toBe(true,);
    });
    it('needs the exact name when the template is used', () => {
        expect(templateDeleteAllowed([use,], '', 'Card',),).toBe(false,);
        expect(templateDeleteAllowed([use,], 'card', 'Card',),).toBe(false,);
        expect(templateDeleteAllowed([use,], ' Card ', 'Card',),).toBe(true,);
    });
    it('links pages, posts and mail templates', () => {
        expect(usageHref(use,),).toBe('/admin/pages/p1',);
        expect(usageHref({ ...use, kind: 'template', },),).toBeNull();
    });
});
