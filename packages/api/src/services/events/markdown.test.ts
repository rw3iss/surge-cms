import { describe, expect, it, } from 'vitest';
import { renderMarkdown, stripMarkdown, } from '@sitesurge/types';

/**
 * The renderer's output is injected with `innerHTML`, so its safety property is
 * load-bearing: escape FIRST, emit our own tags second. The XSS cases below are
 * the reason this file exists — a regression there is a site-wide hole, not a
 * formatting nit.
 */

describe('renderMarkdown — safety', () => {
    it('renders a script tag as visible text, never as a script', () => {
        const html = renderMarkdown('<script>alert(1)</script>',);
        expect(html,).not.toContain('<script>',);
        expect(html,).toContain('&lt;script&gt;',);
    },);

    it('escapes inline event handlers in raw HTML', () => {
        const html = renderMarkdown('<img src=x onerror="alert(1)">',);
        expect(html,).not.toMatch(/<img src=x/,);
        expect(html,).toContain('&lt;img',);
    },);

    it('drops a javascript: link target', () => {
        const html = renderMarkdown('[click](javascript:alert(1))',);
        expect(html,).not.toContain('href="javascript:',);
        expect(html,).not.toContain('<a ',);
    },);

    it('drops a data: image source', () => {
        const html = renderMarkdown('![x](data:text/html;base64,PHN2Zz4=)',);
        expect(html,).not.toContain('<img',);
    },);

    it('keeps ordinary http, mailto, and root-relative links', () => {
        expect(renderMarkdown('[a](https://example.com)',),).toContain('href="https://example.com"',);
        expect(renderMarkdown('[a](mailto:x@example.com)',),).toContain('href="mailto:x@example.com"',);
        expect(renderMarkdown('[a](/events)',),).toContain('href="/events"',);
    },);

    it('adds noopener to external links only', () => {
        expect(renderMarkdown('[a](https://example.com)',),).toContain('rel="noopener noreferrer"',);
        expect(renderMarkdown('[a](/events)',),).not.toContain('noopener',);
    },);
},);

describe('renderMarkdown — formatting', () => {
    it('returns an empty string for empty input', () => {
        expect(renderMarkdown('',),).toBe('',);
        expect(renderMarkdown(null,),).toBe('',);
        expect(renderMarkdown(undefined,),).toBe('',);
    },);

    it('renders headings at the right level', () => {
        expect(renderMarkdown('# Big',),).toBe('<h1>Big</h1>',);
        expect(renderMarkdown('### Small',),).toBe('<h3>Small</h3>',);
    },);

    it('renders bold, italic and strikethrough', () => {
        expect(renderMarkdown('**b**',),).toBe('<p><strong>b</strong></p>',);
        expect(renderMarkdown('*i*',),).toBe('<p><em>i</em></p>',);
        expect(renderMarkdown('~~s~~',),).toBe('<p><del>s</del></p>',);
    },);

    it('renders an unordered list', () => {
        expect(renderMarkdown('- one\n- two',),).toBe('<ul><li>one</li><li>two</li></ul>',);
    },);

    it('renders an ordered list', () => {
        expect(renderMarkdown('1. one\n2. two',),).toBe('<ol><li>one</li><li>two</li></ol>',);
    },);

    it('renders a blockquote', () => {
        expect(renderMarkdown('> quoted',),).toBe('<blockquote>quoted</blockquote>',);
    },);

    it('renders a horizontal rule', () => {
        expect(renderMarkdown('---',),).toBe('<hr />',);
    },);

    it('renders a fenced code block without processing its contents', () => {
        const html = renderMarkdown('```\n**not bold**\n```',);
        expect(html,).toBe('<pre><code>**not bold**</code></pre>',);
    },);

    it('leaves an inline code span unformatted', () => {
        expect(renderMarkdown('`**x**`',),).toBe('<p><code>**x**</code></p>',);
    },);

    it('separates paragraphs on a blank line', () => {
        expect(renderMarkdown('one\n\ntwo',),).toBe('<p>one</p><p>two</p>',);
    },);

    it('treats a single newline as a line break, as a description field implies', () => {
        expect(renderMarkdown('one\ntwo',),).toBe('<p>one<br />two</p>',);
    },);

    it('handles a realistic description end to end', () => {
        const html = renderMarkdown(
            '## Doors at 7\n\nBring **ID**. See the [map](/venue).\n\n- Parking on site\n- No pets',
        );
        expect(html,).toBe(
            '<h2>Doors at 7</h2>'
            + '<p>Bring <strong>ID</strong>. See the <a href="/venue">map</a>.</p>'
            + '<ul><li>Parking on site</li><li>No pets</li></ul>',
        );
    },);
},);

describe('stripMarkdown', () => {
    it('reduces markup to plain text', () => {
        expect(stripMarkdown('## Doors at 7\n\nBring **ID** and a [map](/venue).',),)
            .toBe('Doors at 7 Bring ID and a map.',);
    },);

    it('drops list markers and code fences', () => {
        expect(stripMarkdown('- one\n- two\n\n```\ncode\n```',),).toBe('one two',);
    },);

    it('collapses whitespace so it fits a meta description', () => {
        expect(stripMarkdown('a\n\n\n   b',),).toBe('a b',);
    },);

    it('returns an empty string for empty input', () => {
        expect(stripMarkdown(null,),).toBe('',);
    },);
},);
