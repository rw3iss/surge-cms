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

describe('renderSocial — the other Item properties reach email', () => {
    /*
     * These were read by the web renderer and ignored here, so an operator
     * could size their posts on the site and get none of it in the inbox. The
     * two now read the same resolver.
     */
    const render = (settings: Record<string, unknown>,) => renderSocial(node(settings,), ctx,);
    const imgOf = (settings: Record<string, unknown>,) => /<img[^>]*>/.exec(render(settings,),)?.[0] ?? '';
    /** The `<td>` wrapping one post (not the meta table's cells). */
    const rowCellOf = (settings: Record<string, unknown>,) =>
        /<td align="[a-z]*" style="padding:[^"]*"/.exec(render(settings,),)?.[0] ?? '';

    it('item width caps the thumbnail', () => {
        expect(imgOf({ itemWidth: '300px', },),).toContain('max-width:300px',);
    });

    it('item width BEATS the media-size preset', () => {
        // The preset is a default; an explicit width is an instruction.
        const out = imgOf({ mediaDisplay: 'small', itemWidth: '300px', },);
        expect(out,).toContain('max-width:300px',);
        expect(out,).not.toContain('max-width:160px',);
    });

    it('keeps the numeric width ATTRIBUTE for Outlook', () => {
        // Outlook ignores max-width and reads the attribute, and `clamp()` has
        // no integer to give it — so the preset still supplies one.
        const out = imgOf({ itemWidth: 'clamp(200px,80vw,800px)', },);
        expect(out,).toContain('width="600"',);
        expect(out,).toContain('max-width:clamp(200px,80vw,800px)',);
    });

    it('falls back to the preset width when no item width is set', () => {
        expect(imgOf({ mediaDisplay: 'medium', },),).toContain('max-width:320px',);
        expect(imgOf({},),).toContain('max-width:600px',);
    });

    it('item height crops rather than squashes', () => {
        // Without object-fit a fixed height distorts the picture.
        const out = imgOf({ itemHeight: '200px', },);
        expect(out,).toContain('height:200px',);
        expect(out,).toContain('object-fit:cover',);
    });

    it('leaves height auto when none is set, and emits no object-fit', () => {
        const out = imgOf({},);
        expect(out,).toContain('height:auto',);
        expect(out,).not.toContain('object-fit',);
    });

    it('item gap spaces the posts', () => {
        expect(rowCellOf({ itemGap: '2rem', },),).toContain('padding:0 0 2rem',);
    });

    it('keeps the 16px default gap when none is set', () => {
        // An untouched block must render exactly as it did before.
        expect(rowCellOf({},),).toContain('padding:0 0 16px',);
    });

    it('an EMPTY item setting does not shadow the default', () => {
        // The reason the resolver answers undefined rather than '': an empty
        // string would win the `??` and emit `padding:0 0 ` / `max-width:`.
        expect(rowCellOf({ itemGap: '', },),).toContain('padding:0 0 16px',);
        expect(imgOf({ itemWidth: '', },),).toContain('max-width:600px',);
        expect(imgOf({ itemHeight: '', },),).toContain('height:auto',);
    });

    it('applies every item property at once without corrupting the style', () => {
        const out = imgOf({
            itemWidth: '300px',
            itemHeight: '200px',
            itemBorderRadius: '8px',
        },);
        expect(out,).toContain('max-width:300px',);
        expect(out,).toContain('height:200px',);
        expect(out,).toContain('border-radius:8px',);
        // No empty declarations left behind by the interpolation.
        expect(out,).not.toMatch(/;\s*;/,);
        expect(out,).not.toMatch(/:\s*;/,);
    });
});

describe('renderSocial — alignment of a post narrower than the block', () => {
    const out = (style: Record<string, unknown>,) => {
        const n = node({ itemWidth: '300px', },) as unknown as Record<string, unknown>;
        n.style = style;
        return renderSocial(n as never, ctx,) as string;
    };
    const img = (style: Record<string, unknown>,) => /<img[^>]*>/.exec(out(style,),)![0];

    it('centres by default', () => {
        // Left-aligned was the old default and read as a layout bug.
        expect(img({},),).toContain('margin:0 auto',);
        expect(out({},),).toContain('<td align="center"',);
    });

    it('follows Horizontal Alignment: center', () => {
        expect(img({ horizontalAlign: 'center', },),).toContain('margin:0 auto',);
    });

    it('follows Horizontal Alignment: start / end', () => {
        expect(img({ horizontalAlign: 'start', },),).toContain('margin:0;',);
        expect(out({ horizontalAlign: 'start', },),).toContain('<td align="left"',);
        expect(img({ horizontalAlign: 'end', },),).toContain('margin:0 0 0 auto',);
        expect(out({ horizontalAlign: 'end', },),).toContain('<td align="right"',);
    });

    it('treats spacing values as centre — one post per row has nothing to space', () => {
        expect(img({ horizontalAlign: 'space-between', },),).toContain('margin:0 auto',);
    });
});

describe('renderSocial — title alignment and width', () => {
    const html = (settings: Record<string, unknown>, style: Record<string, unknown> = {},) => {
        const n = node({ showTitle: true, itemWidth: '300px', ...settings, },) as unknown as Record<string, unknown>;
        n.style = style;
        return renderSocial(n as never, ctx,) as string;
    };
    const metaTable = (h: string,) => /<table role="presentation" align="[a-z]+"[^>]*>/.exec(h,)![0];
    const titleCell = (h: string,) => /<td align="[a-z]+" style="color:[^"]*font-weight:600[^"]*"/.exec(h,)![0];

    it('centres the title by default', () => {
        expect(titleCell(html({},),),).toContain('text-align:center',);
        expect(titleCell(html({},),),).toContain('align="center"',);
    });

    it('follows the Title alignment setting', () => {
        expect(titleCell(html({ titleAlign: 'left', },),),).toContain('text-align:left',);
        expect(titleCell(html({ titleAlign: 'right', },),),).toContain('text-align:right',);
    });

    it('holds the title to the item width, like the picture', () => {
        expect(metaTable(html({},),),).toContain('max-width:300px',);
    });

    it('positions the title block with the picture (centred by default)', () => {
        expect(metaTable(html({},),),).toContain('margin:10px auto 0',);
        expect(metaTable(html({}, { horizontalAlign: 'start', },),),).toContain('margin:10px 0 0"',);
        expect(metaTable(html({}, { horizontalAlign: 'end', },),),).toContain('margin:10px 0 0 auto',);
    });

    it('keeps title alignment independent of where the post sits', () => {
        const h = html({ titleAlign: 'left', }, { horizontalAlign: 'center', },);
        expect(metaTable(h,),).toContain('margin:10px auto 0',);
        expect(titleCell(h,),).toContain('text-align:left',);
    });
});
