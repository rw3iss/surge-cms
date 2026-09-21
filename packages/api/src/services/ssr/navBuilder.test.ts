import type { SiteFooterSettings, SiteHeaderSettings, } from '@sitesurge/types';
import { describe, expect, it, } from 'vitest';
import { buildSiteNav, footerLinks, headerLinks, renderNav, } from './navBuilder';

function header(items: unknown[],): SiteHeaderSettings {
    return { items, } as SiteHeaderSettings;
}

describe('headerLinks', () => {
    it('collects plain links', () => {
        expect(headerLinks(header([
            { id: '1', type: 'text_link', text: 'About', url: '/about', order: 1, },
            { id: '2', type: 'text_link', text: 'Posts', url: '/posts', order: 2, },
        ],),),).toEqual([
            { label: 'About', url: '/about', },
            { label: 'Posts', url: '/posts', },
        ],);
    },);

    it('descends into a menu\'s children', () => {
        // A dropdown's children are frequently the ONLY link to those pages.
        // Missing them was most of the orphaning this module fixes.
        const links = headerLinks(header([
            {
                id: '1',
                type: 'menu',
                text: 'About',
                url: '/about',
                order: 1,
                children: [
                    { id: '1a', type: 'text_link', text: 'Mission', url: '/mission', order: 1, },
                    { id: '1b', type: 'text_link', text: 'Founders', url: '/founders', order: 2, },
                ],
            },
        ],),);
        expect(links.map(l => l.url),).toEqual(['/about', '/mission', '/founders',],);
    },);

    it('descends more than one level', () => {
        const links = headerLinks(header([
            {
                id: '1',
                type: 'menu',
                text: 'Top',
                order: 1,
                children: [
                    {
                        id: '2',
                        type: 'menu',
                        text: 'Mid',
                        order: 1,
                        children: [
                            { id: '3', type: 'text_link', text: 'Deep', url: '/deep', order: 1, },
                        ],
                    },
                ],
            },
        ],),);
        expect(links.map(l => l.url),).toContain('/deep',);
    },);

    it('honours the order field rather than array position', () => {
        const links = headerLinks(header([
            { id: '2', type: 'text_link', text: 'Second', url: '/b', order: 2, },
            { id: '1', type: 'text_link', text: 'First', url: '/a', order: 1, },
        ],),);
        expect(links.map(l => l.url),).toEqual(['/a', '/b',],);
    },);

    it.each(['#', '', '   ', 'javascript:void(0)', 'mailto:a@b.com', 'tel:+1555',],)(
        'skips the non-destination href %j',
        (url,) => {
            expect(headerLinks(header([
                { id: '1', type: 'text_link', text: 'x', url, order: 1, },
            ],),),).toEqual([],);
        },
    );

    it('keeps an item with no text, labelled by its destination', () => {
        // An image_link (the logo) carries no text. A link with weak anchor
        // text is still a crawl path, which is the whole point.
        expect(headerLinks(header([
            { id: '1', type: 'image_link', url: '/', order: 1, },
        ],),),).toEqual([{ label: '/', url: '/', },],);
    },);

    it('skips items with no url at all', () => {
        expect(headerLinks(header([
            { id: '1', type: 'text', text: 'Just words', order: 1, },
            { id: '2', type: 'flex_spacer', order: 2, },
        ],),),).toEqual([],);
    },);

    it('de-duplicates, ignoring a trailing slash', () => {
        const links = headerLinks(header([
            { id: '1', type: 'text_link', text: 'About', url: '/about', order: 1, },
            { id: '2', type: 'text_link', text: 'About again', url: '/about/', order: 2, },
        ],),);
        expect(links,).toEqual([{ label: 'About', url: '/about', },],);
    },);

    it.each([null, undefined, {} as SiteHeaderSettings,],)('survives %j', (h,) => {
        expect(headerLinks(h,),).toEqual([],);
    },);
},);

