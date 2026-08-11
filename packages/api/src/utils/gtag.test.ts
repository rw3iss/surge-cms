import { createHash, } from 'crypto';
import { describe, expect, it, } from 'vitest';
import {
    GA_CONNECT_ORIGINS,
    GA_SCRIPT_ORIGINS,
    gtagInlineBody,
    gtagInlineHash,
    gtagSnippet,
    isValidGaId,
    normalizeGaId,
} from './gtag';

describe('isValidGaId', () => {
    it('accepts GA4 / gtag / legacy ids', () => {
        for (const id of ['G-Y0WPG88NQ3', 'GT-ABC123', 'UA-12345-6', 'AW-9999', 'DC-abc']) {
            expect(isValidGaId(id,)).toBe(true,);
        }
    });

    it('rejects empty / blank / oversized / injection-y values', () => {
        for (const bad of ['', '   ', null, undefined, 'G-<script>', 'G-abc"def', "G-x');alert(1)", 'x'.repeat(41,), 'G ABC']) {
            expect(isValidGaId(bad as string,)).toBe(false,);
        }
    });
});

describe('normalizeGaId', () => {
    it('trims a valid id and nulls an invalid one', () => {
        expect(normalizeGaId('  G-ABC123  ',)).toBe('G-ABC123',);
        expect(normalizeGaId('',)).toBeNull();
        expect(normalizeGaId('bad id!',)).toBeNull();
    });
});

describe('gtagInlineBody', () => {
    it('is deterministic and JSON-encodes the id', () => {
        const a = gtagInlineBody('G-ABC123',);
        expect(a).toBe(gtagInlineBody('G-ABC123',),);
        expect(a).toContain("gtag('config',\"G-ABC123\")",);
        expect(a).toContain('window.dataLayer=window.dataLayer||[]',);
    });
});

describe('gtagSnippet', () => {
    it('emits the async loader (with the id) + the inline bootstrap', () => {
        const html = gtagSnippet('G-ABC123',);
        expect(html).toContain('src="https://www.googletagmanager.com/gtag/js?id=G-ABC123"',);
        expect(html).toContain(`<script>${gtagInlineBody('G-ABC123',)}</script>`,);
    });
});

describe('gtagInlineHash', () => {
    it("is the sha256 of the EXACT inline body the snippet injects (CSP <-> SSR can't drift)", () => {
        const id = 'G-Y0WPG88NQ3';
        const expected = `'sha256-${createHash('sha256',).update(gtagInlineBody(id,), 'utf8',).digest('base64',)}'`;
        expect(gtagInlineHash(id,)).toBe(expected,);
        // The hash must cover precisely what appears between the <script> tags.
        const inner = gtagSnippet(id,).match(/<script>([\s\S]*?)<\/script>/,)?.[1] ?? '';
        const innerHash = `'sha256-${createHash('sha256',).update(inner, 'utf8',).digest('base64',)}'`;
        expect(gtagInlineHash(id,)).toBe(innerHash,);
    });
});

describe('CSP origin lists', () => {
    it('cover the loader + collector endpoints', () => {
        expect(GA_SCRIPT_ORIGINS).toContain('https://www.googletagmanager.com',);
        expect(GA_CONNECT_ORIGINS).toEqual(
            expect.arrayContaining([
                'https://www.googletagmanager.com',
                'https://www.google-analytics.com',
                'https://*.google-analytics.com',
            ],),
        );
    });
});
