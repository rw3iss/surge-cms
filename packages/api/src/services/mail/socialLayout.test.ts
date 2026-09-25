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
    siteName: 'S',
    siteUrl: 'https://s.test',
    palette: {},
    fontFamily: 'sans-serif',
    textColor: '#111',
    bgColor: '#fff',
    linkColor: '#00f',
    typography: {} as never,
} as never;

const node = (settings: Record<string, unknown>,) => ({
    id: 'b1',
    blockType: 'social',
    style: {},
    children: [],
    settings: {
        provider: 'youtube',
        kind: 'video',
        items: [{
            postId: 'AAA',
            postUrl: 'https://youtube.com/watch?v=AAA',
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
    });

    it('hides the author by default', () => {
        expect(renderSocial(node({},), ctx,),).not.toContain('Frank Scales',);
    });

    it('hides the date by default', () => {
        expect(renderSocial(node({},), ctx,),).not.toContain('Sep 18',);
    });

    it('shows the title by default, linked to the post', () => {
        const html = renderSocial(node({},), ctx,) as string;
        expect(html,).toContain('Asking leftist college students',);
        expect(html,).toMatch(/<a href="https:\/\/youtube\.com\/watch\?v=AAA"[^>]*>Asking/,);
    });

    it('links the THUMBNAIL to the post as well', () => {
        const html = renderSocial(node({},), ctx,) as string;
        expect(html,).toMatch(/<a href="https:\/\/youtube\.com\/watch\?v=AAA"[\s\S]{0,120}<img/,);
    });

    it('shows the author when switched on', () => {
        expect(renderSocial(node({ showAuthor: true, },), ctx,),).toContain('Frank Scales',);
    });

    it('shows the date when switched on, formatted readably', () => {
        expect(renderSocial(node({ showDate: true, },), ctx,),).toContain('Sep 18, 2026',);
    });

    it('puts the title and date in ONE row, title first', () => {
        // [title]        [date] — a two-cell table, the only layout every mail
        // client agrees on.
        const html = renderSocial(node({ showDate: true, },), ctx,) as string;
        expect(html.indexOf('Asking leftist',),).toBeLessThan(html.indexOf('Sep 18, 2026',),);
        expect(html,).toContain('text-align:right',);
    });

    it('omits the meta row entirely when title and date are both off', () => {
        const html = renderSocial(node({ showTitle: false, },), ctx,) as string;
        expect(html,).not.toContain('text-align:right',);
        expect(html,).toContain('<img',);
    });

    it('survives a missing or unparseable date', () => {
        for (const publishedAt of [undefined, '', 'not-a-date',]) {
            const html = renderSocial(
                node({ showDate: true, items: [{ postId: 'A', postUrl: 'u', content: 'T', publishedAt, },], },),
                ctx,
            ) as string;
            expect(html, String(publishedAt,),).toContain('T',);
            expect(html, String(publishedAt,),).not.toContain('Invalid',);
        }
    });
});

describe('renderSocial — item border radius', () => {
    /** The <img> for the first post. */
    const img = (settings: Record<string, unknown>, style: Record<string, unknown> = {},) => {
        const n = node(settings,) as unknown as Record<string, unknown>;
        n.style = style;
        return /<img[^>]*>/.exec(renderSocial(n as never, ctx,),)?.[0] ?? '';
    };

    it('puts the item radius on the still image', () => {
        // Email has no iframe, so the still IS the post — it carries the
        // rounding that `.social-embed` + overflow does on the web.
        expect(img({ itemBorderRadius: '15px', },),).toContain('border-radius:15px',);
    });

    it('keeps a multi-value radius intact', () => {
        expect(img({ itemBorderRadius: '0px 0px 15px 15px', },),)
            .toContain('border-radius:0px 0px 15px 15px',);
    });

    it('BEATS the block-level radius — it is the more specific setting', () => {
        const out = img({ itemBorderRadius: '15px', }, { borderRadius: '40px', },);
        expect(out,).toContain('border-radius:15px',);
        expect(out,).not.toContain('border-radius:40px',);
    });

    it('falls back to the block radius when no item radius is set', () => {
        // The behaviour added when the block radius first reached the media;
        // it must survive this more specific setting being introduced.
        expect(img({}, { borderRadius: '40px', },),).toContain('border-radius:40px',);
    });

    it('falls back to the 4px default when neither is set', () => {
        expect(img({},),).toContain('border-radius:4px',);
    });

    it('an EMPTY item radius does not shadow the block radius', () => {
        // The reason the resolver answers undefined rather than '': an empty
        // string would win the `??` and render `border-radius:`.
        const out = img({ itemBorderRadius: '', }, { borderRadius: '40px', },);
        expect(out,).toContain('border-radius:40px',);
        expect(out,).not.toContain('border-radius:;',);
    });

    it('survives the auto-feed path, which rewrites settings', () => {
        // `resolveSocialFeed` replaces the block's settings wholesale to inject
        // the fetched posts; it spreads the original bag, so a setting added
        // later must still arrive. Simulated here by the same shape it returns.
        const settings = { itemBorderRadius: '15px', usePinned: false, };
        expect(img(settings,),).toContain('border-radius:15px',);
    });
});