describe('footerLinks', () => {
    const footer = (rows: unknown[], enabled = true,) =>
        ({ enabled, rows, } as SiteFooterSettings);

    it('walks rows → columns → items', () => {
        const links = footerLinks(footer([
            {
                id: 'r1',
                columns: [
                    { id: 'c1', items: [{ id: 'i1', type: 'text_link', text: 'Contact', url: '/contact', }], },
                    { id: 'c2', items: [{ id: 'i2', type: 'text_link', text: 'Hotline', url: '/hotline', }], },
                ],
            },
        ],),);
        expect(links.map(l => l.url),).toEqual(['/contact', '/hotline',],);
    },);

    it('descends into a group item', () => {
        const links = footerLinks(footer([
            {
                id: 'r1',
                columns: [{
                    id: 'c1',
                    items: [{
                        id: 'g1',
                        type: 'group',
                        items: [{ id: 'i1', type: 'text_link', text: 'Nested', url: '/nested', }],
                    },],
                },],
            },
        ],),);
        expect(links.map(l => l.url),).toEqual(['/nested',],);
    },);

    it('emits nothing when the footer is disabled', () => {
        // A disabled footer renders for no visitor. Emitting its links to a
        // crawler anyway is cloaking — a different link graph for bots.
        const rows = [{
            id: 'r1',
            columns: [{ id: 'c1', items: [{ id: 'i1', type: 'text_link', text: 'X', url: '/x', }], }],
        },];
        expect(footerLinks(footer(rows, false,),),).toEqual([],);
        expect(footerLinks(footer(rows, true,),).length,).toBe(1,);
    },);

    it('falls back to alt text for an image link with no text', () => {
        const links = footerLinks(footer([
            {
                id: 'r1',
                columns: [{
                    id: 'c1',
                    items: [{ id: 'i1', type: 'image_link', altText: 'Logo', url: '/', }],
                },],
            },
        ],),);
        expect(links,).toEqual([{ label: 'Logo', url: '/', },],);
    },);

    it.each([null, undefined,],)('survives %j', (f,) => {
        expect(footerLinks(f,),).toEqual([],);
    },);
},);

describe('renderNav', () => {
    it('emits a nav landmark with a link list', () => {
        const html = renderNav([{ label: 'About', url: '/about', },], 'x', 'Main',);
        expect(html,).toContain('<nav class="x" aria-label="Main">',);
        expect(html,).toContain('<a href="/about">About</a>',);
    },);

    it('emits nothing for an empty list', () => {
        // An empty <nav><ul></ul></nav> is markup that says a nav exists and
        // is empty, which is worse than no landmark.
        expect(renderNav([], 'x', 'Main',),).toBe('',);
    },);

    it('escapes the label and the href', () => {
        const html = renderNav(
            [{ label: '<script>alert(1)</script>', url: '/a"onmouseover="x', },],
            'x',
            'Main',
        );
        expect(html,).not.toContain('<script>',);
        expect(html,).not.toContain('"onmouseover="',);
    },);
},);

describe('buildSiteNav', () => {
    const h = header([
        { id: '1', type: 'text_link', text: 'About', url: '/about', order: 1, },
    ],);
    const f = {
        enabled: true,
        rows: [{
            id: 'r1',
            columns: [{
                id: 'c1',
                items: [
                    { id: 'i1', type: 'text_link', text: 'About', url: '/about', },
                    { id: 'i2', type: 'text_link', text: 'Contact', url: '/contact', },
                ],
            },],
        },],
    } as SiteFooterSettings;

    it('drops footer links already present in the header', () => {
        // A second anchor to the same destination on the same page adds no
        // crawl path; it just makes the fragment noisier.
        const nav = buildSiteNav(h, f,);
        expect(nav.header,).toContain('/about',);
        expect(nav.footer,).toContain('/contact',);
        expect(nav.footer,).not.toContain('/about',);
    },);

    it('keeps the two fragments separate so the body can sit between them', () => {
        const nav = buildSiteNav(h, f,);
        expect(nav.header,).toContain('aria-label="Main"',);
        expect(nav.footer,).toContain('aria-label="Footer"',);
    },);

    it('returns empty strings when nothing is configured', () => {
        expect(buildSiteNav(null, null,),).toEqual({ header: '', footer: '', },);
    },);
},);
