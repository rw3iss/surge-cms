/**
 * The `{{site.*}}` bag feeds THREE runtimes — the client template engine, the
 * mail renderer and SSR — and exists precisely because those three had drifted
 * into three different shapes. Nothing pinned the shape they agreed on, so the
 * next well-meant edit could silently re-open the drift.
 *
 * `{{site.logo}}` is the case that has already bitten twice in production: once
 * rendering the catalog's placeholder `https://example.com/logo.png`, and once
 * arriving in an inbox as a relative path no client could resolve.
 */
import { describe, expect, it, } from 'vitest';
import { buildSiteVariables, } from './siteVariables';

const SETTINGS = {
    siteName: 'Surge Media',
    siteTagline: 'Independent journalism',
    siteDescription: 'News for the people',
    logo: '/uploads/logo.png',
    favicon: '/favicon.ico',
    contactEmail: 'hi@surge.test',
};

describe('buildSiteVariables — the canonical names', () => {
    it('exposes the short names every template is written against', () => {
        const v = buildSiteVariables(SETTINGS, 'https://surge.test',);
        expect(v.name,).toBe('Surge Media',);
        expect(v.tagline,).toBe('Independent journalism',);
        expect(v.description,).toBe('News for the people',);
        expect(v.email,).toBe('hi@surge.test',);
        expect(v.url,).toBe('https://surge.test',);
    });

    it('KEEPS the raw settings keys, so older templates still resolve', () => {
        // The client used to hand the engine the raw settings object, so
        // `{{site.siteName}}` is out there in real templates.
        const v = buildSiteVariables(SETTINGS, 'https://surge.test',);
        expect(v.siteName,).toBe('Surge Media',);
        expect(v.siteTagline,).toBe('Independent journalism',);
    });

    it('lets the canonical name win a collision with a raw key', () => {
        // `name` must be the SITE name, whatever a settings row happens to
        // call itself — the spread order is load-bearing.
        const v = buildSiteVariables({ ...SETTINGS, name: 'something else', }, 'https://surge.test',);
        expect(v.name,).toBe('Surge Media',);
    });

    it('trims stray whitespace out of the text fields', () => {
        const v = buildSiteVariables({ siteName: '  Surge  ', contactEmail: ' a@b.c ', }, 'https://s.test',);
        expect(v.name,).toBe('Surge',);
        expect(v.email,).toBe('a@b.c',);
    });
});

describe('buildSiteVariables — asset URLs are absolute', () => {
    it('absolutises a relative logo against the site URL', () => {
        // Fine in a page, useless in an inbox: the mail client has no origin
        // to resolve `/uploads/logo.png` against.
        expect(buildSiteVariables(SETTINGS, 'https://surge.test',).logo,)
            .toBe('https://surge.test/uploads/logo.png',);
    });

    it('leaves an already-absolute URL alone', () => {
        const v = buildSiteVariables({ logo: 'https://cdn.test/logo.png', }, 'https://surge.test',);
        expect(v.logo,).toBe('https://cdn.test/logo.png',);
    });

    it('leaves a protocol-relative URL and a data: URI alone', () => {
        expect(buildSiteVariables({ logo: '//cdn.test/l.png', }, 'https://s.test',).logo,)
            .toBe('//cdn.test/l.png',);
        expect(buildSiteVariables({ logo: 'data:image/png;base64,AAA', }, 'https://s.test',).logo,)
            .toBe('data:image/png;base64,AAA',);
    });

    it('does not double the slash when the site URL has a trailing one', () => {
        expect(buildSiteVariables(SETTINGS, 'https://surge.test/',).logo,)
            .toBe('https://surge.test/uploads/logo.png',);
        expect(buildSiteVariables(SETTINGS, 'https://surge.test/',).url,).toBe('https://surge.test',);
    });

    it('inserts the slash when the asset path lacks one', () => {
        expect(buildSiteVariables({ logo: 'uploads/logo.png', }, 'https://s.test',).logo,)
            .toBe('https://s.test/uploads/logo.png',);
    });

    it('absolutises the favicon the same way', () => {
        expect(buildSiteVariables(SETTINGS, 'https://surge.test',).favicon,)
            .toBe('https://surge.test/favicon.ico',);
    });
});

describe('buildSiteVariables — absent values', () => {
    it('answers EMPTY STRINGS, never undefined, for a missing setting', () => {
        /*
         * `{{site.logo}}` lands in an `<img src>`. An empty attribute is a
         * broken-free no-op; `undefined` renders the literal word.
         */
        const v = buildSiteVariables({}, 'https://s.test',);
        for (const k of ['name', 'logo', 'favicon', 'tagline', 'description', 'email',] as const) {
            expect(v[k], `${k} should be ''`,).toBe('',);
        }
    });

    it('survives null / undefined settings entirely', () => {
        // SSR renders anonymously and may have no settings row loaded.
        for (const s of [null, undefined,]) {
            const v = buildSiteVariables(s, 'https://s.test',);
            expect(v.name,).toBe('',);
            expect(v.url,).toBe('https://s.test',);
        }
    });

    it('survives an empty site URL without emitting a bare slash', () => {
        const v = buildSiteVariables({ logo: '/uploads/l.png', }, '',);
        expect(v.url,).toBe('',);
        // No origin to build on — the path is the best available answer.
        expect(v.logo,).toBe('/uploads/l.png',);
    });
});
