import { describe, expect, it, vi, } from 'vitest';
import type {
    SettingsPublicResponse, SettingsUpdateResponse, SettingsFeatureCascadeResult,
    SitemapRegenerateResponse, SettingsFeatureUninstallResponse,
} from '@sitesurge/types';
import { createClient, } from '../index';
import { FeatureCascadeError, } from '../core/errors';

function jsonResponse(data: unknown, status = 200,): Response {
    return new Response(JSON.stringify({ success: status < 400, data, },), {
        status, headers: { 'content-type': 'application/json', },
    },);
}

/** The NON-STANDARD 409 cascade body: `error` is the planner result itself
 *  (not an `{ code, message, details }` ApiError). */
function cascadeResponse(result: SettingsFeatureCascadeResult,): Response {
    return new Response(JSON.stringify({ success: false, error: result, },), {
        status: 409, headers: { 'content-type': 'application/json', },
    },);
}

/** Raw (non-JSON) body, e.g. /feed.xml. */
function rawResponse(text: string, contentType: string,): Response {
    return new Response(text, { status: 200, headers: { 'content-type': contentType, }, },);
}

describe('settings + feed + sitemap modules', () => {
    it('settings.getPublic() GETs /settings/public and caches', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ siteName: 'X', },),);
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        const out: SettingsPublicResponse = await cms.settings.getPublic();
        expect((out as { siteName: string; }).siteName,).toBe('X',);
        const [url, init,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toBe('http://api/api/v1/settings/public',);
        expect((init as RequestInit).method,).toBe('GET',);
        // Second call is served from cache — fetch not called again.
        await cms.settings.getPublic();
        expect(fetchImpl,).toHaveBeenCalledTimes(1,);
    },);

    it('settings.update() resolves on a 200 standard envelope', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: 'Saved', },),);
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        const out: SettingsUpdateResponse = await cms.settings.update({ siteName: 'New', },);
        expect(out.message,).toBe('Saved',);
        const [url, init,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toBe('http://api/api/v1/settings',);
        expect((init as RequestInit).method,).toBe('PUT',);
    },);

    it('settings.update() throws FeatureCascadeError carrying the planner result on 409', async () => {
        const result: SettingsFeatureCascadeResult = {
            ok: false, kind: 'missing_prerequisites', target: 'mailing_lists', missing: ['users',],
        };
        const fetchImpl = vi.fn().mockResolvedValue(cascadeResponse(result,),);
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        let caught: unknown;
        try { await cms.settings.update({ features: { mailing_lists: true, }, },); }
        catch (e) { caught = e; }
        expect(caught,).toBeInstanceOf(FeatureCascadeError,);
        const err = caught as FeatureCascadeError;
        expect(err.status,).toBe(409,);
        // Consumer can read the typed cascade result for its confirm modal.
        expect(err.result.kind,).toBe('missing_prerequisites',);
        expect(err.result.target,).toBe('mailing_lists',);
        expect(err.result.kind === 'missing_prerequisites' ? err.result.missing : [],).toEqual(['users',],);
    },);

    it('feed.xml() hits baseUrl/feed.xml (rootMounted, NO /api/v1) and returns the raw string', async () => {
        const xml = '<?xml version="1.0"?><rss></rss>';
        const fetchImpl = vi.fn().mockResolvedValue(rawResponse(xml, 'application/rss+xml; charset=utf-8',),);
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        const out = await cms.feed.xml();
        expect(out,).toBe(xml,);
        const [url, init,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toBe('http://api/feed.xml',);
        expect((init as RequestInit).method,).toBe('GET',);
    },);

    it('settings.uninstallFeature() POSTs /settings/features/:key/uninstall with body {confirm:true}', async () => {
        const data: SettingsFeatureUninstallResponse = { message: 'Removed shop', droppedTables: ['shop_orders',], };
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(data,),);
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        const out = await cms.settings.uninstallFeature('shop',);
        expect(out.message,).toBe('Removed shop',);
        expect(out.droppedTables,).toEqual(['shop_orders',],);
        const [url, init,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toBe('http://api/api/v1/settings/features/shop/uninstall',);
        expect((init as RequestInit).method,).toBe('POST',);
        const body = JSON.parse((init as RequestInit).body as string,);
        expect(body,).toEqual({ confirm: true, },);
    },);

    it('sitemap.regenerate() POSTs /api/v1/admin/sitemap/regenerate (standard JSON)', async () => {
        const data: SitemapRegenerateResponse = { urlCount: 12, bytes: 3400, regeneratedAt: '2026-06-08T00:00:00.000Z', };
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(data,),);
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        const out: SitemapRegenerateResponse = await cms.sitemap.regenerate();
        expect(out.urlCount,).toBe(12,);
        const [url, init,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toBe('http://api/api/v1/admin/sitemap/regenerate',);
        expect((init as RequestInit).method,).toBe('POST',);
    },);
},);
