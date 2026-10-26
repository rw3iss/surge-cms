/**
 * Every SYSTEM_PAGES entry must be wired to its route — otherwise "Use as page"
 * offers an option that does nothing. Home is served by pages/Home.tsx (via
 * `cms.pages.homepage()`), Shop inside ShopIndex; the rest through
 * `systemRoute('<key>', …)` in App.tsx.
 */
import { readFileSync, } from 'node:fs';
import { resolve, } from 'node:path';
import { describe, expect, it, } from 'vitest';
import { SYSTEM_PAGES, } from '@sitesurge/types';

const src = (p: string,) => readFileSync(resolve(__dirname, '../..', p,), 'utf8',);

describe('system page routes', () => {
    const app = src('App.tsx',);
    const special: Record<string, () => boolean> = {
        home: () => src('pages/Home.tsx',).includes('cms.pages.homepage(',),
        shop: () => src('pages/shop/ShopIndex.tsx',).includes("systemPageSlug('shop'",),
    };
    for (const p of SYSTEM_PAGES) {
        it(`${p.key} (${p.path}) is wired`, () => {
            const wired = special[p.key]?.() ?? app.includes(`<Route path="${p.path}" component={systemRoute('${p.key}',`,);
            expect(wired,).toBe(true,);
        },);
    }
},);
