/**
 * The canonical URL each route declares.
 *
 * Search Console reported "Duplicate without user-selected canonical" for this
 * site. Part of the cause was us: the homepage's canonical tag said
 * `https://site.us` while the sitemap said `https://site.us/`, so the two
 * signals we control disagreed about the home page's address within one crawl.
 */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const queryMock = vi.fn();
vi.mock('../../db', () => ({ query: (...a: unknown[]) => queryMock(...a,), }),);
vi.mock('./templateRuntime', () => ({ resolveContentForSsr: (c: string,) => Promise.resolve(c,), }),);
vi.mock('../../config', () => ({ config: { frontendUrl: 'https://example.test', }, }),);

import { buildMetaHtml, } from './metaBuilder';
import { resolveRouteMeta, } from './routes';

beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockImplementation(() => Promise.resolve({ rows: [], },),);
},);

describe('canonical URLs', () => {
    it('gives the homepage a trailing slash, matching the sitemap', async () => {
        const meta = await resolveRouteMeta('/',);
        expect(meta?.canonical,).toBe('https://example.test/',);
    },);

    it('does not add a slash to any other route', async () => {
        const meta = await resolveRouteMeta('/posts',);
        expect(meta?.canonical,).toBe('https://example.test/posts',);
    },);

    it('emits the same homepage URL in <link rel=canonical> and og:url', async () => {
        // Both come off `meta.canonical` today. Pinning the RENDERED tags
        // rather than the field means a future second source for og:url
        // cannot reintroduce two spellings of the home page.
        const meta = await resolveRouteMeta('/',);
        const html = buildMetaHtml(meta!,);
        expect(html,).toContain('<link rel="canonical" href="https://example.test/"',);
        expect(html,).toContain('<meta property="og:url" content="https://example.test/"',);
    },);
},);
