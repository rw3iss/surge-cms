/**
 * The post SSR body.
 *
 * `buildPostBody` used to render only the legacy `posts.content` column, which
 * is EMPTY for every post authored in the block editor. A live article measured
 * 45 server-rendered words against 628 rendered ones — the crawler got a
 * headline, a date and an excerpt while the page's NewsArticle schema asserted
 * a full article.
 */
import { describe, expect, it, } from 'vitest';
import { buildPostBody, } from './bodyBuilder';

const richText = (html: string,) => ({
    id: 'b1', parentBlockId: null, type: 'rich_text',
    title: null, content: html, settings: {},
});

const words = (s: string,) => s.replace(/<[^>]+>/g, ' ',).split(/\s+/,).filter(Boolean,).length;

describe('buildPostBody', () => {
    it('renders the article from content BLOCKS', () => {
        const html = buildPostBody({
            title: 'Our Major Cities are in Decay',
            excerpt: 'Urban America belongs to those who follow the law.',
            content: '', // the legacy column, empty on a block-authored post
            blocks: [richText('<p>The first paragraph of the actual article.</p>',),],
        },);
        expect(html,).toContain('The first paragraph of the actual article.',);
    },);

    it('renders SEVERAL blocks, in order', () => {
        const html = buildPostBody({
            title: 'T',
            blocks: [richText('<p>alpha</p>',), richText('<p>omega</p>',),],
        },);
        expect(html.indexOf('alpha',),).toBeLessThan(html.indexOf('omega',),);
    },);

    it('puts the body inside the <article>, after the excerpt', () => {
        // Order is the document outline a crawler reads: h1 → meta → excerpt →
        // body → tags.
        const html = buildPostBody({
            title: 'T', excerpt: 'EXCERPT', tags: ['Politics',],
            blocks: [richText('<p>BODY</p>',),],
        },);
        expect(html.indexOf('EXCERPT',),).toBeLessThan(html.indexOf('BODY',),);
        expect(html.indexOf('BODY',),).toBeLessThan(html.indexOf('Politics',),);
        expect(html.trimEnd().endsWith('</article>',),).toBe(true,);
    },);

    it('still renders the legacy content column', () => {
        // Older posts predate the block editor; they must not regress.
        const html = buildPostBody({ title: 'T', content: '<p>legacy body</p>', },);
        expect(html,).toContain('legacy body',);
    },);

    it('renders BOTH when a post has legacy content and blocks', () => {
        const html = buildPostBody({
            title: 'T', content: '<p>legacy</p>', blocks: [richText('<p>blocky</p>',),],
        },);
        expect(html,).toContain('legacy',);
        expect(html,).toContain('blocky',);
    },);

    it('omits the content wrapper entirely when no block renders anything', () => {
        // A post of only non-indexable blocks (a form, a social feed) must not
        // emit an empty <div> pretending to be an article body.
        const dynamic = { ...richText('',), type: 'form', content: null, };
        const html = buildPostBody({ title: 'T', blocks: [dynamic as never,], },);
        expect(html,).not.toContain('class="ssr-post__content"',);
    },);

    it('emits the byline when the post has an author', () => {
        // The E-E-A-T signal. Anonymous political commentary is the hardest
        // category there is to rank.
        const html = buildPostBody({ title: 'T', author: 'Frank Scales', },);
        expect(html,).toContain('Frank Scales',);
    },);

    it('turns a real article into real indexable text', () => {
        // The regression guard with teeth: the measured failure was 45 words.
        const body = '<p>' + 'word '.repeat(400,) + '</p>';
        const html = buildPostBody({
            title: 'T', excerpt: 'x', content: '', blocks: [richText(body,),],
        },);
        expect(words(html,),).toBeGreaterThan(300,);
    },);
},);
