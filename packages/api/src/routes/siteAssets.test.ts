/**
 * Every file the page head, the manifest and link previews point at must have
 * a route. Each of these once answered with the SPA's HTML page instead.
 */
import { describe, expect, it, } from 'vitest';
import { siteAssetRoutes, } from './siteAssets';

describe('siteAssetRoutes', () => {
    const paths = siteAssetRoutes.map(r => (r as unknown as { path: string; }).path);

    it.each([
        '/logo.png',
        '/favicon.ico',
        '/apple-touch-icon.png',
        '/icons/icon-192x192.png',
        '/icons/icon-512x512.png',
        '/manifest.webmanifest',
    ],)('serves %s', (p,) => {
        expect(paths,).toContain(p,);
    },);
});
