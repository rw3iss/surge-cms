/**
 * The final pass over a rendered email.
 *
 * Both halves fix a real, observed defect:
 *   - a newsletter's main call-to-action was `href="/posts/slug"`, which is
 *     dead in an inbox (no base URL)
 *   - every message was a single text/html part, which SpamAssassin scores as
 *     MIME_HTML_ONLY
 */
import { describe, expect, it, } from 'vitest';
import { absolutiseUrls, finalizeEmail, htmlToText, } from './postProcess';

const SITE = 'https://surgemedia.us';

describe('absolutiseUrls', () => {
    it('prefixes a root-relative href — the reported dead link', () => {
        expect(absolutiseUrls('<a href="/posts/saveourcities">Read</a>', SITE,),)
            .toBe('<a href="https://surgemedia.us/posts/saveourcities">Read</a>',);
    },);

    it('prefixes src and background too', () => {
        expect(absolutiseUrls('<img src="/uploads/a.png">', SITE,),)
            .toContain('src="https://surgemedia.us/uploads/a.png"',);
        expect(absolutiseUrls('<td background="/bg.png">', SITE,),)
            .toContain('background="https://surgemedia.us/bg.png"',);
    },);

    it('leaves already-absolute URLs alone', () => {
        for (const url of ['https://youtube.com/x', 'http://a.test/b', '//cdn.test/c',]) {
            const html = `<a href="${url}">x</a>`;
            expect(absolutiseUrls(html, SITE,), url,).toBe(html,);
        }
    },);

    it('leaves mailto:, tel:, data: and anchors alone', () => {
        // Prefixing `#top` would produce a link to the homepage — worse than
        // the no-op it replaces.
        for (const url of ['mailto:a@b.c', 'tel:+15551234', 'data:image/png;base64,AA', '#top',]) {
            const html = `<a href="${url}">x</a>`;
            expect(absolutiseUrls(html, SITE,), url,).toBe(html,);
        }
    },);

    it('leaves an unresolved {{ }} token alone', () => {
        // The template resolver runs after this and substitutes a full URL;
        // prefixing the token would corrupt it.
        const html = '<a href="{{unsubscribe_url}}">Unsubscribe</a>';
        expect(absolutiseUrls(html, SITE,),).toBe(html,);
    },);

    it('handles single quotes', () => {
        expect(absolutiseUrls("<a href='/x'>y</a>", SITE,),)
            .toBe("<a href='https://surgemedia.us/x'>y</a>",);
    },);

    it('strips a trailing slash from the base so links never double up', () => {
        expect(absolutiseUrls('<a href="/x">y</a>', 'https://surgemedia.us/',),)
            .toContain('https://surgemedia.us/x',);
    },);

    it('is a no-op with no site URL rather than producing "/x"', () => {
        const html = '<a href="/x">y</a>';
        expect(absolutiseUrls(html, '',),).toBe(html,);
    },);
},);

describe('htmlToText', () => {
    it('keeps a link\'s destination', () => {
        // The whole point of a text part: the reader can still get there.
        expect(htmlToText('<a href="https://x.test/a">Read the story</a>',),)
            .toBe('Read the story (https://x.test/a)',);
    },);

    it('does not duplicate a link whose text IS the url', () => {
        expect(htmlToText('<a href="https://x.test">https://x.test</a>',),)
            .toBe('https://x.test',);
    },);

    it('drops style and script contents', () => {
        // Otherwise the CSS survives tag-stripping as a wall of text.
        const out = htmlToText('<style>.a{color:red}</style><p>Hello</p>',);
        expect(out,).toBe('Hello',);
        expect(out,).not.toContain('color',);
    },);

    it('keeps image ALT text and drops decorative images', () => {
        expect(htmlToText('<img src="a.png" alt="Surge Media logo">',),).toBe('[Surge Media logo]',);
        expect(htmlToText('<img src="spacer.gif">',),).toBe('',);
    },);

    it('separates block elements instead of running them together', () => {
        expect(htmlToText('<p>One</p><p>Two</p>',),).toBe('One\nTwo',);
        expect(htmlToText('<td>A</td><td>B</td>',),).toBe('A\nB',);
    },);

    it('decodes the entities our renderer emits', () => {
        expect(htmlToText('<p>A&nbsp;&amp;&nbsp;B &mdash; C</p>',),).toBe('A & B — C',);
        expect(htmlToText('<p>&#8212;</p>',),).toBe('—',);
    },);

    it('never leaves more than one blank line', () => {
        // Table-based email markup nests many empty containers; without the
        // clamp the text part is mostly whitespace. One blank line between
        // blocks is kept — that is structure, not noise.
        const out = htmlToText('<p>A</p><div></div><div></div><div></div><p>B</p>',);
        expect(out,).toBe('A\n\nB',);
        expect(/\n{3,}/.test(out,),).toBe(false,);
    },);

    it('returns something substantial for a realistic email', () => {
        const html = `<table><tr><td><h1>Latest</h1>
            <p>Urban America belongs to the people who follow the law.</p>
            <a href="https://surgemedia.us/posts/x">Read the full story</a></td></tr></table>`;
        const text = htmlToText(html,);
        expect(text,).toContain('Latest',);
        expect(text,).toContain('Urban America',);
        expect(text,).toContain('https://surgemedia.us/posts/x',);
        expect(text,).not.toContain('<',);
    },);
},);

describe('finalizeEmail', () => {
    it('absolutises BEFORE deriving the text, so the text quotes a real URL', () => {
        // Order matters: text derived first would quote "/posts/x".
        const { html, text, } = finalizeEmail('<a href="/posts/x">Read</a>', SITE,);
        expect(html,).toContain('https://surgemedia.us/posts/x',);
        expect(text,).toBe('Read (https://surgemedia.us/posts/x)',);
    },);

    it('always produces a text part', () => {
        expect(finalizeEmail('<p>Hi</p>', SITE,).text,).toBe('Hi',);
    },);
},);
