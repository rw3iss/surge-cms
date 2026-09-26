/**
 * `/logo.png` and `/favicon.ico` — the Site Branding images on the site's own
 * origin. See `services/siteAssets.ts` for why.
 *
 * Mounted at the root, ahead of the SPA fallback, which used to answer both
 * paths with the HTML shell.
 */
import type { Request, Response, } from 'express';
import { defineRoute, } from '../api/defineRoute';
import {
    buildWebManifest,
    getSiteAsset,
    getSquareIcon,
    type SiteAsset,
    type SiteAssetKind,
    type SquareIconSize,
} from '../services/siteAssets';

/*
 * Five minutes at the browser AND the edge. Short on purpose: these URLs are
 * handed to third parties (an email footer, a signature) that keep them for
 * good, so the file behind them has to change when the branding does. With
 * CLOUDFLARE_ZONE_ID + CLOUDFLARE_PURGE_TOKEN set, a branding save purges the
 * edge at once and this is only the browser's window.
 */
const CACHE_CONTROL = 'public, max-age=300, s-maxage=300';

async function serve(kind: SiteAssetKind, req: Request, res: Response,): Promise<void> {
    send(await getSiteAsset(kind,), req, res,);
}

function send(asset: SiteAsset | null, req: Request, res: Response,): void {
    if (!asset) {
        res.status(404,).set('Cache-Control', 'public, max-age=60',).type('text/plain',).send('Not found',);
        return;
    }
    res.set('Content-Type', asset.contentType,);
    res.set('Cache-Control', CACHE_CONTROL,);
    res.set('ETag', asset.etag,);
    // Consumers on other origins (mail clients, Google) load this directly.
    res.set('Access-Control-Allow-Origin', '*',);
    res.set('Cross-Origin-Resource-Policy', 'cross-origin',);
    if (req.headers['if-none-match'] === asset.etag) {
        res.status(304,).end();
        return;
    }
    res.send(asset.body,);
}

export const siteAssetRoutes = [
    defineRoute({
        method: 'get',
        path: '/logo.png',
        auth: 'public',
        raw: true,
        summary: 'The Site Branding logo as PNG, on the site origin.',
        handler: ({ req, res, },) => serve('logo', req, res,),
    },),
    ...([
        ['/apple-touch-icon.png', 180,],
        ['/icons/icon-192x192.png', 192,],
        ['/icons/icon-512x512.png', 512,],
    ] as Array<[string, SquareIconSize,]>).map(([path, size,],) =>
        defineRoute({
            method: 'get',
            path,
            auth: 'public',
            raw: true,
            summary: `Square ${size}px icon generated from Site Branding.`,
            handler: async ({ req, res, },) => send(await getSquareIcon(size,), req, res,),
        },)
    ),
    defineRoute({
        method: 'get',
        path: '/manifest.webmanifest',
        auth: 'public',
        raw: true,
        summary: 'Web app manifest built from Site Settings.',
        handler: async ({ res, },) => {
            res.set('Content-Type', 'application/manifest+json; charset=utf-8',);
            res.set('Cache-Control', CACHE_CONTROL,);
            res.send(JSON.stringify(await buildWebManifest(),),);
        },
    },),
    defineRoute({
        method: 'get',
        path: '/favicon.ico',
        auth: 'public',
        raw: true,
        summary: 'The Site Branding favicon, on the site origin.',
        handler: ({ req, res, },) => serve('favicon', req, res,),
    },),
];
