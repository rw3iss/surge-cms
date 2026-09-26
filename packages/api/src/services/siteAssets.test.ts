/**
 * `/logo.png` and `/favicon.ico` resolve from the CURRENT Site Branding.
 * The property that matters: editing or clearing the logo changes what the
 * URL returns, with no stale copy served for a new logo.
 */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

let branding: { logo?: string; favicon?: string; } = {};
vi.mock('./settings', () => ({ getPublicSettings: async () => branding, }),);

const PNG = Buffer.from('89504e470d0a1a0a', 'hex',);
const fetchMock = vi.fn(async (url: string,) =>
    new Response(url.includes('missing',) ? 'no' : PNG, {
        status: url.includes('missing',) ? 404 : 200,
        headers: { 'content-type': url.endsWith('.ico',) ? 'image/x-icon' : 'image/png', },
    },)
);
vi.stubGlobal('fetch', fetchMock,);

const { getSiteAsset, __resetSiteAssetMemo, } = await import('./siteAssets');

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
