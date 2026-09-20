/**
 * The shared `{{site.*}}` bag.
 *
 * Three runtimes built `site` three different ways: the client handed over the
 * raw settings object (`{{site.siteName}}` worked, `{{site.name}}` didn't),
 * mail built `{ name, url }` by hand (the reverse), and SSR never defined it
 * at all. The same template gave three different answers, and none of them
 * offered the logo.
 */
import { describe, expect, it, } from 'vitest';
import { buildSiteVariables, } from '@sitesurge/types';

const SETTINGS = {
    siteName: 'Surge Media',
    siteTagline: 'Unfiltered News',
    siteDescription: 'Conservative news for Philadelphia.',
    logo: 'https://cdn.example.com/logo.png',
    favicon: '/uploads/fav.svg',
    contactEmail: 'hello@example.com',
};

describe('buildSiteVariables', () => {
    it('exposes the logo under {{site.logo}}', () => {
        expect(buildSiteVariables(SETTINGS, 'https://example.com',).logo,)
            .toBe('https://cdn.example.com/logo.png',);
    },);

    it('makes a RELATIVE asset absolute', () => {
        // A locally-stored logo is `/uploads/x.png`. Fine in a page, useless in
        // an email — the client has no origin to resolve it against.
        expect(buildSiteVariables(SETTINGS, 'https://example.com',).favicon,)
            .toBe('https://example.com/uploads/fav.svg',);
    },);

    it('leaves an already-absolute or data URL alone', () => {
        for (const url of [
            'https://cdn.example.com/a.png',
            '//cdn.example.com/a.png',
            'data:image/svg+xml;base64,AAA',
        ]) {
            expect(buildSiteVariables({ logo: url, }, 'https://example.com',).logo, url,).toBe(url,);
        }
    },);

    it('returns an empty string for an unset logo, not undefined', () => {
        // `{{site.logo}}` in an `<img src>` must produce an empty attribute,
        // not the literal text "undefined".
        expect(buildSiteVariables({}, 'https://example.com',).logo,).toBe('',);
    },);

    it('exposes the canonical short names', () => {
        const v = buildSiteVariables(SETTINGS, 'https://example.com',);
        expect(v.name,).toBe('Surge Media',);
        expect(v.tagline,).toBe('Unfiltered News',);
        expect(v.description,).toBe('Conservative news for Philadelphia.',);
        expect(v.email,).toBe('hello@example.com',);
    },);

    it('KEEPS the raw settings keys for backward compatibility', () => {
        // The client used to expose the settings object directly, so templates
        // in the wild may already say `{{site.siteName}}`.
        expect(buildSiteVariables(SETTINGS, 'https://example.com',).siteName,)
            .toBe('Surge Media',);
    },);

    it('lets the canonical name win over a colliding raw key', () => {
        // A settings row literally called `name` must not displace the site
        // name — `{{site.name}}` has one meaning.
        const v = buildSiteVariables({ ...SETTINGS, name: 'something else', }, 'https://example.com',);
        expect(v.name,).toBe('Surge Media',);
    },);

    it('strips a trailing slash from the site URL', () => {
        // `{{site.url}}/posts` would otherwise produce a double slash.
        expect(buildSiteVariables(SETTINGS, 'https://example.com/',).url,)
            .toBe('https://example.com',);
    },);

    it('survives null settings', () => {
        // The bag is built before settings load on the client, and from a
        // failed read on the server.
        const v = buildSiteVariables(null, 'https://example.com',);
        expect(v.name,).toBe('',);
        expect(v.logo,).toBe('',);
        expect(v.url,).toBe('https://example.com',);
    },);
},);
