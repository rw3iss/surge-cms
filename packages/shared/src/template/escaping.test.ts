/**
 * `{{ }}` output is HTML-escaped by default (audit 2026-10-18 S2): entity
 * records carry member-written text (forum thread titles, comment excerpts,
 * display names) and the output goes into innerHTML / the email body.
 */
import { describe, expect, it, } from 'vitest';
import { entityRef, renderTemplateToString, resolveValueFunction, UNRESOLVED, } from './index';
import type { TemplateRuntime, } from './types';

const XSS = '<img src=x onerror=alert(1)>';

const rt = (context: Record<string, unknown>,): TemplateRuntime => ({
    context,
    resolve: async (name: string, args: unknown[],) => {
        if (name === 'hotThreads') return [{ title: XSS, url: '/forum/t/1', }, { title: 'Tom & Jerry', url: '/x', },];
        const v = resolveValueFunction(name, args,);
        return v === UNRESOLVED ? undefined : v;
    },
});
const render = (src: string, context: Record<string, unknown> = {},) => renderTemplateToString(src, rt(context,), () => '',);

describe('template output escaping', () => {
    it('escapes a member-written thread title in a for loop', async () => {
        const out = await render('{{for hotThreads() as t}}<a>{{t.title}}</a>{{endfor}}',);
        expect(out,).not.toContain('<img',);
        expect(out,).toContain('&lt;img src=x onerror=alert(1)&gt;',);
        expect(out,).toContain('Tom &amp; Jerry',);
    },);

    it('escapes plain fields and display names', async () => {
        expect(await render('{{user.displayName}}', { user: { displayName: XSS, }, },),).not.toContain('<img',);
        expect(await render('{{post.title}}', { post: entityRef('post', { title: XSS, },), },),).not.toContain('<img',);
    },);

    it('keeps trusted rich fields raw', async () => {
        const post = entityRef('post', { content: '<p>Hi <b>there</b></p>', },);
        expect(await render('{{post.content}}', { post, },),).toBe('<p>Hi <b>there</b></p>',);
        expect(await render('{{productsHtml}}', { productsHtml: '<table></table>', },),).toBe('<table></table>',);
        expect(await render('{{truncate(post.content, 200)}}', { post, },),).toContain('<b>',);
    },);

    it('does not double-encode an already-escaped value', async () => {
        expect(await render('{{t}}', { t: 'Fish &amp; Chips &#39;n&#39; more', },),).toBe('Fish &amp; Chips &#39;n&#39; more',);
    },);

    it('a raw runtime (email subject) leaves values unescaped', async () => {
        const r = { ...rt({ t: "O'Brien & Co", },), raw: true, };
        expect(await renderTemplateToString('{{t}}', r, () => '',),).toBe("O'Brien & Co",);
    },);

    it('escapes an untrusted value passed through default()', async () => {
        expect(await render('{{default(x.title, "none")}}', { x: { title: XSS, }, },),).not.toContain('<img',);
    },);
},);

describe('component props + literal fallback', () => {
    it('escapes a prop even when its key is a trusted rich-field name', async () => {
        const out = await render('{{ props.description }}', { props: { description: XSS, }, },);
        expect(out,).not.toContain('<img',);
    },);
    it('a missing dotted path is undefined in a call, not its literal text', async () => {
        expect(await render("{{ default(props.x, 'Hi') }}", { props: {}, },),).toBe('Hi',);
        expect(await render("{{ default(props.x, 'Hi') }}", { props: { x: 'Yo', }, },),).toBe('Yo',);
    },);
    it('a bare unquoted identifier still falls back to its literal text', async () => {
        expect(await render('{{ upper(some-slug) }}',),).toBe('SOME-SLUG',);
    },);
},);
