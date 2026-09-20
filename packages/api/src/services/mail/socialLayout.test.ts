/**
 * What a social post renders around its media, in email.
 *
 * The reported problem: a "Featured Video" tout showed the channel name and a
 * "Watch" button that nobody asked for. The button is gone outright — the
 * thumbnail already links to the post, so a second affordance was redundant and
 * read as an advert — and author/date are now opt-IN.
 */
import { describe, expect, it, } from 'vitest';
import { renderSocial, } from './blocks/social';

const ctx = {
    siteName: 'S', siteUrl: 'https://s.test', palette: {},
    fontFamily: 'sans-serif', textColor: '#111', bgColor: '#fff', linkColor: '#00f',
    typography: {} as never,
} as never;

const node = (settings: Record<string, unknown>,) => ({
    id: 'b1', blockType: 'social', style: {}, children: [],
    settings: {
        provider: 'youtube', kind: 'video',
        items: [{
            postId: 'AAA', postUrl: 'https://youtube.com/watch?v=AAA',
            content: 'Asking leftist college students…',
            authorName: 'Frank Scales',
            thumbnailUrl: 'https://i.ytimg.com/vi/AAA/hqdefault.jpg',
            publishedAt: '2026-09-18T12:00:00.000Z',
        },],
        ...settings,
    },
} as never);

describe('renderSocial — email layout', () => {
    it('never renders a Watch button', () => {
        // Removed rather than made optional: the thumbnail is the link.
        expect(renderSocial(node({},), ctx,),).not.toContain('Watch',);
    },);

    it('hides the author by default', () => {
        expect(renderSocial(node({},), ctx,),).not.toContain('Frank Scales',);
    },);

    it('hides the date by default', () => {
        expect(renderSocial(node({},), ctx,),).not.toContain('Sep 18',);
    },);

    it('shows the title by default, linked to the post', () => {
        const html = renderSocial(node({},), ctx,) as string;
        expect(html,).toContain('Asking leftist college students',);
        expect(html,).toMatch(/<a href="https:\/\/youtube\.com\/watch\?v=AAA"[^>]*>Asking/,);
    },);

    it('links the THUMBNAIL to the post as well', () => {
        const html = renderSocial(node({},), ctx,) as string;
        expect(html,).toMatch(/<a href="https:\/\/youtube\.com\/watch\?v=AAA"[\s\S]{0,120}<img/,);
    },);

    it('shows the author when switched on', () => {
        expect(renderSocial(node({ showAuthor: true, },), ctx,),).toContain('Frank Scales',);
    },);

    it('shows the date when switched on, formatted readably', () => {
        expect(renderSocial(node({ showDate: true, },), ctx,),).toContain('Sep 18, 2026',);
    },);

    it('puts the title and date in ONE row, title first', () => {
        // [title]        [date] — a two-cell table, the only layout every mail
        // client agrees on.
        const html = renderSocial(node({ showDate: true, },), ctx,) as string;
        expect(html.indexOf('Asking leftist',),).toBeLessThan(html.indexOf('Sep 18, 2026',),);
        expect(html,).toContain('text-align:right',);
    },);

    it('omits the meta row entirely when title and date are both off', () => {
        const html = renderSocial(node({ showTitle: false, },), ctx,) as string;
        expect(html,).not.toContain('text-align:right',);
        expect(html,).toContain('<img',);
    },);

    it('survives a missing or unparseable date', () => {
        for (const publishedAt of [undefined, '', 'not-a-date',]) {
            const html = renderSocial(
                node({ showDate: true, items: [{ postId: 'A', postUrl: 'u', content: 'T', publishedAt, },], },),
                ctx,
            ) as string;
            expect(html, String(publishedAt,),).toContain('T',);
            expect(html, String(publishedAt,),).not.toContain('Invalid',);
        }
    },);
},);
