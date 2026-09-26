/**
 * `/logo.png` and `/favicon.ico` resolve from the CURRENT Site Branding.
 * The property that matters: editing or clearing the logo changes what the
 * URL returns, with no stale copy served for a new logo.
 */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

let branding: {
    logo?: string;
    favicon?: string;
    siteName?: string;
    siteDescription?: string;
    siteTagline?: string;
    appearance?: Record<string, string>;
} = {};
vi.mock('./settings', () => ({ getPublicSettings: async () => branding, }),);

const PNG = Buffer.from('89504e470d0a1a0a', 'hex',);
const fetchMock = vi.fn(async (url: string,) =>
    new Response(url.includes('missing',) ? 'no' : PNG, {
        status: url.includes('missing',) ? 404 : 200,
        headers: { 'content-type': url.endsWith('.ico',) ? 'image/x-icon' : 'image/png', },
    },)
);
vi.stubGlobal('fetch', fetchMock,);

const { buildWebManifest, getSiteAsset, getSquareIcon, __resetSiteAssetMemo, } = await import('./siteAssets');
const sharp = (await import('sharp')).default;

beforeEach(() => {
    __resetSiteAssetMemo();
    fetchMock.mockClear();
    branding = {};
},);

describe('getSiteAsset', () => {
    it('returns null when no logo is configured', async () => {
        expect(await getSiteAsset('logo',),).toBeNull();
    });

    it('serves the configured logo as PNG with an ETag', async () => {
        branding = { logo: 'https://cdn.test/uploads/a.png', };
        const a = await getSiteAsset('logo',);
        expect(a?.contentType,).toBe('image/png',);
        expect(a?.body.equals(PNG,),).toBe(true,);
        expect(a?.etag,).toMatch(/^"[0-9a-f]{20}"$/,);
    });

    it('memoises per URL — a second request does not refetch', async () => {
        branding = { logo: 'https://cdn.test/uploads/a.png', };
        await getSiteAsset('logo',);
        await getSiteAsset('logo',);
        expect(fetchMock,).toHaveBeenCalledTimes(1,);
    });

    it('a CHANGED logo URL is fetched fresh, never served from the old copy', async () => {
        branding = { logo: 'https://cdn.test/uploads/a.png', };
        await getSiteAsset('logo',);
        branding = { logo: 'https://cdn.test/uploads/b.png', };
        await getSiteAsset('logo',);
        expect(fetchMock,).toHaveBeenCalledTimes(2,);
        expect(fetchMock.mock.calls[1][0],).toBe('https://cdn.test/uploads/b.png',);
    });

    it('a CLEARED logo stops being served', async () => {
        branding = { logo: 'https://cdn.test/uploads/a.png', };
        expect(await getSiteAsset('logo',),).not.toBeNull();
        branding = {};
        expect(await getSiteAsset('logo',),).toBeNull();
    });

    it('passes the favicon through with its own content type', async () => {
        branding = { favicon: 'https://cdn.test/uploads/f.ico', };
        expect((await getSiteAsset('favicon',))?.contentType,).toBe('image/x-icon',);
    });

    it('refuses a relative URL that is not an upload — no fetching itself in a loop', async () => {
        branding = { logo: '/logo.png', };
        expect(await getSiteAsset('logo',),).toBeNull();
        expect(fetchMock,).not.toHaveBeenCalled();
    });

    it('refuses an upload path that escapes the upload directory', async () => {
        branding = { logo: '/uploads/../../etc/passwd', };
        expect(await getSiteAsset('logo',),).toBeNull();
    });

    it('returns null, not a throw, when the upstream fails', async () => {
        branding = { logo: 'https://cdn.test/missing.png', };
        expect(await getSiteAsset('logo',),).toBeNull();
    });
});

describe('getSquareIcon', () => {
    it('is null with no favicon or logo', async () => {
        expect(await getSquareIcon(180,),).toBeNull();
    });

    it('renders a square PNG of the requested size from the branding', async () => {
        // A real, wide image, so "square" is actually being enforced.
        const wide = await sharp({ create: { width: 300, height: 100, channels: 4, background: '#ed2024', }, },).png()
            .toBuffer();
        fetchMock.mockImplementationOnce(async () =>
            new Response(wide, { headers: { 'content-type': 'image/png', }, },)
        );
        branding = { logo: 'https://cdn.test/uploads/wide.png', };
        const icon = await getSquareIcon(512,);
        const meta = await sharp(icon!.body,).metadata();
        expect(icon!.contentType,).toBe('image/png',);
        expect([meta.width, meta.height,],).toEqual([512, 512,],);
    });
});

describe('buildWebManifest', () => {
    it('names the SITE, not the product', async () => {
        branding = { siteName: 'Surge Media', siteDescription: 'Conservative news.', };
        const m = await buildWebManifest();
        expect(m.name,).toBe('Surge Media',);
        expect(m.description,).toBe('Conservative news.',);
        expect(JSON.stringify(m,),).not.toContain('SiteSurge',);
    });

    it('uses literal hex colours and ignores a swatch reference', async () => {
        branding = { siteName: 'S', appearance: { primaryColor: '#ED2024', backgroundColor: 'swatch:abc', }, };
        const m = await buildWebManifest();
        expect(m.theme_color,).toBe('#ED2024',);
        expect(m.background_color,).toBe('#ffffff',);
    });

    it('points its icons at the generated files', async () => {
        branding = { siteName: 'S', };
        const srcs = ((await buildWebManifest()).icons as Array<{ src: string; }>).map(i => i.src);
        expect(srcs,).toContain('/icons/icon-192x192.png',);
        expect(srcs,).toContain('/icons/icon-512x512.png',);
    });
});
