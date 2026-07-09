/**
 * /utils module — admin editor helper endpoints.
 *
 * Currently just the SSRF-guarded link unfurl used by the URL-Link block
 * editor. `admin`-tier: it fetches an operator-supplied arbitrary URL
 * server-side, so it must be authenticated (or a scoped API key). The
 * SSRF guard + bounded fetch live in `services/urlPreview.ts`.
 */
import { z, } from 'zod';
import type { UtilsUrlPreviewBody, } from '@rw/cms-shared';
import { defineRoute, } from '../api/defineRoute';
import { fetchUrlPreview, } from '../services/urlPreview';

const urlPreviewSchema = z.object({
    url: z.string().url(),
},) satisfies z.ZodType<UtilsUrlPreviewBody>;

export const utilsRoutes = [

    defineRoute({
        method: 'post', path: '/url-preview', auth: 'admin',
        summary: 'SSRF-guarded link unfurl: fetch a URL and return its OpenGraph/basic meta.',
        input: { body: urlPreviewSchema, },
        handler: ({ body, },) => fetchUrlPreview(body.url,),
    },),
];
