/**
 * The shared title composer.
 *
 * The bug this exists to prevent: SSR and the SPA each had their own copy of
 * this rule and they had drifted to OPPOSITE word orders, so the server sent
 * "{Page} | {Site}" and the client overwrote it with "{Site} - {Page}". The
 * rendered DOM is what a JavaScript-rendering crawler indexes, so every
 * server-side meta tag was optimised for a title nothing ever saw — and no
 * tool flagged it, because each half was internally consistent.
 */
import { describe, expect, it, } from 'vitest';
import { buildDocumentTitle, resolvePageTitle, } from '@sitesurge/types';

describe('buildDocumentTitle', () => {
    it('puts the page title FIRST and the brand last', () => {
        // Not "{Site} - {Page}". Search engines truncate near 60 characters and
        // weight leading words most; a brand prefix spends that budget
        // repeating one string on every result.
        expect(buildDocumentTitle('Our Team', 'Surge Media',),).toBe('Our Team | Surge Media',);
    },);

    it('never appends the brand twice', () => {
        // Authors write complete meta titles. Appending again produces
        // "… | Surge Media | Surge Media".
        for (const written of [
            'Contact Surge Media — Philadelphia News Tips | Surge Media',
            'Surge Media - Home',
            'Surge Media | Home',
            'About — Surge Media',
        ]) {
            expect(buildDocumentTitle(written, 'Surge Media',), written,).toBe(written,);
        }
    },);

    it('returns the bare site name when there is no page title', () => {
        for (const empty of ['', '   ', null, undefined,]) {
            expect(buildDocumentTitle(empty, 'Surge Media',),).toBe('Surge Media',);
        }
    },);

    it('does not repeat the site name when the page IS the site name', () => {
        expect(buildDocumentTitle('Surge Media', 'Surge Media',),).toBe('Surge Media',);
    },);

    it('survives a missing site name', () => {
        // Settings load asynchronously on the client; before they arrive the
        // title must still be the page's own words, not " | " or "".
        expect(buildDocumentTitle('Our Team', '',),).toBe('Our Team',);
    },);

    it('trims surrounding whitespace', () => {
        expect(buildDocumentTitle('  Our Team  ', ' Surge Media ',),).toBe('Our Team | Surge Media',);
    },);
},);

describe('resolvePageTitle', () => {
    it('prefers an explicit metaTitle over the display title', () => {
        // The whole point of the SEO field: "Home" is a terrible <title>.
        expect(resolvePageTitle({
            metaTitle: 'Conservative News for Philadelphia', title: 'Home',
        },),).toBe('Conservative News for Philadelphia',);
    },);

    it('falls back to the display title when metaTitle is blank', () => {
        for (const blank of ['', '   ', null, undefined,]) {
            expect(resolvePageTitle({ metaTitle: blank, title: 'Home', },),).toBe('Home',);
        }
    },);

    it('falls back to the supplied default when the entity has neither', () => {
        expect(resolvePageTitle(null, 'Surge Media',),).toBe('Surge Media',);
        expect(resolvePageTitle({},  'Surge Media',),).toBe('Surge Media',);
    },);
},);
