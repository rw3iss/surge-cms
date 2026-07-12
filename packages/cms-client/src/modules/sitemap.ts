import type { SitemapXmlResponse, SitemapRegenerateResponse, } from '@sitesurge/types';
import { ModuleBase, } from './base';

/**
 * /sitemap namespace.
 *
 * `xml()` is a RAW route mounted at the site root (`/sitemap.xml`),
 * OUTSIDE the JSON surface — an XML string (`application/xml`), not the
 * envelope; `rootMounted: true` skips the `/api/v1` prefix.
 *
 * `regenerate()` is a NORMAL admin mutation under `/api/v1`
 * (POST /admin/sitemap/regenerate) returning JSON on the standard
 * envelope — NOT a raw root-mounted route.
 */
export class SitemapModule extends ModuleBase {
    protected readonly module = 'sitemap';

    /** GET /sitemap.xml — the raw sitemap document as an XML string. */
    xml(): Promise<SitemapXmlResponse> {
        return this.rawGet('/sitemap.xml', { rootMounted: true, },);
    }

    /** POST /api/v1/admin/sitemap/regenerate (admin) — rebuild + stats. */
    regenerate(): Promise<SitemapRegenerateResponse> {
        return this.mutate<SitemapRegenerateResponse>('POST', '/admin/sitemap/regenerate', {
            invalidates: ['sitemap',],
        },);
    }
}
