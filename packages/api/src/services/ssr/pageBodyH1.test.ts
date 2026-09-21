/**
 * One `<h1>` per page, and it should be the one a visitor can see.
 *
 * The homepage resolver passes `showTitle: true` with the SITE NAME, because
 * the page row's title is usually something internal like "home". Once the
 * page's own hero block carried a real `<h1>`, that produced two — and the
 * synthesised one is the worse of the pair, because the SPA does not render it.
 * It was a heading only a crawler ever saw.
 */
import { describe, expect, it, } from 'vitest';
import { buildPageBody, } from './bodyBuilder';
import type { SsrBlockInput, } from './blocks';

const htmlBlock = (content: string,) =>
    ({ id: 'b1', type: 'html', content, settings: {}, } as unknown as SsrBlockInput);

function h1s(html: string,): string[] {
    return [...html.matchAll(/<h1[^>]*>(.*?)<\/h1>/gis),].map(m => m[1].replace(/<[^>]*>/g, '',).trim());
}

describe('buildPageBody h1 handling', () => {
    it('synthesises an h1 from the title when the content has none', () => {
        const html = buildPageBody({
            title: 'Surge Media',
            showTitle: true,
            blocks: [htmlBlock('<p>Just a paragraph.</p>',),],
        },);
        expect(h1s(html,),).toEqual(['Surge Media',],);
    },);

    it('defers to the content\'s own h1', () => {
        const html = buildPageBody({
            title: 'Surge Media',
            showTitle: true,
            blocks: [htmlBlock('<h1 style="font-size:3rem">Truth, Faith, and Action.</h1>',),],
        },);
        expect(h1s(html,),).toEqual(['Truth, Faith, and Action.',],);
    },);

    it('finds an h1 in any block, not just the first', () => {
        const html = buildPageBody({
            title: 'Surge Media',
            showTitle: true,
            blocks: [
                htmlBlock('<p>Intro.</p>',),
                htmlBlock('<h1>Real Heading</h1>',),
            ],
        },);
        expect(h1s(html,),).toEqual(['Real Heading',],);
    },);

    it('is not fooled by an h1-like substring', () => {
        // `<h1abc>` is not an h1, and neither is the text "h1".
        const html = buildPageBody({
            title: 'Page Title',
            showTitle: true,
            blocks: [htmlBlock('<p>We use h1 elements. &lt;h1&gt;</p>',),],
        },);
        expect(h1s(html,),).toEqual(['Page Title',],);
    },);

    it('still emits nothing when showTitle is false and content has none', () => {
        const html = buildPageBody({
            title: 'home',
            showTitle: false,
            blocks: [htmlBlock('<p>Body.</p>',),],
        },);
        expect(h1s(html,),).toEqual([],);
    },);

    it('keeps the blocks in order after the restructure', () => {
        // The render was moved ahead of the title decision; this pins that the
        // output order did not change with it.
        const html = buildPageBody({
            title: 'T',
            showTitle: true,
            description: 'Desc.',
            blocks: [htmlBlock('<p>FIRST</p>',), htmlBlock('<p>SECOND</p>',),],
        },);
        expect(html.indexOf('<h1>',),).toBeLessThan(html.indexOf('Desc.',),);
        expect(html.indexOf('Desc.',),).toBeLessThan(html.indexOf('FIRST',),);
        expect(html.indexOf('FIRST',),).toBeLessThan(html.indexOf('SECOND',),);
    },);
},);
