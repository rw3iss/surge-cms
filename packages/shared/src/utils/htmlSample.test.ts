import { describe, expect, it, } from 'vitest';
import { truncateHtmlByRatio, } from './htmlSample';

describe('truncateHtmlByRatio', () => {
    const html = '<p>One two three four.</p><p>Five <strong>six seven</strong> eight nine ten.</p>';

    it('keeps everything at 100% and nothing at 0%', () => {
        expect(truncateHtmlByRatio(html, 1,),).toBe(html,);
        expect(truncateHtmlByRatio(html, 0,),).toBe('',);
    },);

    it('cuts inside a nested tag and closes every open tag', () => {
        const out = truncateHtmlByRatio(html, 0.55,);
        expect(out,).toMatch(/^<p>One two three four\.<\/p><p>Five <strong>six…<\/strong><\/p>$/,);
    },);

    it('drops everything after the cut', () => {
        const out = truncateHtmlByRatio(html, 0.25,);
        expect(out,).not.toContain('Five',);
        expect(out.endsWith('</p>',),).toBe(true,);
    },);

    it('counts an entity as one character and never splits it', () => {
        const out = truncateHtmlByRatio('<p>A &amp; B &amp; C &amp; D</p>', 0.5,);
        expect(out,).not.toMatch(/&am(?!p;)/,);
    },);

    it('keeps void elements and does not try to close them', () => {
        const out = truncateHtmlByRatio('<p>Hello<br>world and more words here</p>', 0.5,);
        expect(out,).toContain('<br>',);
        expect(out,).not.toContain('</br>',);
    },);
},);
